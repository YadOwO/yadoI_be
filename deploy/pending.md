# 下次发布要做的事

<!-- 上线时要额外做的事（加环境变量、改 nginx、执行 SQL）一条一行写在这里，发布后会挪进 deploy/releases/ -->
执行数据库迁移：在生产环境对 yadoi schema 运行 `pnpm run db:migrate`（本次新增 drizzle/0001_deep_shen.sql，给 yadoi.items 加 icon_focus_x、icon_focus_y 两列）。部署流水线只构建镜像、触发服务器脚本，镜像里不含 drizzle/，不会自动迁移；需在新版本服务启动前执行。
