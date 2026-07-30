/**
 * 服务启动入口。
 */
import { serve } from '@hono/node-server';

import app from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/index.js';

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`yadoI_be 已启动：http://localhost:${info.port}（${env.NODE_ENV}）`);
  console.log(`接口文档：http://localhost:${info.port}/openapi.json`);
  if (env.isDevAuthBypassEnabled) {
    console.warn(`注意：已开启开发态免鉴权，所有请求都视为用户 ${env.AUTH_DEV_USER_ID}`);
  }
});

/**
 * 优雅退出：先停止接收新请求，再关闭数据库连接池。
 */
function shutdown(signal: string): void {
  console.log(`收到 ${signal}，正在关闭服务...`);
  server.close(() => {
    void closeDb().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('关闭数据库连接失败：', error);
        process.exit(1);
      },
    );
  });
  // 兜底：超时未退出则强制结束，避免容器停不下来
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
