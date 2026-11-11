/**
 * 鉴权中间件：校验 Logto 签发的 JWT。
 *
 * 采用 JWKS 远程公钥验签（非对称），本服务不持有任何签名私钥，
 * 也不需要在每次请求时回调 Logto。jose 会自动缓存并按需刷新公钥。
 */
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { deletedUsers } from '../db/schema.js';
import { unauthorized } from '../shared/errors.js';
import type { AppEnv } from '../types.js';

type RemoteJWKSet = ReturnType<typeof createRemoteJWKSet>;

let jwksCache: RemoteJWKSet | null = null;

/**
 * 延迟初始化 JWKS，避免开发态免鉴权时仍要求 Logto 地址可用。
 */
function getJwks(): RemoteJWKSet {
  if (jwksCache === null) {
    jwksCache = createRemoteJWKSet(new URL(env.logtoJwksUrl));
  }
  return jwksCache;
}

/** 从 Authorization 头中提取 Bearer token */
function extractBearerToken(header: string | undefined): string {
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
    throw unauthorized('缺少 Bearer token');
  }
  const token = header.slice('bearer '.length).trim();
  if (token.length === 0) {
    throw unauthorized('Bearer token 为空');
  }
  return token;
}

/**
 * 解析请求的用户标识：开发态免鉴权返回固定用户，否则校验 Bearer JWT 并返回 sub。
 * 不查注销名单，由调用方决定是否检查。
 */
async function resolveUserId(c: Context<AppEnv>): Promise<string> {
  if (env.isDevAuthBypassEnabled) {
    return env.AUTH_DEV_USER_ID;
  }

  const token = extractBearerToken(c.req.header('Authorization'));

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: env.LOGTO_ISSUER,
      audience: env.LOGTO_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw unauthorized('token 中缺少 sub');
    }
    return payload.sub;
  } catch (error) {
    // 区分"配置/网络问题"与"token 无效"，便于排查；对外统一返回 401
    console.warn('JWT 校验失败：', error instanceof Error ? error.message : String(error));
    throw unauthorized();
  }
}

/**
 * 要求请求已认证，并把用户标识写入 context。
 *
 * JWT 是离线验签的，Logto 删除用户后旧 token 仍能通过验签，
 * 所以验签后还要查注销名单，命中则拒绝（开发态免鉴权时也查）。
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const userId = await resolveUserId(c);
  const [deleted] = await db
    .select({ userId: deletedUsers.userId })
    .from(deletedUsers)
    .where(eq(deletedUsers.userId, userId))
    .limit(1);
  if (deleted !== undefined) {
    throw unauthorized();
  }
  c.set('userId', userId);
  await next();
});

/**
 * 只验签、不查注销名单的鉴权，仅供 DELETE /v1/account 使用，使已注销的用户可以重试。
 */
export const requireAuthIncludingDeleted = createMiddleware<AppEnv>(async (c, next) => {
  c.set('userId', await resolveUserId(c));
  await next();
});
