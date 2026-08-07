/**
 * 分类模块的数据契约。
 *
 * 这里是校验规则、TypeScript 类型与 OpenAPI 文档的唯一来源，
 * 其他文件不再重复声明同一份数据形状。
 *
 * 本期分类不含图标：列表靠名称与顺序区分即可，图标只有物品需要。
 */
import { z } from '@hono/zod-openapi';

/** 分类名长度上限，够放中英文短词即可 */
const NAME_MAX_LENGTH = 30;

/**
 * 单次整体排序可提交的分类数量上限。
 *
 * 个人分类预计为几十条，500 为异常客户端和滥用请求设置明确边界，
 * 同时为未来扩展保留足够余量。
 */
const CATEGORY_ORDER_MAX_SIZE = 500;

/**
 * sortOrder 由服务端维护，存储上限取 Postgres integer 的最大值。
 * 新建分类追加到末尾时若已有记录到达上限，不再继续加一，避免数据库报 out of range。
 */
export const SORT_ORDER_MAX = 2_147_483_647;

/** 路径参数：分类 ID */
export const CategoryIdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: 'id', in: 'path' },
    description: '分类 ID',
    example: '3f7c1b8e-2a4d-4f6b-8c0e-1d2a3b4c5d6e',
  }),
});

/** 对外输出的分类结构 */
export const CategorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().openapi({ description: '分类名称', example: '数码' }),
    sortOrder: z.number().int().openapi({ description: '展示顺序，越小越靠前', example: 0 }),
    createdAt: z.string().datetime().openapi({ description: '创建时刻（ISO 8601 UTC）' }),
    updatedAt: z.string().datetime().openapi({ description: '最后更新时刻' }),
    deletedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({ description: '删除时刻，未删除为 null' }),
  })
  .openapi('Category');

export type CategoryDTO = z.infer<typeof CategorySchema>;

/** 列表响应 */
export const CategoryListSchema = z
  .object({
    categories: z.array(CategorySchema),
  })
  .openapi('CategoryList');

/**
 * 分类整体排序请求。
 *
 * categoryIds 表示服务端当前全部未删除分类的最终展示顺序，必须完整且不重复。
 * 与服务端当前集合不一致时整次请求以 409 拒绝，不做部分排序：
 * 否则客户端用过期列表提交时，会把它还不知道的分类挤到不可预期的位置。
 *
 * 但这不是绝对保证：服务端用行锁串行并发排序，而行锁拦不住并发 INSERT。
 * 另一端的新建若恰好落在加锁之后，该分类不参与本次重排、按创建规则留在末尾，
 * 请求仍返回 200。这个窗口极窄且结果无害——提交的相对顺序仍被完整应用，
 * 因此不引入 advisory lock 或 SERIALIZABLE 去消除它（代价是给创建路径加锁或处理
 * 序列化失败重试）。响应统一返回排序后的全量列表，客户端整体替换即可。
 */
export const CategoryOrderUpdateSchema = z
  .object({
    categoryIds: z
      .array(z.string().uuid())
      .max(CATEGORY_ORDER_MAX_SIZE)
      .refine((ids) => new Set(ids).size === ids.length, { message: '分类 ID 不能重复' })
      .openapi({ description: '服务端当前全部未删除分类的 ID，数组顺序即最终展示顺序' }),
  })
  .strict()
  .openapi('CategoryOrderUpdate');

/**
 * 创建请求。
 *
 * 允许客户端生成并传入 id，以支持离线先建后传；重复提交同一 id 时按幂等处理。
 */
export const CategoryCreateSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .openapi({ description: '客户端可自行生成，用于离线创建与安全重传' }),
    name: z.string().trim().min(1).max(NAME_MAX_LENGTH).openapi({ example: '电竞' }),
  })
  .strict()
  .openapi('CategoryCreate');

/** 更新请求：分类顺序只允许通过整体排序接口修改 */
export const CategoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  })
  .strict()
  .openapi('CategoryUpdate');

/** 删除响应：返回软删除后的记录 */
export const CategoryDeleteResultSchema = z
  .object({
    category: CategorySchema,
  })
  .openapi('CategoryDeleteResult');
