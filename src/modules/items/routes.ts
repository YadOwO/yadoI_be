/**
 * 物品模块路由。
 *
 * 所有查询都强制按当前用户过滤，删除一律采用软删除。
 */
import { createRoute } from '@hono/zod-openapi';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { items, type ItemRow } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import { ItemListSchema, type ItemDTO } from './schemas.js';

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

export default app;
