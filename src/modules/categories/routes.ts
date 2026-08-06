/**
 * 分类模块路由。
 *
 * 所有查询都强制按当前用户过滤，删除一律采用软删除。
 */
import { createRoute } from '@hono/zod-openapi';
import { and, asc, eq, isNull, max, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, items, type CategoryRow } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import {
  CategoryCreateSchema,
  CategoryDeleteResultSchema,
  CategoryIdParamSchema,
  CategoryListSchema,
  CategorySchema,
  CategoryUpdateSchema,
  SORT_ORDER_MAX,
  type CategoryDTO,
} from './schemas.js';

/** Postgres 唯一约束冲突的错误码 */
const PG_UNIQUE_VIOLATION = '23505';

/** 判断某个值是否携带指定的 Postgres 错误码 */
function hasPgErrorCode(value: unknown, code: string): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === code;
}

/**
 * 判断异常是否为唯一约束冲突。
 *
 * drizzle 会把驱动抛出的错误包装成 DrizzleQueryError，原始的 Postgres 错误码在 cause 上，
 * 因此两层都要检查；不做类型断言，只按结构收窄。
 */
function isUniqueViolation(error: unknown): boolean {
  if (hasPgErrorCode(error, PG_UNIQUE_VIOLATION)) {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return hasPgErrorCode(error.cause, PG_UNIQUE_VIOLATION);
  }
  return false;
}

/**
 * 新用户的预置分类。
 *
 * 名称写死为中文：播种那一刻存入的内容之后就是用户自己的数据（可改名、可删除），
 * 不会再随界面语言变化。将来要做多语言，需在播种时按客户端语言选取对应的一套。
 */
const DEFAULT_CATEGORIES: ReadonlyArray<string> = ['运动', '数码', '电竞'];

function toCategoryDTO(row: CategoryRow): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  };
}

/**
 * 首次使用时播种预置分类。
 *
 * 判断依据是「该用户从来没有过任何分类」，计数刻意不排除软删除的记录：
 * 若只看未删除的，用户主动删光全部分类后再次拉列表就会被重新塞回来。
 *
 * 并发首次请求（如 iOS 与 Web 同时登录）依靠 (user_id, name) 的唯一索引兜底，
 * 冲突的那一份直接丢弃，不需要额外加锁。
 */
async function seedDefaultCategories(userId: string): Promise<void> {
  const existingCount = await db.$count(categories, eq(categories.userId, userId));
  if (existingCount > 0) {
    return;
  }

  await db
    .insert(categories)
    .values(
      DEFAULT_CATEGORIES.map((name, index) => ({
        userId,
        name,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing();
}

/** 按 ID 读取当前用户的分类，不存在则抛 404 */
async function findOwnedCategory(userId: string, id: string): Promise<CategoryRow> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw notFound('分类不存在');
  }
  return row;
}

const app = createApp();

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['categories'],
  summary: '分类列表',
  description: '返回当前用户所有未删除的分类，按展示顺序排列。首次调用时自动播种预置分类。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: '分类列表',
      content: { 'application/json': { schema: CategoryListSchema } },
    },
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(listRoute, async (c) => {
  const userId = c.get('userId');

  await seedDefaultCategories(userId);

  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
    .orderBy(asc(categories.sortOrder), asc(categories.createdAt));

  return c.json({ categories: rows.map(toCategoryDTO) }, 200);
});

const createCategoryRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['categories'],
  summary: '新建分类',
  description: '允许客户端传入自行生成的 id 以支持离线创建；重复提交同一 id 时幂等返回已有记录。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CategoryCreateSchema } },
    },
  },
  responses: {
    201: {
      description: '创建成功（或幂等返回已存在的记录）',
      content: { 'application/json': { schema: CategorySchema } },
    },
    400: jsonError('参数有误、分类名重复或 id 已被占用'),
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(createCategoryRoute, async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  // 未指定顺序时排到末尾，避免与既有分类抢同一个位置
  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const [aggregate] = await db
      .select({ maxSortOrder: max(categories.sortOrder) })
      .from(categories)
      .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)));
    // 已有记录取到上限时不再 +1，否则会超出 Postgres integer 范围导致 500。
    // 此时新记录与最大值并列，排序退化为按 createdAt 兜底，不影响可用性
    sortOrder = Math.min((aggregate?.maxSortOrder ?? -1) + 1, SORT_ORDER_MAX);
  }

  let inserted: CategoryRow[];
  try {
    inserted = await db
      .insert(categories)
      .values({
        ...(body.id === undefined ? {} : { id: body.id }),
        userId,
        name: body.name,
        sortOrder,
      })
      .onConflictDoNothing({ target: categories.id })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw badRequest('已存在同名分类');
    }
    throw error;
  }

  const row = inserted[0];
  if (row !== undefined) {
    return c.json(toCategoryDTO(row), 201);
  }

  // 主键冲突：属于本人则幂等返回，否则说明 id 被他人占用
  if (body.id === undefined) {
    throw badRequest('创建分类失败，请重试');
  }
  const existing = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, body.id), eq(categories.userId, userId)))
    .limit(1);

  const owned = existing[0];
  if (owned === undefined) {
    throw badRequest('该分类 ID 已被占用');
  }
  return c.json(toCategoryDTO(owned), 201);
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['categories'],
  summary: '更新分类',
  description: '只更新请求中出现的字段。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    params: CategoryIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: CategoryUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: '更新后的分类',
      content: { 'application/json': { schema: CategorySchema } },
    },
    400: jsonError('参数有误或分类名重复'),
    401: jsonError('未通过身份校验'),
    404: jsonError('分类不存在'),
  },
});

