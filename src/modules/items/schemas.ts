/**
 * 物品模块的数据契约。
 *
 * 这里是校验规则、TypeScript 类型与 OpenAPI 文档的唯一来源，
 * 请求契约显式列出客户端可写字段，避免服务端字段意外成为入参。
 */
import { z } from '@hono/zod-openapi';

/** 物品名长度上限，允许容纳品牌、系列与型号 */
const NAME_MAX_LENGTH = 60;

/** 备注长度上限，避免全量列表响应被超长文本放大 */
const NOTE_MAX_LENGTH = 2_000;

/** 图标内容长度上限，兼容 emoji 与内置素材库 key */
const ICON_VALUE_MAX_LENGTH = 256;

/** 照片类图标文件名：App 生成的 UUID 加扩展名 */
const ICON_FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/i;

/** 金额上限，与数据库 numeric(12, 2) 的可表示范围一致 */
const AMOUNT_MAX = 9_999_999_999.99;

/** 物品生命周期状态 */
export const ItemStatusSchema = z.enum(['in_service', 'retired', 'sold']);

/** 物品名称 */
const ItemNameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

/** 可选备注的非空值部分 */
const ItemNoteSchema = z.string().max(NOTE_MAX_LENGTH);

/** 金额保留至多两位小数，防止数据库静默四舍五入 */
const ItemAmountSchema = z
  .number()
  .min(0)
  .max(AMOUNT_MAX)
  .multipleOf(0.01)
  .openapi({ multipleOf: 0.01 });

/** 严格的日历日期，不包含时刻与时区 */
const CalendarDateSchema = z.string().date();

/** 路径参数：物品 ID */
export const ItemIdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: 'id', in: 'path' },
    description: '物品 ID',
    example: '5a8d2c7f-1b3e-4d6a-9c0f-2e4b6a8d0c1f',
  }),
});

/**
 * 图标取景中心。
 *
 * 此 schema 刻意不注册命名组件，与 ItemIconSchema 保持一致。
 */
export const ItemIconFocusSchema = z.object({
  x: z.number().min(0).max(1).openapi({ description: '横向位置，0 为最左', example: 0.5 }),
  y: z.number().min(0).max(1).openapi({ description: '纵向位置，0 为最上', example: 0.5 }),
}).openapi({ description: '取景中心，按图片宽高归一到 0..1，原点在左上角' });

/**
 * 物品图标。
 *
 * 图标类型与内容作为整体出现，避免产生仅有其中一个字段的非法状态。
 * 此 schema 刻意不注册命名组件，确保 OpenAPI 3.0 中 nullable 能正确保留。
 */
export const ItemIconSchema = z
  .object({
    type: z.enum(['emoji', 'preset', 'photo', 'cutout']).openapi({
      description: '图标来源类型',
      example: 'emoji',
    }),
    value: z.string().max(ICON_VALUE_MAX_LENGTH).openapi({
      description:
        'emoji 字符、内置素材库 key；photo/cutout 为 App 生成的文件名 <uuid>.<ext>（服务端校验格式）',
      example: '📷',
    }),
    focus: ItemIconFocusSchema.nullable().optional().openapi({
      description: '取景中心，只对照片类图标有意义，未设置为 null',
    }),
  })
  .superRefine((icon, ctx) => {
    // 照片类图标的 value 将来会作为对象存储 key，入库前必须保证格式
    if ((icon.type === 'photo' || icon.type === 'cutout') && !ICON_FILE_NAME_PATTERN.test(icon.value)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'photo/cutout 的 value 必须是 <uuid>.<ext> 格式的文件名',
      });
    }
  });

