#!/usr/bin/env bash
# 从 pg_dump 自定义格式恢复（05 §8.3）。由人手动执行，需二次确认。
# 用法：infra/restore.sh infra/backups/proof-gym-20261105T000000Z.dump
set -euo pipefail

COMPOSE_DIR=$(cd "$(dirname "$0")" && pwd)
DUMP=${1:?用法：infra/restore.sh <备份文件.dump>}

if [ ! -f "$DUMP" ]; then
  echo "找不到备份文件：$DUMP" >&2
  exit 1
fi

# 危险操作：恢复会覆盖当前 proof_gym 数据库。先停 server/worker，避免写入竞争。
echo "将用 $DUMP 覆盖当前 proof_gym 数据库（会先停 server/worker）。"
read -r -p "输入 RESTORE 确认：" confirm
if [ "$confirm" != "RESTORE" ]; then
  echo "已取消。"
  exit 1
fi

COMPOSE=(docker compose -f "$COMPOSE_DIR/docker-compose.yml")
"${COMPOSE[@]}" stop server worker caddy

echo "恢复中..."
"${COMPOSE[@]}" exec -T postgres \
  pg_restore -U proof_gym -d proof_gym --clean --if-exists --no-owner --single-transaction < "$DUMP"

# 数据校验：users/attempts 行数与迁移版本（恢复后应非空且版本表存在）
COUNT=$("${COMPOSE[@]}" exec -T postgres psql -U proof_gym -d proof_gym -tAc "select count(*) from app.users")
echo "users=$COUNT"
VERSIONS=$("${COMPOSE[@]}" exec -T postgres psql -U proof_gym -d proof_gym -tAc "select count(*) from public.schema_migrations")
echo "schema_migrations=$VERSIONS"
if [ "$VERSIONS" -lt 1 ]; then
  echo "恢复后 schema_migrations 为空：数据可能不完整" >&2
  exit 1
fi

echo "恢复完成，启动服务..."
"${COMPOSE[@]}" start server worker caddy

# 等 server 健康后自检；失败则提示人工排查。
for _ in $(seq 1 30); do
  # 在 server 容器里查（node:24-slim 无 curl，用内置 fetch）：走宿主机 http://127.0.0.1 时 Caddy 会 308 到 https，
  # curl -f 把 308 当成功，恢复失败也会报"正常"。
  if "${COMPOSE[@]}" exec -T server node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; then
    echo "restore done: $DUMP；/health 正常。"
    exit 0
  fi
  sleep 2
done

echo "恢复完成但 /health 未就绪，请人工检查：docker compose -f '$COMPOSE_DIR/docker-compose.yml' logs server caddy" >&2
exit 1
