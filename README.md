# yadoI_be

芽豆有物（yadoI）业务后端服务。

## 技术栈

| 层面 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 22 | ESM |
| Web 框架 | Hono | 轻量，基于 Web 标准 API |
| 数据契约 | Zod + @hono/zod-openapi | 一份 schema 同时做校验、类型推导与 OpenAPI 文档 |
| ORM | Drizzle | 贴近 SQL，类型推导完整 |
| 数据库 | PostgreSQL 16 | 本产品独占 `yadoi` schema |
| 身份 | Logto（自部署） | JWKS 非对称验签，本服务不持有私钥 |

## 架构决策

### 数据库隔离：同实例、独立 schema

多个 yado 产品共享同一个 Postgres 实例，各自独占一个 schema（本产品为 `yadoi`）。

- 不采用"每产品独立数据库实例"：目标部署机内存有限，跑多个 Postgres 不现实。
- 不采用"所有产品混在一个 schema"：会丧失边界，将来无法拆分。
- 跨产品读取数据时，**只读对方显式暴露的 view，不直接读对方的表**。view 相当于数据库层的契约，改表不影响下游。
- 将来某个产品需要独立数据库时，`pg_dump` 该 schema 即可迁出。

### 认证：业务服务自行验签

客户端携带 Logto 签发的 JWT，本服务用 JWKS 公钥验签，取 `sub` 作为 `userId`。

- 所有数据查询强制按 `userId` 过滤，用户只能访问自己的数据。
- 鉴权中间件绑定在**每个路由定义**的 `middleware` 字段上，不使用 `app.use('/*', ...)`。
  原因：子应用挂载到 `/v1/items` 后，`'/*'` 只匹配 `/v1/items/xxx` 而**不匹配 `/v1/items` 本身**，
  会导致列表接口绕过鉴权。这是实际踩过的坑，新增模块时请沿用 `middleware` 写法。
- `AUTH_DEV_BYPASS=true` 可在本地跳过验签，`NODE_ENV=production` 时该配置被强制忽略。

### 同步友好的数据设计

为将来的多端同步（iOS / Web / Android）预留：

- **稳定唯一 ID**：`id` 为 UUID，允许客户端生成并在创建时传入，支持离线先建后传。
- **幂等创建**：重复提交同一 id 时返回已存在的记录，而非报错，便于客户端重传。
- **软删除墓碑**：删除写入 `deletedAt` 而非物理删除，使删除动作能同步到其他端。
- **增量同步游标**：`updatedAt` 配合 `?updatedSince=&includeDeleted=true` 拉取变更集。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env

# 3. 启动本地 Postgres
docker compose up -d

# 4. 创建表结构
npm run db:push

# 5. 启动开发服务（热重载）
npm run dev
```

服务地址 `http://localhost:3000`，接口文档 `http://localhost:3000/openapi.json`。

本地调试可在 `.env` 中设置 `AUTH_DEV_BYPASS=true` 跳过 JWT 校验。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式（热重载） |
| `npm run typecheck` | 类型检查 |
| `npm run build` | 编译到 `dist/` |
| `npm start` | 运行编译产物 |
| `npm run db:push` | 直接把 schema 推送到数据库（开发用） |
| `npm run db:generate` | 生成迁移文件（生产用） |
| `npm run db:migrate` | 执行迁移 |
| `npm run db:studio` | 打开 Drizzle Studio |

## 目录结构

```
src/
├── index.ts              启动入口、优雅退出
├── app.ts                应用组装：中间件、健康检查、路由挂载、OpenAPI 文档
├── types.ts              Hono 环境类型
├── config/env.ts         环境变量校验（启动时快速失败）
├── db/
│   ├── schema.ts         Drizzle 表定义（yadoi schema）
│   └── index.ts          数据库客户端、连通性探测
├── middleware/auth.ts    Logto JWT 验签
├── shared/
│   ├── errors.ts         统一错误类型与错误响应
│   └── openapi.ts        OpenAPIHono 工厂（统一校验错误格式）
└── modules/
    └── items/            物品模块（routes.ts + schemas.ts）
```

新增业务模块时在 `modules/` 下建目录，在 `app.ts` 用 `app.route()` 挂载。
模块之间不互相引用，将来某模块需独立成服务时可整体搬出。

## 接口约定

响应错误统一为 `{ code, message, details? }`。时间统一 ISO 8601（UTC），ID 统一 UUID。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查（免鉴权） |
| GET | `/openapi.json` | OpenAPI 文档 |
| GET | `/v1/items` | 物品列表，支持 `limit` `offset` `updatedSince` `includeDeleted` |
| POST | `/v1/items` | 创建物品，可传入客户端生成的 `id` |
| GET | `/v1/items/{id}` | 物品详情 |
| PATCH | `/v1/items/{id}` | 更新物品 |
| DELETE | `/v1/items/{id}` | 软删除物品 |

### 生成客户端代码

`openapi.json` 是与 iOS / Web 客户端之间的契约，客户端不应手写网络层与数据模型：

```bash
# 导出契约
curl -s http://localhost:3000/openapi.json -o openapi.json

# 由契约生成 Swift 客户端（示例，需自行安装 openapi-generator）
openapi-generator generate -i openapi.json -g swift5 -o ../yadoI/Generated
```

## 部署

镜像为多阶段构建，以非 root 用户运行，并限制 V8 堆上限以适配小内存机器。

```bash
docker build -t yadoi-be:latest .
docker run -d --name yadoi-be -p 3000:3000 --env-file .env.production yadoi-be:latest
```

生产环境注意事项：

- `NODE_ENV=production`，确保 `AUTH_DEV_BYPASS` 失效。
- `CORS_ORIGINS` 配置具体域名，不要保留 `*`。
- 用 `db:generate` + `db:migrate` 管理表结构变更，不要在生产用 `db:push`。
- `.env` 不提交到仓库，生产配置通过容器环境变量注入。

## 尚未实现

| 项 | 说明 |
| --- | --- |
| 物品业务字段 | 当前仅有 `name`。分类、使用状态、购入价格与币种、当前估值、日期、图片等待数据模型确认后补充 |
| 图片存储 | 计划走对象存储 + CDN，由本服务签发上传凭证 |
| PowerSync | 离线优先同步方案，待服务器资源评估后决定是否引入；当前为普通 REST 在线同步 |
| 分类模块 | 待物品数据模型确认后新增 |
