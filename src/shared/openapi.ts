/**
 * OpenAPIHono 应用工厂。
 *
 * 统一注入 defaultHook，使 Zod 参数校验失败时也返回平台约定的错误结构，
 * 而不是 Hono 默认的校验错误格式。
 */
import { OpenAPIHono } from '@hono/zod-openapi';

import { badRequest } from './errors.js';
import type { AppEnv } from '../types.js';

export function createApp(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw badRequest('请求参数校验失败', result.error.issues);
      }
    },
  });
}
