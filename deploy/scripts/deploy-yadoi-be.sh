#!/bin/bash
# yadoI 后端部署脚本。
# 由 GitHub Actions 经 SSH forced command 触发，不接受任何参数与外部输入。
# 手动执行也可：sudo -u yado /opt/yado/scripts/deploy-yadoi-be.sh
#
# 顺序：拉新镜像 → 用新镜像执行数据库迁移 → 迁移成功才替换容器并等健康检查。
# 退出码：0 部署成功；3 数据库迁移失败（没有切换版本，旧容器继续运行）；1 健康检查没通过。
set -euo pipefail

COMPOSE_FILE=/opt/yado/docker-compose.yml
SERVICE=yadoi-be
CONTAINER=yado-yadoi-be-1

# 数据库迁移失败时的退出码。GitHub Actions 靠它区分「迁移失败」和其他失败，
# 以便 Bark 推送不同的通知，修改时要同步改 .github/workflows/deploy.yml。
MIGRATION_FAILED_EXIT_CODE=3

echo "[$(date '+%F %T')] 开始部署 ${SERVICE}"

# 记下当前镜像，失败时供人工回滚参考
BEFORE=$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "（无运行中容器）")
echo "  部署前镜像: ${BEFORE}"

docker compose -f "$COMPOSE_FILE" pull "$SERVICE"

# 先用新镜像迁移，成功后才切换容器。
# -T：forced command 没有 TTY，compose run 默认分配 TTY 会报错。
# --no-deps：不顺带启动或改动 postgres 等其他服务。
# --rm：跑完删除一次性容器。
# run 使用服务自己的 env_file 和网络，所以 DATABASE_URL 与服务一致。
# 迁移在一个事务里，失败会整体回滚；这里不能吞掉错误，否则会带着没迁移的库切换到新代码。
echo '  执行数据库迁移（新镜像）...'
if ! docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T "$SERVICE" node dist/db/migrate.js; then
  echo "[$(date '+%F %T')] 数据库迁移步骤失败，已中止部署：没有切换版本，旧容器继续运行（镜像 ${BEFORE}）。可能是迁移 SQL 出错（迁移在事务里，未生效），也可能是迁移容器没能启动（compose 配置、env_file 里缺 DATABASE_URL、镜像缺 dist/db/migrate.js 等），请看上面的输出确认原因，修好后重新部署。" >&2
  exit "$MIGRATION_FAILED_EXIT_CODE"
fi

docker compose -f "$COMPOSE_FILE" up -d "$SERVICE"

# 等健康检查，最多 90 秒
echo "  等待健康检查..."
for i in $(seq 1 18); do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "healthy" ]; then
    echo "  健康检查通过（第 ${i} 次轮询）"
    echo "  部署后镜像: $(docker inspect --format '{{.Image}}' "$CONTAINER")"
    # 清理因更新而失去标签的旧镜像，避免占满 40G 系统盘
    docker image prune -f > /dev/null 2>&1 || true
    echo "[$(date '+%F %T')] 部署成功"
    exit 0
  fi
  sleep 5
done

echo "  健康检查未通过，最后状态: ${STATUS}" >&2
echo "  容器最近日志:" >&2
docker logs --tail 30 "$CONTAINER" 2>&1 | sed 's/^/    /' >&2
echo "[$(date '+%F %T')] 部署失败。回滚：把 compose 中 image 改回上一个可用标签后执行" >&2
echo "  docker compose -f ${COMPOSE_FILE} up -d ${SERVICE}" >&2
exit 1
