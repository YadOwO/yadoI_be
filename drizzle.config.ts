import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 配置。
 *
 * schemaFilter 限定为 yadoi，确保迁移不会误触同一实例上其他产品的 schema。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['yadoi'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
