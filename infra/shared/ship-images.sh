#!/usr/bin/env bash
# 在“本机”构建镜像，并传到服务器 docker load。服务器上不构建、不访问 Docker Hub。
# 只加载镜像，不启动任何容器；启动见 README 的“首次上线”。
#
# 为低带宽/不稳定链路设计：
#   - 镜像先 docker save | gzip 成一个文件，切成 8MiB 分片，3 路并行上传，按分片大小断点续传（重跑即续）；
#   - 分片落在服务器数据盘 /var/www/proofgym-staging/<TAG>，校验 sha256 后才 docker load，成功后删除分片；
#   - postgres 镜像不从本机传：由服务器通过 docker.m.daocloud.io 镜像拉取并打回 postgres:16
#     （服务器连不上 Docker Hub，但已有同一镜像站的 node 镜像）。
#
# 用法：
#   infra/shared/ship-images.sh <ssh 主机别名> <TAG>
#   infra/shared/ship-images.sh <ssh 主机别名> <TAG> --build-only    # 只构建，不传
# 需要本机 docker 正在运行（Docker Desktop 要先启动）。
set -euo pipefail

HOST=${1:?用法：ship-images.sh <ssh 主机别名> <TAG> [--build-only]}
TAG=${2:?缺少 TAG（建议用 git 短 sha，例如 $(git rev-parse --short HEAD)）}
MODE=${3:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REMOTE_DIR="/var/www/proofgym-staging/$TAG"
PG_MIRROR=docker.m.daocloud.io/library/postgres:16
export HOST REMOTE_DIR
export SSH_OPTS="-o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=20"

docker build -f "$ROOT/infra/Dockerfile" --target runtime -t "proofgym-server:$TAG" "$ROOT"
docker build -f "$ROOT/infra/Dockerfile" --target web-shared -t "proofgym-web:$TAG" "$ROOT"

if [ "$MODE" = "--build-only" ]; then
  echo "已构建 proofgym-server:$TAG 与 proofgym-web:$TAG（未传输）。"
  exit 0
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cd "$STAGE"
docker save "proofgym-server:$TAG" "proofgym-web:$TAG" | gzip > images.tar.gz
sha256sum images.tar.gz | cut -d' ' -f1 > images.sha256
split -b 8M -d -a 4 images.tar.gz chunk.
echo "镜像包 $(du -h images.tar.gz | cut -f1)，$(ls chunk.* | wc -l) 个分片；上传到 $HOST:$REMOTE_DIR"

# shellcheck disable=SC2029
ssh $SSH_OPTS "$HOST" "mkdir -p '$REMOTE_DIR'"

upload_chunk() {
  local f=$1 size remote
  size=$(stat -c %s "$f")
  for _ in $(seq 1 30); do
    # shellcheck disable=SC2029
    remote=$(ssh $SSH_OPTS "$HOST" "stat -c %s '$REMOTE_DIR/$f' 2>/dev/null || echo 0" 2>/dev/null || echo 0)
    if [ "$remote" = "$size" ]; then return 0; fi
    # shellcheck disable=SC2029
    timeout 600 ssh $SSH_OPTS "$HOST" "cat > '$REMOTE_DIR/$f.part' && mv '$REMOTE_DIR/$f.part' '$REMOTE_DIR/$f'" < "$f" 2>/dev/null || true
  done
  echo "分片 $f 上传失败" >&2
  return 1
}
export -f upload_chunk

ls chunk.* | xargs -P 3 -I{} bash -c 'upload_chunk {}'
echo "分片上传完成，校验并加载..."

WANT=$(cat images.sha256)
# shellcheck disable=SC2029
ssh $SSH_OPTS "$HOST" "cd '$REMOTE_DIR' && got=\$(cat chunk.* | sha256sum | cut -d' ' -f1) && [ \"\$got\" = '$WANT' ] || { echo 'sha256 不一致，未加载' >&2; exit 1; }
  cat chunk.* | gunzip | docker load
  rm -f '$REMOTE_DIR'/chunk.* && rmdir '$REMOTE_DIR'
  docker image inspect postgres:16 >/dev/null 2>&1 || { docker pull '$PG_MIRROR' && docker tag '$PG_MIRROR' postgres:16; }
  docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E '^(proofgym|postgres)'"
echo "完成。"
