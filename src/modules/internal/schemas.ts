/**
 * 内部接口的数据契约（只给 yado_hub 用，不进给 App 的 openapi.json）。
 */
import { z } from '@hono/zod-openapi';

/** 内部删除接口的路径参数：要删除的用户 */
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