app.openapi(updateRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const current = await findOwnedCategory(userId, id);
  if (current.deletedAt !== null) {
    throw badRequest('该分类已删除，无法修改');
  }

  const patch: Partial<CategoryRow> = {};
  if (body.name !== undefined) {
    patch.name = body.name;
  }
  if (body.sortOrder !== undefined) {
    patch.sortOrder = body.sortOrder;
  }

  let updated: CategoryRow[];
  try {
    updated = await db
      .update(categories)
      .set(patch)
      // 未删除的判断必须下推到 where：上面的前置检查与这里的更新之间存在时间差，
      // 若另一端在此期间删除了该分类，仅靠前置检查会把墓碑改掉
      .where(
        and(eq(categories.id, id), eq(categories.userId, userId), isNull(categories.deletedAt)),
      )
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw badRequest('已存在同名分类');
    }
    throw error;
  }

  const row = updated[0];
  if (row === undefined) {
    // 前置检查已确认存在且未删除，此处无更新只能是并发删除所致
    throw badRequest('该分类已删除，无法修改');
  }
  return c.json(toCategoryDTO(row), 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['categories'],
  summary: '删除分类',
  description:
    '软删除。该分类下的物品会被置为未分类而不会被一并删除。重复删除同一分类时幂等返回。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: { params: CategoryIdParamSchema },
  responses: {
    200: {
      description: '已删除的分类',
      content: { 'application/json': { schema: CategoryDeleteResultSchema } },
    },
    401: jsonError('未通过身份校验'),
    404: jsonError('分类不存在'),
  },
});

app.openapi(deleteRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const current = await findOwnedCategory(userId, id);
  // 已删除则幂等返回，便于客户端安全重传
  if (current.deletedAt !== null) {
    return c.json({ category: toCategoryDTO(current) }, 200);
  }

  // 放在同一事务里：否则中途失败会留下指向已删除分类的物品
  const row = await db.transaction(async (tx) => {
    // 该分类下的物品移入未分类，同时刷新物品的 updated_at，
    // 使最后修改时间准确反映这次归属变化
    await tx
      .update(items)
      .set({ categoryId: null })
      .where(and(eq(items.categoryId, id), eq(items.userId, userId)));

    const deleted = await tx
      .update(categories)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(categories.id, id), eq(categories.userId, userId)))
      .returning();

    return deleted[0];
  });

  if (row === undefined) {
    throw notFound('分类不存在');
  }
  return c.json({ category: toCategoryDTO(row) }, 200);
});

export default app;
