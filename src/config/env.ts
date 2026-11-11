/**
 * 环境变量加载与校验。
 *
 * 校验失败时直接退出进程，避免服务带着错误配置运行。
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(7788),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** Postgres 连接串 */
  DATABASE_URL: z.string().min(1),

  /** Logto 的 issuer，例如 https://auth.yado.com/oidc */
  LOGTO_ISSUER: z.string().min(1),
  /** 本服务在 Logto 中注册的 API resource indicator，作为 JWT 的 audience 校验 */
  LOGTO_AUDIENCE: z.string().min(1),
  /** JWKS 地址，缺省时由 issuer 推导为 {issuer}/jwks */
  LOGTO_JWKS_URL: z.string().min(1).optional(),

  /** 本地开发跳过 JWT 校验，生产环境强制失效 */
  AUTH_DEV_BYPASS: z.enum(['true', 'false']).default('false'),
  AUTH_DEV_USER_ID: z.string().min(1).default('dev-user-0001'),

  /** Logto Machine-to-Machine 应用 ID，用于调用 Management API 删除用户；留空则注销接口对真实用户返回 503 */
  LOGTO_M2M_APP_ID: z.string().min(1).optional(),
  /** Logto Machine-to-Machine 应用密钥，与 LOGTO_M2M_APP_ID 成对配置 */
  LOGTO_M2M_APP_SECRET: z.string().min(1).optional(),
  /** Logto Management API 的 resource indicator，默认为 Logto 内置值 */
  LOGTO_MANAGEMENT_RESOURCE: z.string().min(1).default('https://default.logto.app/api'),

  /** 允许的跨域来源，逗号分隔；生产环境应配置具体域名而非 * */
  CORS_ORIGINS: z.string().min(1).default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error(`环境变量校验失败：\n${details}\n请参考 .env.example 补全配置。`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

export const env = {
  ...raw,
  isProduction,
  /** JWKS 实际地址 */
  logtoJwksUrl: raw.LOGTO_JWKS_URL ?? `${raw.LOGTO_ISSUER.replace(/\/$/, '')}/jwks`,
  /**
   * Logto Management API 配置：两个 M2M 凭证都配置时才可用，否则为 null。
   * tokenUrl 用于换取 M2M access token；apiBaseUrl 是 Management API 根地址，
   * 位于 Logto 域名根下的 /api（issuer 去掉末尾的 /oidc）。
   */
  logtoManagement:
    raw.LOGTO_M2M_APP_ID !== undefined && raw.LOGTO_M2M_APP_SECRET !== undefined
      ? {
          tokenUrl: `${raw.LOGTO_ISSUER.replace(/\/$/, '')}/token`,
          apiBaseUrl: `${raw.LOGTO_ISSUER.replace(/\/$/, '').replace(/\/oidc$/, '')}/api`,
          resource: raw.LOGTO_MANAGEMENT_RESOURCE,
          appId: raw.LOGTO_M2M_APP_ID,
          appSecret: raw.LOGTO_M2M_APP_SECRET,
        }
      : null,
  /**
   * 是否启用开发态免鉴权。
   * 生产环境无论如何配置都为 false，防止误开导致接口裸奔。
   */
  isDevAuthBypassEnabled: raw.AUTH_DEV_BYPASS === 'true' && !isProduction,
} as const;

if (raw.AUTH_DEV_BYPASS === 'true' && isProduction) {
  console.warn('检测到 AUTH_DEV_BYPASS=true，但当前为生产环境，已强制忽略该配置。');
}
