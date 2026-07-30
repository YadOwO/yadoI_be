/**
 * 物品模块的数据契约（Zod schema）。
 *
 * 这里是唯一的契约来源：同时用于运行时参数校验、TypeScript 类型推导，
 * 以及生成 OpenAPI 文档（再由 OpenAPI 生成 iOS / Web 客户端代码）。
 */
import { z } from '@hono/zod-openapi';

const isoDateTime = () => z.string().openapi({ format: 'date-time', example: '2026-07-30T02:00:00.000Z' });

/** 物品对外表示 */
export const ItemSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '2f1c8e0a-6b3d-4f5a-9c7e-8d1b2a3c4d5e' }),
    name: z.string().openapi({ example: 'MacBook Pro 14' }),
    createdAt: isoDateTime(),
    updatedAt: isoDateTime(),
    /** 非空表示已删除，客户端据此在本地移除该记录 */
    deletedAt: isoDateTime().nullable(),
  })
  .openapi('Item');

/** 列表查询参数 */
export const ListItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).openapi({ example: 50 }),
  offset: z.coerce.number().int().min(0).default(0).openapi({ example: 0 }),
  /** 增量同步游标：只返回该时刻之后更新过的记录 */
  updatedSince: z.string().datetime().optional().openapi({ example: '2026-07-30T02:00:00.000Z' }),
  /** 是否包含已软删除的记录，增量同步时应为 true 才能同步删除动作 */
  includeDeleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .openapi({ example: 'false' }),
});

export const ListItemsResponseSchema = z
  .object({
    items: z.array(ItemSchema),
  })
  .openapi('ListItemsResponse');

/**
 * 创建物品请求。
 *
 * id 允许由客户端提供：离线场景下客户端先在本地生成 UUID 并渲染，
 * 联网后再上传，保证同一条记录在所有端拥有一致的稳定标识。
 */
export const CreateItemSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200).openapi({ example: 'MacBook Pro 14' }),
  })
  .openapi('CreateItemRequest');

export const UpdateItemSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
  })
  .openapi('UpdateItemRequest');

export const ItemIdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: 'id', in: 'path' },
    example: '2f1c8e0a-6b3d-4f5a-9c7e-8d1b2a3c4d5e',
  }),
});

export const DeleteItemResponseSchema = z
  .object({
    id: z.string().uuid(),
    deletedAt: isoDateTime(),
  })
  .openapi('DeleteItemResponse');

/** 错误响应，与全局 onError 输出保持一致 */
export const ErrorSchema = z
  .object({
    code: z.string().openapi({ example: 'NOT_FOUND' }),
    message: z.string().openapi({ example: '资源不存在' }),
    details: z.unknown().optional(),
  })
  .openapi('Error');
