/**
 * Hono 应用的类型环境定义。
 */
import type { Env } from 'hono';

export interface AppEnv extends Env {
  Variables: {
    /** 当前请求的用户标识，由鉴权中间件从 JWT 的 sub 写入 */
    userId: string;
    /** 内部接口的调用方（目前只有 yado-hub），由机器鉴权中间件按凭证写入；只在 /internal 下有值 */
    machineId: string;
  };
}
