/**
 * Logto Management API 客户端。
 *
 * 只实现注销账号需要的「删除用户」。用 Machine-to-Machine 应用的 client_credentials
 * 换取 access token，缓存在进程内，到期前 60 秒重新获取。日志只记录状态码和错误名，
 * 不记录 token 与密钥。
 */
import { env } from '../config/env.js';
import { logtoUpstreamError, serviceNotConfigured } from './errors.js';

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 10_000;

/** token 提前多少毫秒视为过期，避免用到刚好失效的 token */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/** 缓存的 M2M access token */
let cachedToken: { value: string; expiresAt: number } | null = null;

/** 从 unknown 响应体中收窄出 access_token 与 expires_in */
function parseTokenResponse(body: unknown): { accessToken: string; expiresIn: number } | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const accessToken: unknown = 'access_token' in body ? body.access_token : undefined;
  const expiresIn: unknown = 'expires_in' in body ? body.expires_in : undefined;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null;
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
    return null;
  }
  return { accessToken, expiresIn };
}

/** 记录上游错误，只含状态码或错误名 */
function logUpstream(step: string, detail: string): void {
  console.error(`Logto Management API 调用失败（${step}）：${detail}`);
}

/** 获取可用的 Management API access token */
async function getManagementToken(): Promise<string> {
  const config = env.logtoManagement;
  if (config === null) {
    throw serviceNotConfigured();
  }
  if (cachedToken !== null && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  let response: Response;
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        resource: config.resource,
        scope: 'all',
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logUpstream('获取 token', error instanceof Error ? error.name : 'UnknownError');
    throw logtoUpstreamError();
  }

  if (!response.ok) {
    logUpstream('获取 token', `HTTP ${response.status}`);
    throw logtoUpstreamError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logUpstream('解析 token 响应', error instanceof Error ? error.name : 'UnknownError');
    throw logtoUpstreamError();
  }
  const token = parseTokenResponse(body);
  if (token === null) {
    logUpstream('解析 token 响应', '缺少 access_token 或 expires_in');
    throw logtoUpstreamError();
  }

  cachedToken = {
    value: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  };
  return token.accessToken;
}

/**
 * 删除 Logto 用户。204 与 404（已删除）都算成功，其他情况抛 502；未配置凭证抛 503。
 */
export async function deleteLogtoUser(userId: string): Promise<void> {
  const config = env.logtoManagement;
  if (config === null) {
    throw serviceNotConfigured();
  }
  const token = await getManagementToken();

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logUpstream('删除用户', error instanceof Error ? error.name : 'UnknownError');
    throw logtoUpstreamError();
  }

  if (response.status === 204 || response.status === 404) {
    return;
  }
  if (response.status === 401) {
    // token 可能被提前吊销，丢弃缓存让下次重试换新的
    cachedToken = null;
  }
  logUpstream('删除用户', `HTTP ${response.status}`);
  throw logtoUpstreamError();
}
