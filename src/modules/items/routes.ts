/**
 * 物品模块路由。
 *
 * 所有查询都强制按当前用户过滤，删除一律采用软删除。
 */
import { createRoute } from '@hono/zod-openapi';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, items, type ItemRow } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest } from '../../shared/errors.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import {
  ItemCreateSchema,
  ItemListSchema,
  ItemSchema,
  type ItemDTO,
} from './schemas.js';

/** 把数据库图标列转换为对外的嵌套图标结构 */
function toItemIcon(row: ItemRow): ItemDTO['icon'] {
  if (row.iconType === null && row.iconValue === null) {
    return null;
  }

  if (
    (row.iconType === 'emoji' || row.iconType === 'preset') &&
    row.iconValue !== null
  ) {
    return { type: row.iconType, value: row.iconValue };
  }

  throw new Error(`物品 ${row.id} 的图标数据不符合契约`);
}

/** 把数据库状态收窄为接口契约允许的取值 */
function toItemStatus(row: ItemRow): ItemDTO['status'] {
  if (row.status === 'in_service' || row.status === 'retired' || row.status === 'sold') {
    return row.status;
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

/** 确认分类属于当前用户且尚未删除 */
async function assertOwnedCategory(userId: string, categoryId: string): Promise<void> {
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

  if (rows[0] === undefined) {
    throw badRequest('分类不存在或已删除');
  }
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
  description: '允许客户端传入自行生成的 id；重复提交同一 id 时幂等返回已有记录。',
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
    400: jsonError('参数有误、分类无效或 id 已被占用'),
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(createItemRoute, async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  if (body.categoryId !== undefined && body.categoryId !== null) {
    await assertOwnedCategory(userId, body.categoryId);
  }

  const inserted = await db
    .insert(items)
    .values({
      ...(body.id === undefined ? {} : { id: body.id }),
      userId,
      name: body.name,
      categoryId: body.categoryId ?? null,
      iconType: body.icon?.type ?? null,
      iconValue: body.icon?.value ?? null,
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

export default app;
