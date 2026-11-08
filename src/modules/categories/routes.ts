/**
 * 分类模块路由。
 *
 * 所有查询都强制按当前用户过滤，删除一律采用软删除。
 */
import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, items, type CategoryRow } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import {
  CategoryConflictDetailsSchema,
  CategoryCreateSchema,
  CategoryDeleteResultSchema,
  CategoryIdParamSchema,
  CategoryListSchema,
  CategoryOrderUpdateSchema,
  CategorySchema,
  CategoryUpdateSchema,
  SORT_ORDER_MAX,
  type CategoryDTO,
} from './schemas.js';

/** Postgres 唯一约束冲突的错误码 */
const PG_UNIQUE_VIOLATION = '23505';

/** 客户端提交的分类集合与服务端当前状态不一致时的统一提示 */
const CATEGORY_ORDER_CONFLICT_MESSAGE = '分类列表与当前状态不一致，请刷新后重试';

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

/** 判断查询结果是否恰好包含客户端提交的全部分类 ID */
function hasSameCategoryIds(
  rows: ReadonlyArray<Pick<CategoryRow, 'id'>>,
  categoryIds: ReadonlyArray<string>,
): boolean {
  const rowIds = new Set(rows.map((row) => row.id));
  return rows.length === categoryIds.length && categoryIds.every((id) => rowIds.has(id));
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

/** 查找当前用户下同名且未删除的分类 ID，找不到返回 null */
async function findActiveCategoryIdByName(userId: string, name: string): Promise<string | null> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.userId, userId), eq(categories.name, name), isNull(categories.deletedAt)),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * 构造同名冲突的 409 错误。
 * 查不到已有分类属于极少见的并发删除，此时不带 details。
 */
async function buildDuplicateNameConflict(userId: string, name: string): Promise<ReturnType<typeof conflict>> {
  const existingId = await findActiveCategoryIdByName(userId, name);
  return conflict(
    '已存在同名分类',
    existingId === null
      ? undefined
      : ({ existingCategoryId: existingId } satisfies z.infer<
          typeof CategoryConflictDetailsSchema
        >),
  );
}

const app = createApp();

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['categories'],
  summary: '分类列表',
  description: '返回当前用户所有未删除的分类，按展示顺序排列。',
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
    400: jsonError('参数有误或 id 已被占用'),
    401: jsonError('未通过身份校验'),
    409: jsonError('已存在同名分类，details.existingCategoryId 为已有分类的 ID'),
  },
});

app.openapi(createCategoryRoute, async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  // 新分类统一追加到末尾；后续调整只能通过整体排序接口完成。
  const [aggregate] = await db
    .select({ maxSortOrder: max(categories.sortOrder) })
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)));
  // 已有记录取到上限时不再 +1，否则会超出 Postgres integer 范围导致 500。
  // 此时新记录与最大值并列，排序退化为按 createdAt 兜底，不影响可用性。
  const sortOrder = Math.min((aggregate?.maxSortOrder ?? -1) + 1, SORT_ORDER_MAX);

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
      throw await buildDuplicateNameConflict(userId, body.name);
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

const updateOrderRoute = createRoute({
  method: 'put',
  path: '/order',
  tags: ['categories'],
  summary: '整体调整分类顺序',
  description:
    '提交服务端当前全部未删除分类的最终顺序，列表必须完整且不能重复。集合不一致时以 409 拒绝，客户端重新拉取列表后再提交。另一端的新建若与本次请求交错，该分类不参与重排、留在末尾并随响应返回，因此客户端应以响应中的全量列表为准，而不是假定结果等于自己提交的顺序。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CategoryOrderUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: '排序后的分类列表',
      content: { 'application/json': { schema: CategoryListSchema } },
    },
    400: jsonError('参数有误或分类 ID 重复'),
    401: jsonError('未通过身份校验'),
    409: jsonError('分类列表与当前状态不一致'),
  },
});

