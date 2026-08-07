/**
 * 应用组装。
 *
 * 各业务模块以独立的 Hono 子应用形式挂载，模块之间不互相引用。
 * 将来某个模块需要独立成服务时，把该模块目录整体搬出即可，业务代码无需改动。
 */
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { env } from './config/env.js';
import { pingDb } from './db/index.js';
import categoriesRoutes from './modules/categories/routes.js';
import itemsRoutes from './modules/items/routes.js';
import { handleError } from './shared/errors.js';
import { createApp } from './shared/openapi.js';

const app = createApp();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map((item) => item.trim()),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86_400,
  }),
);

app.onError(handleError);

/** 健康检查：供反向代理与监控使用，不需要鉴权 */
app.get('/health', async (c) => {
  const isDbUp = await pingDb();
  return c.json(
    {
      status: isDbUp ? 'ok' : 'degraded',
      db: isDbUp ? 'up' : 'down',
      time: new Date().toISOString(),
    },
    isDbUp ? 200 : 503,
  );
});

// 声明 Bearer 认证方式，供 OpenAPI 文档与客户端代码生成使用。
// 业务路由通过 security: [{ Bearer: [] }] 引用它。
app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// 业务模块以子应用形式挂载。鉴权挂在各路由的 middleware 字段上，不在此处用 app.use。
app.route('/v1/categories', categoriesRoutes);
app.route('/v1/items', itemsRoutes);

/**
 * OpenAPI 文档。
 * iOS / Web 客户端由此文件生成网络层代码，避免手写请求与模型。
 */
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'yadoI API',
    version: '0.1.0',
    description: '芽豆有物（yadoI）业务后端接口',
  },
});

export default app;
