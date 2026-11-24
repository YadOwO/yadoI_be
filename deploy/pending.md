# 下次发布要做的事

<!-- 上线时要额外做的事（加环境变量、改 nginx、执行 SQL）一条一行写在这里，发布后会挪进 deploy/releases/ -->

- 注销改由 yado_hub 编排：去掉了 `DELETE /v1/account` 和删 Logto 用户的代码，换成只给 hub 调的 `DELETE /internal/v1/users/{userId}`（机器凭证鉴权，成功返回 200）；本服务要先于 hub 上线，上线顺序见 yado_hub 的 deploy/pending.md
- 环境变量：线上 `/opt/yado/yadoi-be/.env` 加 `INTERNAL_MACHINE_TOKENS=yado-hub:<sha256>`（hub 的 `ACCOUNT_DELETION_TOKENS` 里 yadoi-be 那个凭证的 sha256），有 `LOGTO_M2M_APP_ID`、`LOGTO_M2M_APP_SECRET`、`LOGTO_MANAGEMENT_RESOURCE` 的话删掉；dev（mini 的 `~/yado-dev/compose.yaml` 的 yadoi-be）同样加 `INTERNAL_MACHINE_TOKENS`
- nginx：本仓库没有 nginx 配置，要在服务器 `/opt/yado/nginx/conf.d/` 里 yadoi-api 的 443 server 块加 `location ^~ /internal/ { deny all; }`（写法同 yadoA_be 的 deploy/nginx/yadoa-api.yado1225.top.conf），`docker exec yado-nginx-1 nginx -t && docker exec yado-nginx-1 nginx -s reload`；验证 `curl -s -o /dev/null -w '%{http_code}' -X DELETE https://yadoi-api.yado1225.top/internal/v1/users/x` 返回 403。dev 的 `dev-yadoi-api` 转发（本机 `~/yado-dev-tools/server/install-dev-proxy.sh`）也要加同样的拒绝