app.openapi(updateOrderRoute, async (c) => {
  const userId = c.get('userId');
  const { categoryIds } = c.req.valid('json');

  const rows = await db.transaction(async (tx) => {
    // 先锁定本人当前全部未删除分类，把并发的排序请求串行开。
    // 按主键排序是为了固定加锁顺序：两个请求若以不同顺序锁定同一批行会互相等待成死锁，
    // 因此这里的 orderBy 不能换成业务排序字段。
    // 行锁只覆盖已存在的行，拦不住并发 INSERT，因此下面的集合校验不等于「集合已冻结」。
    const lockedRows = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.id))
      .for('update');

    if (!hasSameCategoryIds(lockedRows, categoryIds)) {
      throw conflict(CATEGORY_ORDER_CONFLICT_MESSAGE);
    }

    // 上一步为固定加锁顺序只取了 id，这里再按业务顺序读出完整行，
    // 用于判断本次是否为 no-op、以及算出哪些行真正需要改 sortOrder。
    // 行锁此时已持有，读到的即最新已提交状态。
    const currentRows = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));

    const isSameOrder = categoryIds.every((id, index) => currentRows[index]?.id === id);
    if (isSameOrder) {
      return currentRows;
    }

    const currentRowsById = new Map(currentRows.map((row) => [row.id, row]));
    const changedOrders: Array<{ id: string; sortOrder: number }> = [];
    for (const [sortOrder, id] of categoryIds.entries()) {
      const current = currentRowsById.get(id);
      if (current !== undefined && current.sortOrder !== sortOrder) {
        changedOrders.push({ id, sortOrder });
      }
    }

    if (changedOrders.length > 0) {
      const sortOrderCases = changedOrders.map(
        ({ id, sortOrder }) => sql`when ${id} then ${sortOrder}`,
      );
      const sortOrderExpression = sql<number>`case ${categories.id} ${sql.join(
        sortOrderCases,
        sql.raw(' '),
      )} else ${categories.sortOrder} end`;
      const changedIds = changedOrders.map(({ id }) => id);

      const updatedRows = await tx
        .update(categories)
        .set({ sortOrder: sortOrderExpression })
        .where(
          and(
            eq(categories.userId, userId),
            isNull(categories.deletedAt),
            inArray(categories.id, changedIds),
          ),
        )
        .returning({ id: categories.id });

      if (!hasSameCategoryIds(updatedRows, changedIds)) {
        throw conflict(CATEGORY_ORDER_CONFLICT_MESSAGE);
      }
    }

    return tx
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));
  });

  return c.json({ categories: rows.map(toCategoryDTO) }, 200);
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['categories'],
  summary: '更新分类名称',
  description: '分类顺序只能通过整体排序接口修改。',
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
    400: jsonError('参数有误'),
    401: jsonError('未通过身份校验'),
    404: jsonError('分类不存在或已删除'),
    409: jsonError('已存在同名分类，details.existingCategoryId 为已有分类的 ID'),
  },
});

app.openapi(updateRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const current = await findOwnedCategory(userId, id);
  if (current.deletedAt !== null) {
    throw notFound('该分类已删除，无法修改');
  }

  let updated: CategoryRow[];
  try {
    updated = await db
      .update(categories)
      .set({ name: body.name })
      // 未删除的判断必须下推到 where：上面的前置检查与这里的更新之间存在时间差，
      // 若另一端在此期间删除了该分类，仅靠前置检查会把墓碑改掉
      .where(
        and(eq(categories.id, id), eq(categories.userId, userId), isNull(categories.deletedAt)),
      )
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw await buildDuplicateNameConflict(userId, body.name);
    }
    throw error;
  }

  const row = updated[0];
  if (row === undefined) {
    // 前置检查已确认存在且未删除，此处无更新只能是并发删除所致
    throw notFound('该分类已删除，无法修改');
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