/** 对外输出的物品结构 */
export const ItemSchema = z
  .object({
    id: z.string().uuid(),
    name: ItemNameSchema.openapi({ description: '物品名称', example: '富士 X100VI' }),
    categoryId: z
      .string()
      .uuid()
      .nullable()
      .openapi({ description: '所属分类 ID，未分类为 null' }),
    icon: ItemIconSchema.nullable().openapi({ description: '物品图标，未设置为 null' }),
    status: ItemStatusSchema.openapi({
      description: '生命周期状态',
      example: 'in_service',
    }),
    isFavorite: z.boolean().openapi({ description: '是否收藏', example: false }),
    note: ItemNoteSchema.nullable().openapi({ description: '备注，未设置为 null' }),
    purchasePrice: ItemAmountSchema.nullable().openapi({
      description: '购入金额，未设置为 null',
      example: 12_999.99,
    }),
    salePrice: ItemAmountSchema.nullable().openapi({
      description: '卖出金额，未设置为 null',
      example: 10_000,
    }),
    purchasedAt: CalendarDateSchema.nullable().openapi({
      description: '入手日期（YYYY-MM-DD），未设置为 null',
      example: '2026-07-31',
    }),
    soldAt: CalendarDateSchema.nullable().openapi({
      description: '卖出日期（YYYY-MM-DD），未设置为 null',
      example: '2026-08-03',
    }),
    warrantyUntil: CalendarDateSchema.nullable().openapi({
      description: '保修截止日期（YYYY-MM-DD），未设置为 null',
      example: '2028-07-31',
    }),
    createdAt: z.string().datetime().openapi({ description: '创建时刻（ISO 8601 UTC）' }),
    updatedAt: z.string().datetime().openapi({ description: '最后更新时刻' }),
    deletedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({ description: '删除时刻，未删除为 null' }),
  })
  .openapi('Item');

export type ItemDTO = z.infer<typeof ItemSchema>;

/** 列表响应 */
export const ItemListSchema = z
  .object({
    items: z.array(ItemSchema),
  })
  .openapi('ItemList');

/**
 * 创建请求。
 *
 * 仅名称必填；允许客户端传入 id 以支持离线创建与安全重传。
 * 可空字段传 null 与不传都表示尚未设置。
 */
export const ItemCreateSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .openapi({ description: '客户端可自行生成，用于离线创建与安全重传' }),
    name: ItemNameSchema.openapi({ example: '富士 X100VI' }),
    categoryId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .openapi({
        description:
          '所属分类 ID；分类不存在、已删除或不属于本人时按未分类（null）保存，不报错，以返回的 categoryId 为准',
      }),
    icon: ItemIconSchema.nullable().optional().openapi({ description: '物品图标' }),
    status: ItemStatusSchema.optional().openapi({ description: '不传默认为 in_service' }),
    isFavorite: z.boolean().optional().openapi({ description: '不传默认为 false' }),
    note: ItemNoteSchema.nullable().optional(),
    purchasePrice: ItemAmountSchema.nullable().optional(),
    salePrice: ItemAmountSchema.nullable().optional(),
    purchasedAt: CalendarDateSchema.nullable().optional(),
    soldAt: CalendarDateSchema.nullable().optional(),
    warrantyUntil: CalendarDateSchema.nullable().optional(),
  })
  .openapi('ItemCreate');

/** 更新请求：字段缺席表示不修改，传 null 表示清空可空字段 */
export const ItemUpdateSchema = z
  .object({
    name: ItemNameSchema.optional(),
    categoryId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .openapi({ description: '同创建：分类无效时按未分类（null）保存，以返回值为准' }),
    icon: ItemIconSchema.nullable().optional(),
    status: ItemStatusSchema.optional(),
    isFavorite: z.boolean().optional(),
    note: ItemNoteSchema.nullable().optional(),
    purchasePrice: ItemAmountSchema.nullable().optional(),
    salePrice: ItemAmountSchema.nullable().optional(),
    purchasedAt: CalendarDateSchema.nullable().optional(),
    soldAt: CalendarDateSchema.nullable().optional(),
    warrantyUntil: CalendarDateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少需要一个待更新字段' })
  .openapi('ItemUpdate', { minProperties: 1 });

/** 删除响应：返回软删除后的记录 */
export const ItemDeleteResultSchema = z
  .object({
    item: ItemSchema,
  })
  .openapi('ItemDeleteResult');
