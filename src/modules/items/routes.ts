/**
 * 物品模块路由。
 *
 * 所有查询都强制按当前用户过滤，删除一律采用软删除。
 */
import { createRoute } from '@hono/zod-openapi';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, items, type ItemRow } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import {
  ItemCreateSchema,
  ItemDeleteResultSchema,
  ItemIconSchema,
  ItemIdParamSchema,
  ItemListSchema,
  ItemSchema,
  ItemStatusSchema,
  ItemUpdateSchema,
  type ItemDTO,
} from './schemas.js';

/** 把数据库图标列转换为对外的嵌套图标结构 */
function toItemIcon(row: ItemRow): ItemDTO['icon'] {
  if (row.iconType === null && row.iconValue === null) {
    return null;
  }

  const result = ItemIconSchema.safeParse({
    type: row.iconType,
    value: row.iconValue,
    focus:
      row.iconFocusX !== null && row.iconFocusY !== null
        ? { x: row.iconFocusX, y: row.iconFocusY }
        : null,
  });
  if (result.success) {
    return result.data;
  }

  throw new Error(`物品 ${row.id} 的图标数据不符合契约`);
}

/** 把数据库状态收窄为接口契约允许的取值 */
function toItemStatus(row: ItemRow): ItemDTO['status'] {
  const result = ItemStatusSchema.safeParse(row.status);
  if (result.success) {
    return result.data;
  }

  throw new Error(`物品 ${row.id} 的状态不符合契约`);
}

/** 把数据库行转换为对外物品结构 */
function toItemDTO(row: ItemRow): ItemDTO {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    icon: toItemIcon(row),
    status: toItemStatus(row),
    isFavorite: row.isFavorite,
    note: row.note,
    purchasePrice: row.purchasePrice,
    salePrice: row.salePrice,
    purchasedAt: row.purchasedAt,
    soldAt: row.soldAt,
    warrantyUntil: row.warrantyUntil,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  };
}

/**
 * 解析物品要保存的分类 ID。
 *
 * 离线队列里的操作可能引用在别处已删除的分类；此时按未分类保存，
 * 避免整条操作被拒绝。传入 null / undefined 或分类不属于本人、已删除，都返回 null。
 */
async function resolveOwnedCategoryId(
  userId: string,
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (categoryId === null || categoryId === undefined) {
    return null;
  }

  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.userId, userId),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

/** 按 ID 读取当前用户的物品，不存在则抛 404 */
async function findOwnedItem(userId: string, id: string): Promise<ItemRow> {
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw notFound('物品不存在');
  }
  return row;
}

const app = createApp();

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['items'],
  summary: '物品列表',
  description: '返回当前用户所有未删除的物品，按最后更新时间倒序排列。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: '物品列表',
      content: { 'application/json': { schema: ItemListSchema } },
    },
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(listRoute, async (c) => {
  const userId = c.get('userId');

  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), isNull(items.deletedAt)))
    .orderBy(desc(items.updatedAt), asc(items.id));

  return c.json({ items: rows.map(toItemDTO) }, 200);
});

const createItemRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['items'],
  summary: '新建物品',
  description: '允许客户端传入自行生成的 id；重复提交同一 id 时幂等返回已有记录。categoryId 无效时物品按未分类保存。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ItemCreateSchema } },
    },
  },
  responses: {
    201: {
      description: '创建成功（或幂等返回已存在的记录）',
      content: { 'application/json': { schema: ItemSchema } },
    },
    400: jsonError('参数有误或 id 已被占用'),
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(createItemRoute, async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const categoryId = await resolveOwnedCategoryId(userId, body.categoryId);

  const inserted = await db
    .insert(items)
    .values({
      ...(body.id === undefined ? {} : { id: body.id }),
      userId,
      name: body.name,
      categoryId,
      iconType: body.icon?.type ?? null,
      iconValue: body.icon?.value ?? null,
      iconFocusX: body.icon?.focus?.x ?? null,
      iconFocusY: body.icon?.focus?.y ?? null,
      status: body.status ?? 'in_service',
      isFavorite: body.isFavorite ?? false,
      note: body.note ?? null,
      purchasePrice: body.purchasePrice ?? null,
      salePrice: body.salePrice ?? null,
      purchasedAt: body.purchasedAt ?? null,
      soldAt: body.soldAt ?? null,
      warrantyUntil: body.warrantyUntil ?? null,
    })
    .onConflictDoNothing({ target: items.id })
    .returning();

  const row = inserted[0];
  if (row !== undefined) {
    return c.json(toItemDTO(row), 201);
  }

  if (body.id === undefined) {
    throw badRequest('创建物品失败，请重试');
  }

  const existing = await db
    .select()
    .from(items)
    .where(and(eq(items.id, body.id), eq(items.userId, userId)))
    .limit(1);

  const owned = existing[0];
  if (owned === undefined) {
    throw badRequest('该物品 ID 已被占用');
  }
  if (owned.deletedAt !== null) {
    throw badRequest('该物品已删除');
  }
  return c.json(toItemDTO(owned), 201);
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['items'],
  summary: '更新物品',
  description: '只更新请求中出现的字段；可空字段传 null 表示清空。categoryId 无效时物品按未分类保存。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    params: ItemIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: ItemUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: '更新后的物品',
      content: { 'application/json': { schema: ItemSchema } },
    },
    400: jsonError('参数有误'),
    401: jsonError('未通过身份校验'),
    404: jsonError('物品不存在或已删除'),
  },
});

app.openapi(updateRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const current = await findOwnedItem(userId, id);
  if (current.deletedAt !== null) {
    throw notFound('该物品已删除，无法修改');
  }

  const patch: Partial<ItemRow> = {};
  if (body.name !== undefined) {
    patch.name = body.name;
  }
  if (body.categoryId !== undefined) {
    patch.categoryId = await resolveOwnedCategoryId(userId, body.categoryId);
  }
  if (body.icon !== undefined) {
    patch.iconType = body.icon?.type ?? null;
    patch.iconValue = body.icon?.value ?? null;
    patch.iconFocusX = body.icon?.focus?.x ?? null;
    patch.iconFocusY = body.icon?.focus?.y ?? null;
  }
  if (body.status !== undefined) {
    patch.status = body.status;
  }
  if (body.isFavorite !== undefined) {
    patch.isFavorite = body.isFavorite;
  }
  if (body.note !== undefined) {
    patch.note = body.note;
  }
  if (body.purchasePrice !== undefined) {
    patch.purchasePrice = body.purchasePrice;
  }
  if (body.salePrice !== undefined) {
    patch.salePrice = body.salePrice;
  }
  if (body.purchasedAt !== undefined) {
    patch.purchasedAt = body.purchasedAt;
  }
  if (body.soldAt !== undefined) {
    patch.soldAt = body.soldAt;
  }
  if (body.warrantyUntil !== undefined) {
    patch.warrantyUntil = body.warrantyUntil;
  }

  const updated = await db
    .update(items)
    .set(patch)
    // 未删除判断必须下推到 where，避免前置检查后发生并发删除时改到墓碑行
    .where(and(eq(items.id, id), eq(items.userId, userId), isNull(items.deletedAt)))
    .returning();

  const row = updated[0];
  if (row === undefined) {
    throw notFound('该物品已删除，无法修改');
  }
  return c.json(toItemDTO(row), 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['items'],
  summary: '删除物品',
  description: '软删除物品；重复删除同一物品时幂等返回首次删除后的记录。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: { params: ItemIdParamSchema },
  responses: {
    200: {
      description: '已删除的物品',
      content: { 'application/json': { schema: ItemDeleteResultSchema } },
    },
    400: jsonError('参数有误'),
    401: jsonError('未通过身份校验'),
    404: jsonError('物品不存在'),
  },
});

app.openapi(deleteRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const current = await findOwnedItem(userId, id);
  if (current.deletedAt !== null) {
    return c.json({ item: toItemDTO(current) }, 200);
  }

  // 目前没有表引用 items，因此无需事务清理关联数据；将来新增引用时必须同步补齐。
  const deleted = await db
    .update(items)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(items.id, id), eq(items.userId, userId), isNull(items.deletedAt)))
    .returning();

  // 并发删除可能使本次 update 无返回；重新读取即可幂等返回先完成的删除结果。
  const row = deleted[0] ?? (await findOwnedItem(userId, id));
  return c.json({ item: toItemDTO(row) }, 200);
});

export default app;
