#!/usr/bin/env bash
# 在“本机”构建镜像，并通过 ssh 传到服务器 docker load。服务器上不构建、不访问 Docker Hub。
# 只加载镜像，不启动任何容器；启动见 README 的“首次上线”。
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

docker build -f "$ROOT/infra/Dockerfile" --target runtime -t "proofgym-server:$TAG" "$ROOT"
docker build -f "$ROOT/infra/Dockerfile" --target web-shared -t "proofgym-web:$TAG" "$ROOT"
docker pull postgres:16

if [ "$MODE" = "--build-only" ]; then
  echo "已构建 proofgym-server:$TAG 与 proofgym-web:$TAG（未传输）。"
  exit 0
fi

# 只 load，不会影响服务器上已有容器；磁盘不足时 load 会失败，不会改动已有镜像。
echo "传输镜像到 $HOST（约 600MB，压缩传输）..."
docker save "proofgym-server:$TAG" "proofgym-web:$TAG" postgres:16 | gzip | ssh "$HOST" 'gunzip | docker load'
echo "完成。服务器上的新镜像："
ssh "$HOST" "docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E '^(proofgym|postgres)'"
