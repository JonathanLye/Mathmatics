#!/usr/bin/env bash
# 每 6 小时 pg_dump 一次，保留 30 天（05 §8.3）。由宿主机 cron 调用。
set -euo pipefail

COMPOSE_DIR=$(cd "$(dirname "$0")" && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$COMPOSE_DIR/backups"}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$BACKUP_DIR"
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U proof_gym -Fc proof_gym > "$BACKUP_DIR/proof-gym-$STAMP.dump"
find "$BACKUP_DIR" -name 'proof-gym-*.dump' -mtime +30 -delete
echo "backup: $BACKUP_DIR/proof-gym-$STAMP.dump"
