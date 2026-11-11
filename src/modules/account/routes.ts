/**
 * 账号模块路由。
 *
 * 这里是整个服务里唯一做物理删除的地方：用户注销账号时，先删除 Logto 用户，
 * 再写注销名单并物理删除其全部业务数据。
 * 删除对象只由鉴权中间件写入的 userId 决定，接口不接收任何用户标识。
 */
import { createRoute } from '@hono/zod-openapi';

import { requireAuthIncludingDeleted } from '../../middleware/auth.js';
import { createApp, jsonError } from '../../shared/openapi.js';
import { deleteAccount } from './service.js';

const app = createApp();

/** 注销账号：没有请求体和响应体，成功（含无数据、重复调用）一律返回 204 */
const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/',
  tags: ['account'],
  summary: '永久注销芽豆账号（不可撤销）',
  description:
    '永久删除芽豆账号（Logto 用户），并物理删除当前用户在芽豆有物的全部云端数据（物品、分类，含已删除的记录），操作不可撤销。' +
    '芽豆系列所有 App 共用这一个账号，注销后在所有芽豆 App 里都无法再用它登录，之后旧 token 一律返回 401。' +
    '可重复调用（用于失败重试），每次都返回 204。' +
    'App 端必须先二次确认，用醒目的警示文案写明以上后果。',
  // 只验签、不查注销名单，保证已注销的用户（例如上次 Logto 已删但事务失败）可以重试
  middleware: [requireAuthIncludingDeleted] as const,
  security: [{ Bearer: [] }],
  responses: {
    204: { description: '账号已注销，云端数据已全部删除（没有数据或重复调用同样返回）' },
    401: jsonError('未通过身份校验'),
    502: jsonError('Logto 删除用户失败，可重试'),
    503: jsonError('注销服务尚未配置'),
  },
});

app.openapi(deleteAccountRoute, async (c) => {
  await deleteAccount(c.get('userId'));
  return c.body(null, 204);
});

export default app;
