# 下次发布要做的事

<!-- 上线时要额外做的事（加环境变量、改 nginx、执行 SQL）一条一行写在这里，发布后会挪进 deploy/releases/ -->
- 在服务器 /opt/yado/yadoi-be/.env 填 LOGTO_M2M_APP_ID、LOGTO_M2M_APP_SECRET（可以用和 yadoa-be 同一个带 Management API all 权限的 M2M 应用），没填时注销接口返回 503
- 在新版本服务启动前，对生产库执行 `pnpm run db:migrate`（本次新增 drizzle/0002_deleted_users.sql，建 yadoi.deleted_users 表）。镜像里不含 drizzle/，不会自动迁移；新版本的鉴权每个请求都会查这张表，表不存在时所有带鉴权的接口都会返回 500
