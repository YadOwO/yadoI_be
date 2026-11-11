import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * 迁移文件目录（仓库根的 drizzle/）。
 *
 * 相对本文件定位：编译后在 dist/db/，tsx 运行时在 src/db/，两者上两级都是仓库根，
 * 镜像里则是 /app/drizzle。
 */
const MIGRATIONS_FOLDER: string = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * 迁移记录表所在的 schema。
 *
 * 必须和 drizzle.config.ts 一致：那里没配 migrations，用的是 drizzle-kit 的默认值，
 * 生产库现有的执行记录就在 drizzle.__drizzle_migrations。写成 yadoi 会找不到历史记录，
 * 把已执行的迁移从头重跑而失败。
 */
const MIGRATIONS_SCHEMA = 'drizzle';

/**
 * 迁移记录表名，约束同 MIGRATIONS_SCHEMA（drizzle-kit 默认表名）。
 */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * 执行 drizzle/ 里尚未执行的迁移。
 *
 * 只读 DATABASE_URL，不引入 config/env.ts（会要求 LOGTO_* 等无关变量）和 db/index.ts
 * （会建 5 连接的池），用独立的单连接即可。migrator 把本次所有未执行的迁移放在一个事务里，
 * 失败时整体回滚。退出码：0 成功（含没有待执行迁移），1 失败。日志不输出连接串。
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    console.error('缺少环境变量 DATABASE_URL，无法执行迁移');
    process.exitCode = 1;
    return;
  }

  const client = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    console.log('开始执行数据库迁移');
    await migrate(drizzle(client), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
    console.log('数据库迁移完成');
  } catch (error: unknown) {
    console.error('数据库迁移失败，已整体回滚：', error);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
