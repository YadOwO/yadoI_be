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
 * sortOrder 的上限取 Postgres integer 的最大值。
 * 不加上限的话，超范围的数值会通过校验、到数据库才报 out of range 变成 500，
 * 非法输入应当在校验层就拦成 400。这里不额外施加业务约束，
 * 以便客户端采用大间隔排序（如 1000、2000）等策略。
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
    sortOrder: z
      .number()
      .int()
      .min(0)
      .max(SORT_ORDER_MAX)
      .optional()
      .openapi({ description: '不传则排在最后' }),
  })
  .openapi('CategoryCreate');

/** 更新请求：只更新传了的字段 */
export const CategoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX_LENGTH).optional(),
    sortOrder: z.number().int().min(0).max(SORT_ORDER_MAX).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少需要一个待更新字段' })
  .openapi('CategoryUpdate');

/** 删除响应：返回软删除后的记录 */
export const CategoryDeleteResultSchema = z
  .object({
    category: CategorySchema,
  })
  .openapi('CategoryDeleteResult');
