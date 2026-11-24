/**
 * 机器鉴权：只给 yado_hub 调本服务的内部接口（/internal/...）用。
 *
 * 用户在任一芽豆 App 注销时，yado_hub 带着发给本服务的机器凭证调 `DELETE /internal/v1/users/{userId}`。
 * 机器凭证与 Logto 登录无关；本服务只存凭证的 sha256（INTERNAL_MACHINE_TOKENS），比对时用定长比较，避免按耗时猜出哈希。
 * 写法与 yado_hub 的 middleware/machine.ts 一致。本文件不 import config/env.ts（凭证由调用方传入），单元测试不需要环境变量。
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';

import { unauthorized } from '../shared/errors.js';
import type { AppEnv } from '../types.js';

/** 调用方 ID 的格式，与 yado_hub 的机器 ID 规则一致 */
const CALLER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** sha256 的 64 位小写十六进制 */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 解析 INTERNAL_MACHINE_TOKENS：`调用方ID:凭证的 sha256`，逗号分隔，例如 `yado-hub:3f2a…`。
 * 同一调用方可以配多项，换凭证时新旧并存。
 *
 * @returns 凭证哈希 → 调用方 ID；空字符串返回空表（任何机器都不能调）；格式不对返回 null
 */
export function parseMachineTokens(value: string): Map<string, string> | null {
  const tokens = new Map<string, string>();
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (const item of items) {
    const [callerId = '', hash = '', ...rest] = item.split(':');
    if (rest.length > 0 || !CALLER_ID_PATTERN.test(callerId) || !SHA256_HEX_PATTERN.test(hash)) {
      return null;
    }
    tokens.set(hash, callerId);
  }
  return tokens;
}

/** 按凭证找调用方 ID；找不到时返回 null */
function findCaller(tokens: ReadonlyMap<string, string>, token: string): string | null {
  const digest = createHash('sha256').update(token).digest();
  for (const [hash, callerId] of tokens) {
    if (timingSafeEqual(digest, Buffer.from(hash, 'hex'))) {
      return callerId;
    }
  }
  return null;
}

/**
 * 创建机器鉴权中间件：要求请求带有效的机器凭证（`Authorization: Bearer <凭证>`），并把调用方 ID 写入 context 的 machineId。
 * 没配任何凭证时一律 401。
 *
 * @param tokens 凭证哈希 → 调用方 ID，由 parseMachineTokens 解析得到
 */
export function createRequireMachine(tokens: ReadonlyMap<string, string>): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
      throw unauthorized('缺少机器凭证');
    }
    const token = header.slice('bearer '.length).trim();
    const callerId = token.length === 0 ? null : findCaller(tokens, token);
    if (callerId === null) {
      throw unauthorized('机器凭证不对');
    }
    c.set('machineId', callerId);
    await next();
  });
}
