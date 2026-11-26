/**
 * 内部接口的数据契约（只给 yado_hub 用，不进给 App 的 openapi.json）。
 */
import { z } from '@hono/zod-openapi';

/** 内部接口的路径参数：要删除或汇总数据的用户 */
export const InternalUserParamsSchema = z.object({
  userId: z
    .string()
    .min(1)
    .max(128)
    .openapi({ param: { name: 'userId', in: 'path' }, description: 'Logto 用户 ID（JWT 的 sub）' }),
});

/** 删除成功的响应；没有数据或重复调用也返回同样的内容 */
export const InternalUserDeletionSchema = z
  .object({
    deleted: z.literal(true).openapi({ description: '这个用户在芽豆有物的云端数据已删除，并已记入注销名单' }),
  })
  .openapi('InternalUserDeletion');

export type InternalUserDeletionDTO = z.infer<typeof InternalUserDeletionSchema>;

/**
 * 注销前数据汇总的响应：用户在本服务里会被删掉的数据量，yado_hub 汇总后显示在注销确认页。
 * 数量为 0 也照样返回一项，由 hub 决定要不要展示。
 */
export const InternalUserSummarySchema = z
  .object({
    items: z
      .array(
        z.object({
          key: z.string().openapi({ description: '数据项标识，固定为 items（未删除的物品件数）' }),
          count: z.number().int().nonnegative().openapi({ description: '数量，非负整数' }),
        }),
      )
      .openapi({ description: '本服务的数据项及数量' }),
  })
  .openapi('InternalUserSummary');

export type InternalUserSummaryDTO = z.infer<typeof InternalUserSummarySchema>;

/**
 * 物品购入价汇总的响应，给 yado_hub 的数据联动用：只有汇总数，没有任何物品明细。
 * 金额用两位小数的字符串而不是 number，避免浮点误差，也让上游原样透传。
 */
export const InternalItemValueSummarySchema = z
  .object({
    inServicePurchaseTotal: z
      .string()
      .regex(/^\d+\.\d{2}$/)
      .openapi({ description: '在用（in_service）物品的购入价合计，固定两位小数，例如 "1234.50"；没有数据时为 "0.00"' }),
    retiredPurchaseTotal: z
      .string()
      .regex(/^\d+\.\d{2}$/)
      .openapi({ description: '退役（retired）物品的购入价合计，固定两位小数；没有数据时为 "0.00"' }),
    pricedItemCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: '填了购入价的在用和退役物品件数，购入价为 0 元也算填了' }),
    unpricedItemCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: '没填购入价的在用和退役物品件数，这些物品不参与合计' }),
    lastItemUpdatedAt: z
      .string()
      .nullable()
      .openapi({ description: '参与汇总的物品里最近一次更新的时刻，ISO 8601（UTC）；没有物品时为 null' }),
  })
  .openapi('InternalItemValueSummary');

export type InternalItemValueSummaryDTO = z.infer<typeof InternalItemValueSummarySchema>;
