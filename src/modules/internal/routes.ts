/**
 * 内部接口，挂在 /internal/v1/users 下，只给 yado_hub 调。
 *
 * 用户在任一芽豆 App 注销时，由 yado_hub 统一编排：它依次调各服务的 `DELETE /internal/v1/users/{userId}`，
 * 全部成功后才删除 Logto 用户。这里用机器凭证鉴权（INTERNAL_MACHINE_TOKENS），不是 Logto 登录；
 * 不经公网（服务器 nginx 拒绝 /internal/），不进给 App 的 openapi.json（hide）。
 * 这是整个服务里唯一做物理删除的地方；删除对象由 yado_hub 在路径里指定，所以只认机器凭证，绝不能挂到给 App 的路由下。
 */
import { createRoute } from '@hono/zod-openapi';

import { env } from '../../config/env.js';
import { createRequireMachine } from '../../middleware/machine.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import { InternalUserDeletionSchema, InternalUserParamsSchema, type InternalUserDeletionDTO } from './schemas.js';
import { deleteUserData } from './service.js';

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

export default app;
