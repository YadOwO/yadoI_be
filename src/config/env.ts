/**
 * 环境变量加载与校验。
 *
 * 校验失败时直接退出进程，避免服务带着错误配置运行。
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
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
   * 是否启用开发态免鉴权。
   * 生产环境无论如何配置都为 false，防止误开导致接口裸奔。
   */
  isDevAuthBypassEnabled: raw.AUTH_DEV_BYPASS === 'true' && !isProduction,
} as const;

if (raw.AUTH_DEV_BYPASS === 'true' && isProduction) {
  console.warn('检测到 AUTH_DEV_BYPASS=true，但当前为生产环境，已强制忽略该配置。');
}
