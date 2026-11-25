/**
 * 内部接口，挂在 /internal/v1/users 下，只给 yado_hub 调。
 *
 * 用户在任一芽豆 App 注销时，由 yado_hub 统一编排：它依次调各服务的 `DELETE /internal/v1/users/{userId}`，
 * 全部成功后才删除 Logto 用户；注销确认页要显示各产品的数据量，hub 先调 `GET /internal/v1/users/{userId}/summary`（只读）。
 * 这里用机器凭证鉴权（INTERNAL_MACHINE_TOKENS），不是 Logto 登录；
 * 不经公网（服务器 nginx 拒绝 /internal/），不进给 App 的 openapi.json（hide）。
 * 这是整个服务里唯一做物理删除的地方；删除对象由 yado_hub 在路径里指定，所以只认机器凭证，绝不能挂到给 App 的路由下。
 */
import { createRoute } from '@hono/zod-openapi';

import { env } from '../../config/env.js';
import { createRequireMachine } from '../../middleware/machine.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import {
  InternalUserDeletionSchema,
  InternalUserParamsSchema,
  InternalUserSummarySchema,
  type InternalUserDeletionDTO,
  type InternalUserSummaryDTO,
} from './schemas.js';
import { countUserItems, deleteUserData } from './service.js';

const app = createApp();

/** 只放行 yado_hub 的机器凭证 */
const requireMachine = createRequireMachine(env.internalMachineTokens);

/** 删除用户数据的契约（不进 openapi.json） */
const deleteUserRoute = createRoute({
  method: 'delete',
  path: '/{userId}',
  hide: true,
  tags: ['internal'],
  summary: '删除用户在芽豆有物的云端数据（注销账号）',
  description:
    '写入注销名单，并物理删除这个用户在芽豆有物的全部云端数据（物品、分类，含已删除的记录），之后该用户的旧 token 一律返回 401。' +
    '可重复调用，没有数据也返回 200。只给 yado_hub 用，机器凭证鉴权。',
  middleware: [requireMachine] as const,
  request: { params: InternalUserParamsSchema },
  responses: {
    200: {
      description: '已删除',
      content: { 'application/json': { schema: InternalUserDeletionSchema } },
    },
    400: jsonError('参数校验失败'),
    401: jsonError('机器凭证不对'),
  },
});

/** 查询用户注销前数据汇总的契约（不进 openapi.json），只读，没有任何写操作和副作用 */
const summaryRoute = createRoute({
  method: 'get',
  path: '/{userId}/summary',
  hide: true,
  tags: ['internal'],
  summary: '查询用户在芽豆有物的数据汇总（注销前确认）',
  description:
    '返回这个用户还没删除的物品件数（已删除的不算，分类不统计），供 yado_hub 在注销确认页显示。完全只读，不写任何数据。' +
    '没有数据也返回 200，count 为 0。只给 yado_hub 用，机器凭证鉴权。',
  middleware: [requireMachine] as const,
  request: { params: InternalUserParamsSchema },
  responses: {
    200: {
      description: '数据汇总',
      content: { 'application/json': { schema: InternalUserSummarySchema } },
    },
    400: jsonError('参数校验失败'),
    401: jsonError('机器凭证不对'),
  },
});

app.openapi(deleteUserRoute, async (c) => {
  const { userId } = c.req.valid('param');
  const startedAt = Date.now();
  // 数据库出错不在这里 catch，交给全局 handleError 返回 500，yado_hub 据此中止注销
  await deleteUserData(userId);
  console.log(
    JSON.stringify({ event: 'internal_user_deleted', userId, caller: c.get('machineId'), ms: Date.now() - startedAt }),
  );
  const body: InternalUserDeletionDTO = { deleted: true };
  return c.json(body, 200);
});

app.openapi(summaryRoute, async (c) => {
  const { userId } = c.req.valid('param');
  const startedAt = Date.now();
  // 数据库出错不在这里 catch，交给全局 handleError 返回 500，yado_hub 据此把这一项标为「暂时查不到」
  const count = await countUserItems(userId);
  // 日志只记用户、调用方与耗时，不记件数
  console.log(
    JSON.stringify({ event: 'internal_user_summary', userId, caller: c.get('machineId'), ms: Date.now() - startedAt }),
  );
  const body: InternalUserSummaryDTO = { items: [{ key: 'items', count }] };
  return c.json(body, 200);
});

export default app;
