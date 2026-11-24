/**
 * Bearer 凭证解析：用户鉴权（JWT）和机器鉴权共用同一份规则，避免两处写法分叉。
 * 本文件只做纯解析，不 import config/env.ts、db 或 errors.ts，单元测试不需要环境变量。
 */

/**
 * 从 Authorization 头里取出 Bearer 凭证：用户鉴权（JWT）和机器鉴权共用这一份规则。
 * scheme 不区分大小写，凭证首尾空白忽略。
 *
 * @returns 头缺失或不是 Bearer 时返回 null；是 Bearer 时返回去掉首尾空白后的凭证（可能是空字符串，由调用方决定怎么报错）
 */
export function readBearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice('bearer '.length).trim();
}
