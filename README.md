# yadoI_be

芽豆有物（yadoI）业务后端服务。

记录并回看自己拥有些什么——偏收藏与自我审视，不是资产成本核算。客户端为 iOS / Web，
本服务只提供 REST 接口与 OpenAPI 契约。

工程规则（分层、命名、数据库与接口约定、安全红线）见 [AGENTS.md](./AGENTS.md)。

## 技术栈

| 层面 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 22 | ESM |
| Web 框架 | Hono | 轻量，基于 Web 标准 API |
| 数据契约 | Zod + @hono/zod-openapi | 一份 schema 同时做校验、类型推导与 OpenAPI 文档 |
| ORM | Drizzle | 贴近 SQL，类型推导完整 |
| 数据库 | PostgreSQL 16 | 本产品独占 `yadoi` schema |
| 身份 | Logto（自部署） | JWKS 非对称验签，本服务不持有私钥 |

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 准备环境变量
cp .env.example .env

# 3. 启动本地 Postgres
docker compose up -d

# 4. 创建表结构（执行迁移）
pnpm run db:migrate

# 5. 启动开发服务（热重载）
pnpm run dev
```

服务地址 `http://localhost:7788`，健康检查 `/health`，接口文档 `/openapi.json`。

本地调试可在 `.env` 中设置 `AUTH_DEV_BYPASS=true` 跳过 JWT 校验，此时所有请求都视为
`AUTH_DEV_USER_ID` 指定的用户。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm run dev` | 开发模式（热重载） |
| `pnpm run typecheck` | 类型检查 |
| `pnpm test` | 集成测试（需本地 Postgres 已迁移；需要环境变量 `DATABASE_URL`、`LOGTO_ISSUER`、`LOGTO_AUDIENCE`，缺任一项 env 校验会直接 exit(1)，可写在 .env 里） |
| `pnpm run build` | 编译到 `dist/` |
| `pnpm start` | 运行编译产物 |
| `pnpm run db:generate` | 表结构变更后生成迁移文件 |
| `pnpm run db:migrate` | 本地执行迁移（drizzle-kit；生产由部署脚本自动执行） |
| `pnpm run db:migrate:prod` | 先 `build`，用编译后的脚本执行迁移，和生产相同 |
| `pnpm run db:push` | 不要使用：会绕过迁移记录，导致库与迁移历史脱节 |
| `pnpm run db:studio` | 打开 Drizzle Studio |

## 注销账号

`DELETE /v1/account`（成功返回 204）会**永久删除芽豆账号（Logto 用户）**，再在一个事务里写入注销名单
`yadoi.deleted_users`、物理删除该用户在芽豆有物的全部云端数据（物品、分类，含已删除的记录）。
芽豆系列所有 App 共用同一个 Logto 账号，注销后在所有芽豆 App 里都无法再登录，操作不可撤销。
注销之后，旧 token 调用其他接口一律返回 401；接口可重复调用（用于失败重试）。
本接口不清除芽豆资产等其他产品的云端数据。

- 需要配置 Logto Management API 的 M2M 凭证：`LOGTO_M2M_APP_ID`、`LOGTO_M2M_APP_SECRET`
  （见 `.env.example`）。没配时真实用户调用返回 503，开发态免鉴权的假用户不受影响。
- Logto 删除失败返回 502，此时什么都没动，可以重试。
- App 要先停掉写请求，再调用注销接口。

App 接入要求：

- 确认弹窗必须用严重措辞，照芽豆资产的「注销芽豆账号？」文案写明：账号将被永久删除，
  所有芽豆 App 都无法再登录；芽豆有物云端数据将被永久删除；此操作无法撤销。
  按钮用红色的「继续注销」。
- 调用失败时提示「注销没有完成，请检查网络后重试」，且不退出登录。

## 部署

镜像为多阶段构建，以非 root 用户运行，并限制 V8 堆上限以适配小内存机器。

```bash
docker build -t yadoi-be:latest .
docker run -d --name yadoi-be -p 7788:7788 --env-file .env.production yadoi-be:latest
```

生产环境须设 `NODE_ENV=production`（使 `AUTH_DEV_BYPASS` 强制失效），并把 `CORS_ORIGINS`
改为具体域名而非 `*`。

### 日常发布

在 `dev` 分支开发，合并到 `main` 后 GitHub Actions 构建 amd64 镜像并推到 GHCR，再经 SSH forced command
触发服务器上的 `/opt/yado/scripts/deploy-yadoi-be.sh`（源文件 `deploy/scripts/deploy-yadoi-be.sh`）：

1. 拉新镜像；
2. 用新镜像执行 `node dist/db/migrate.js`，跑完 `drizzle/` 里未执行的迁移（在一个事务里，失败整体回滚）；
3. 迁移成功后才替换容器并等健康检查。

迁移失败时部署中止，旧服务继续运行，Bark 推送「数据库迁移失败」。部署时自动迁移，不用再手动执行
`db:migrate`。因为回滚镜像不会回滚表结构，迁移要兼容上一版代码。

### 部署结果通知（Bark）

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 新建 Repository Secret：

| Secret | 值 |
| --- | --- |
| `BARK_DEVICE_KEY` | Bark App 中推送地址的设备 Key 部分，不包含 `https://api.day.app/` |

可与其他仓库使用同一个设备 Key，但需要在本仓库单独配置。
生产部署成功或失败后会发送通知（迁移失败会单独标出），点击通知可打开对应 Actions 日志；取消运行不发送。
未配置 Key 时跳过通知，通知服务异常也不会改变部署结果。
