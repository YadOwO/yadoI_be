# 下次发布要做的事

<!-- 上线时要额外做的事（加环境变量、改 nginx、执行 SQL）一条一行写在这里，发布后会挪进 deploy/releases/ -->
- 在服务器 /opt/yado/yadoi-be/.env 填 LOGTO_M2M_APP_ID、LOGTO_M2M_APP_SECRET（可以用和 yadoa-be 同一个带 Management API all 权限的 M2M 应用），没填时注销接口返回 503
- 执行迁移 0002，新增 yadoi.deleted_users
