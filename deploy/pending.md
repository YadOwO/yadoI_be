# 下次发布要做的事

<!-- 上线时要额外做的事（加环境变量、改 nginx、执行 SQL）一条一行写在这里，发布后会挪进 deploy/releases/ -->

- 新增内部只读接口 GET /internal/v1/users/{userId}/summary（注销前数据汇总），不需要新环境变量；要先于 yado_hub 发布。
