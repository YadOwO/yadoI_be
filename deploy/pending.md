# 下次发布要做的事

<!-- 上线时要额外做的事（加环境变量、改 nginx、改服务器脚本、drizzle 迁移以外的手工 SQL）一条一行写在这里，发布后会挪进 deploy/releases/。drizzle/ 里的迁移由部署脚本自动执行，不要写进来 -->
- 推 main 之前：先对比服务器上现有的 /opt/yado/scripts/deploy-yadoi-be.sh 和仓库的 deploy/scripts/deploy-yadoi-be.sh，确认差异后用仓库版覆盖（yado:yado，755），authorized_keys 的 forced command 路径不变
- 推 main 之前：确认 /opt/yado/yadoi-be/.env 里 DATABASE_URL 的角色对 drizzle.__drizzle_migrations 有 SELECT 和 INSERT 权限、对 drizzle 和 yadoi 两个 schema 有 USAGE 和 CREATE 权限、对 yado 库有 CREATE 权限（migrator 会执行 CREATE SCHEMA IF NOT EXISTS），缺哪个补哪个；不补的话迁移会失败、部署会中止
- 推 main 之前：在 GitHub 仓库 YadOwO/yadoI_be 加 Repository Secret BARK_DEVICE_KEY（可以和 yadoA_be 用同一个设备 Key）
