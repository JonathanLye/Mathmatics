#!/usr/bin/env bash
# 部署后冒烟（05 §8.0）。在宿主机跑；默认 BASE 取 PUBLIC_ORIGIN 或 localhost。
# 用法：infra/smoke.sh [https://your.domain]
set -uo pipefail

BASE=${1:-${PUBLIC_ORIGIN:-http://localhost}}
fail=0

check() {
  local name="$1" want="$2" url="$3" method="${4:-GET}"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" || echo 000)
  if [ "$code" = "$want" ]; then
    echo "ok   $name（$code）"
  else
    echo "FAIL $name（got $code, want $want）$url"
    fail=1
  fi
}

echo "冒烟：$BASE"

# 服务端健康（含数据库/队列/依赖状态；degraded 也算 200，需人工看 body）。
check "/health" 200 "$BASE/health"
# 学生端（Caddy 静态文件，index.html）与教师端（vite base=/t/）。
check "学生端首页 /" 200 "$BASE/"
check "教师端 /t/" 200 "$BASE/t/"
# 未登录：/me 401；写接口缺 CSRF 头 403（05 §7）。
check "未登录 /me" 401 "$BASE/api/v1/me"
check "写接口缺 CSRF 头" 403 "$BASE/api/v1/events/batch" POST

# AIGC 标识（13 §2）：AI 生成文本的响应带 X-AIGC: 1；/health 不要求，缺失只提示。
aigc=$(curl -sI "$BASE/health" | tr -d '\r' | grep -i '^x-aigc:' || true)
if [ -n "$aigc" ]; then echo "ok   X-AIGC 头：$aigc"; else echo "info /health 无 X-AIGC 头（AI 文本响应才需要）"; fi

# /health 的依赖状态（JSON）打到屏幕，便于值守判断降级。
echo "--- /health body ---"
curl -s "$BASE/health" || true
echo
echo "--- 结果 ---"
if [ "$fail" = 0 ]; then echo "冒烟通过"; else echo "冒烟失败：请检查 Caddy/server 日志"; fi
exit "$fail"
