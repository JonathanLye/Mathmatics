#!/usr/bin/env bash
# 共用主机版数据库备份：pg_dump 自定义格式，保留 14 天（根盘只剩几 GB，比默认的 30 天短）。
# 由宿主机 cron 调用，例如：0 */6 * * * /path/to/infra/shared/backup.sh
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$DIR/backups"}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$BACKUP_DIR"
docker compose -p proofgym -f "$DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U proof_gym -Fc proof_gym > "$BACKUP_DIR/proof-gym-$STAMP.dump"
find "$BACKUP_DIR" -name 'proof-gym-*.dump' -mtime +14 -delete
echo "backup: $BACKUP_DIR/proof-gym-$STAMP.dump"
