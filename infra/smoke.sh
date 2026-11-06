#!/usr/bin/env bash
# 部署后冒烟（05 §8.0）。在宿主机跑；默认 BASE 取 PUBLIC_ORIGIN 或 localhost。
# 用法：infra/smoke.sh [https://your.domain]
set -uo pipefail

BASE=${1:-${PUBLIC_ORIGIN:-localhost}}
# PUBLIC_ORIGIN 是 Caddy 站点地址（不带协议）；缺协议时补 https://（Caddy 会把 http 308 到 https，状态码断言全错）。
case "$BASE" in http://*|https://*) ;; *) BASE="https://$BASE" ;; esac
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

# 服务端健康（公开，只回 {ok,status,service}；依赖与开关明细在 /health/details，需 x-health-token，且反代不对外放行）。
check "/health" 200 "$BASE/health"
# 学生端（Caddy 静态文件，index.html）与教师端（vite base=/t/）。
check "学生端首页 /" 200 "$BASE/"
check "教师端 /t/" 200 "$BASE/t/"
check "教师端 /t 重定向" 308 "$BASE/t"
check "镜像入口 /s/mirror（SPA 兜底）" 200 "$BASE/s/mirror"
# 未登录：/me 401；写接口缺 CSRF 头 403（05 §7）。
check "未登录 /me" 401 "$BASE/api/v1/me"
check "写接口缺 CSRF 头" 403 "$BASE/api/v1/events/batch" POST

# 安全头（05 §7）：同源可嵌（教师镜像 iframe），其余 origin 不可嵌。
headers=$(curl -sI "$BASE/" | tr -d '\r')
for want in 'content-security-policy:.*frame-ancestors .self.' 'x-frame-options: *sameorigin' 'x-content-type-options: *nosniff'; do
  if echo "$headers" | grep -qi "^$want"; then echo "ok   安全头 $want"; else echo "FAIL 缺安全头 $want"; fail=1; fi
done

# AIGC 标识（13 §2）：AI 生成文本的响应带 X-AIGC: 1；/health 不要求，缺失只提示。
aigc=$(curl -sI "$BASE/health" | tr -d '\r' | grep -i '^x-aigc:' || true)
if [ -n "$aigc" ]; then echo "ok   X-AIGC 头：$aigc"; else echo "info /health 无 X-AIGC 头（AI 文本响应才需要）"; fi

# 明细不得经公网反代泄露：/health/details 的响应里不能出现 deps（Caddy/nginx 不放行时落到静态站点，返回的是 HTML）。
if curl -s "$BASE/health/details" | grep -q '"deps"'; then echo "FAIL /health/details 经公网可达并返回了依赖明细"; fail=1; else echo "ok   /health/details 未对外暴露"; fi

echo "--- /health body ---"
curl -s "$BASE/health" || true
echo
# 依赖状态明细（可选）：HEALTH_DETAILS_URL 指向内网/回环的 server（如 http://127.0.0.1:18081/health/details），HEALTH_TOKEN 同服务端。
if [ -n "${HEALTH_DETAILS_URL:-}" ] && [ -n "${HEALTH_TOKEN:-}" ]; then
  echo "--- /health/details body ---"
  curl -s -H "x-health-token: $HEALTH_TOKEN" "$HEALTH_DETAILS_URL" || true
  echo
fi
echo "--- 结果 ---"
if [ "$fail" = 0 ]; then echo "冒烟通过"; else echo "冒烟失败：请检查 Caddy/server 日志"; fi
exit "$fail"
