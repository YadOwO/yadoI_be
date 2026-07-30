/**
 * 数据库客户端。
 *
 * 连接池上限刻意保持较小：目标部署环境内存有限（2G 级别），
 * 且同一台机器上还有其他服务共享同一个 Postgres 实例。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env.js';
import * as schema from './schema.js';

const client = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

/** 关闭连接池，供进程优雅退出时调用 */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

/** 数据库连通性探测 */
export async function pingDb(): Promise<boolean> {
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  }
}
