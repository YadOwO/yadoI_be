/**
 * 物品模块路由。
 *
 * 所有查询都强制按 userId 过滤，保证用户只能访问自己的数据。
 * 删除采用软删除（写入 deletedAt），使删除动作能够同步到其他端。
 */
import { createRoute } from '@hono/zod-openapi';
import { and, desc, eq, gt, isNull, type SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { items as itemsTable, type ItemRow } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError, ErrorCode, badRequest, notFound } from '../../shared/errors.js';
import { createApp } from '../../shared/openapi.js';
import {
  CreateItemSchema,
  DeleteItemResponseSchema,
  ErrorSchema,
  ItemIdParamSchema,
  ItemSchema,
  ListItemsQuerySchema,
  ListItemsResponseSchema,
  UpdateItemSchema,
} from './schemas.js';

/** 数据库行转为对外 DTO：时间统一输出 ISO 8601 */
function toItemDTO(row: ItemRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  };
}

const jsonError = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorSchema } },
});

const app = createApp();

// 鉴权中间件绑定在每个路由定义上（见各 createRoute 的 middleware 字段）。
// 不使用 app.use('/*', ...) 挂载：子应用挂载到 /v1/items 后，'/*' 只匹配
// /v1/items/xxx 而不匹配 /v1/items 本身，会导致列表接口绕过鉴权。

/* ------------------------------- 查询列表 ------------------------------- */

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Items'],
  summary: '查询物品列表',
  description:
    '按更新时间倒序返回当前用户的物品。增量同步时传 updatedSince 并将 includeDeleted 设为 true，以便同步删除动作。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: { query: ListItemsQuerySchema },
  responses: {
    200: {
      description: '查询成功',
      content: { 'application/json': { schema: ListItemsResponseSchema } },
    },
    400: jsonError('参数错误'),
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(listRoute, async (c) => {
  const userId = c.get('userId');
  const { limit, offset, updatedSince, includeDeleted } = c.req.valid('query');

  const conditions: SQL[] = [eq(itemsTable.userId, userId)];
  if (!includeDeleted) {
    const notDeleted = isNull(itemsTable.deletedAt);
    conditions.push(notDeleted);
  }
  if (updatedSince !== undefined) {
    conditions.push(gt(itemsTable.updatedAt, new Date(updatedSince)));
  }

  const rows = await db
    .select()
    .from(itemsTable)
    .where(and(...conditions))
    .orderBy(desc(itemsTable.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items: rows.map(toItemDTO) }, 200);
});

/* ------------------------------- 创建物品 ------------------------------- */

const createItemRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Items'],
  summary: '创建物品',
  description:
    '客户端可自行生成并传入 id（UUID v4）以支持离线创建；重复提交同一 id 时幂等返回已存在的记录。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateItemSchema } }, required: true },
  },
  responses: {
    201: { description: '创建成功', content: { 'application/json': { schema: ItemSchema } } },
    400: jsonError('参数错误'),
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(createItemRoute, async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const inserted = await db
    .insert(itemsTable)
    .values({ id: body.id, userId, name: body.name })
    .onConflictDoNothing({ target: itemsTable.id })
    .returning();

  const row = inserted[0];
  if (row !== undefined) {
    return c.json(toItemDTO(row), 201);
  }

  // 走到这里说明 id 已存在：若属于当前用户则幂等返回，否则视为非法请求
  const providedId = body.id;
  if (providedId === undefined) {
    throw new AppError(500, ErrorCode.Internal, '创建物品失败');
  }

  const existing = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.id, providedId), eq(itemsTable.userId, userId)))
    .limit(1);

  const existingRow = existing[0];
  if (existingRow === undefined) {
    throw badRequest('该物品 ID 已被占用');
  }
  return c.json(toItemDTO(existingRow), 201);
});

/* ------------------------------- 查询详情 ------------------------------- */

const getItemRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Items'],
  summary: '查询物品详情',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: { params: ItemIdParamSchema },
  responses: {
    200: { description: '查询成功', content: { 'application/json': { schema: ItemSchema } } },
    401: jsonError('未通过身份校验'),
    404: jsonError('物品不存在'),
  },
});

app.openapi(getItemRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const rows = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.id, id), eq(itemsTable.userId, userId), isNull(itemsTable.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw notFound('物品不存在');
  }
  return c.json(toItemDTO(row), 200);
});

/* ------------------------------- 更新物品 ------------------------------- */

const updateItemRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Items'],
  summary: '更新物品',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: {
    params: ItemIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateItemSchema } }, required: true },
  },
  responses: {
    200: { description: '更新成功', content: { 'application/json': { schema: ItemSchema } } },
    400: jsonError('参数错误'),
    401: jsonError('未通过身份校验'),
    404: jsonError('物品不存在'),
  },
});

app.openapi(updateItemRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  if (body.name === undefined) {
    throw badRequest('没有需要更新的字段');
  }

  const updated = await db
    .update(itemsTable)
    .set({ name: body.name, updatedAt: new Date() })
    .where(and(eq(itemsTable.id, id), eq(itemsTable.userId, userId), isNull(itemsTable.deletedAt)))
    .returning();

  const row = updated[0];
  if (row === undefined) {
    throw notFound('物品不存在');
  }
  return c.json(toItemDTO(row), 200);
});

/* ------------------------------- 删除物品 ------------------------------- */

const deleteItemRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Items'],
  summary: '删除物品（软删除）',
  description: '写入 deletedAt 而非物理删除，保留墓碑记录以便把删除动作同步到其他端。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  request: { params: ItemIdParamSchema },
  responses: {
    200: {
      description: '删除成功',
      content: { 'application/json': { schema: DeleteItemResponseSchema } },
    },
    401: jsonError('未通过身份校验'),
    404: jsonError('物品不存在'),
  },
});

app.openapi(deleteItemRoute, async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const now = new Date();

  const deleted = await db
    .update(itemsTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(itemsTable.id, id), eq(itemsTable.userId, userId), isNull(itemsTable.deletedAt)))
    .returning();

  const row = deleted[0];
  if (row !== undefined) {
    return c.json({ id: row.id, deletedAt: (row.deletedAt ?? now).toISOString() }, 200);
  }

  // 已删除过则幂等返回，确保客户端重传删除请求不会失败
  const existing = await db
    .select()
    .from(itemsTable)
    .where(and(eq(itemsTable.id, id), eq(itemsTable.userId, userId)))
    .limit(1);

  const existingRow = existing[0];
  if (existingRow?.deletedAt == null) {
    throw notFound('物品不存在');
  }
  return c.json({ id: existingRow.id, deletedAt: existingRow.deletedAt.toISOString() }, 200);
});

export default app;
