/**
 * 账号模块路由。
 *
 * 这里是整个服务里唯一做物理删除的地方：用户注销账号时，物理删除其全部业务数据。
 * 删除对象只由鉴权中间件写入的 userId 决定，接口不接收任何用户标识。
 */
import { createRoute } from '@hono/zod-openapi';

import { requireAuth } from '../../middleware/auth.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import { deleteAccountData } from './service.js';

const app = createApp();

/** 注销账号：没有请求体和响应体，成功（含无数据、重复调用）一律返回 204 */
const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/',
  tags: ['account'],
  summary: '注销账号',
  description:
    '物理删除当前用户在芽豆有物的全部云端数据（物品、分类，含已删除的记录），不删除 Logto 账号。可重复调用，每次都返回 204。',
  middleware: [requireAuth] as const,
  security: [{ Bearer: [] }],
  responses: {
    204: { description: '已删除当前用户的全部云端数据（没有数据或重复调用同样返回）' },
    401: jsonError('未通过身份校验'),
  },
});

app.openapi(deleteAccountRoute, async (c) => {
  await deleteAccountData(c.get('userId'));
  return c.body(null, 204);
});

export default app;
