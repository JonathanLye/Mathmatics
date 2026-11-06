#!/usr/bin/env node
// 启动冒烟：真实拉起 apps/server（Node 原生运行 TS），请求 /health（公开，只含 ok/status/service）与 /health/details（无令牌应 404），然后退出。
import { spawn } from 'node:child_process';

const started = Date.now();
const child = spawn(process.execPath, ['apps/server/src/server.ts'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    SMOKE: '1',
    LOG_LEVEL: 'silent',
    HEALTH_TOKEN: '',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let output = '';
let checked = false;

const timer = setTimeout(() => {
  console.error('smoke: 启动或健康检查超时');
  child.kill('SIGKILL');
  process.exit(1);
}, 15000);

async function check(address) {
  if (checked) return;
  checked = true;
  try {
    const res = await fetch(new URL('/health', address));
    const body = await res.json();
    if (res.status !== 200 || body.status !== 'ok') {
      throw new Error(`/health 返回 ${res.status}：${JSON.stringify(body)}`);
    }
    // 公开的 /health 不得带依赖与开关明细；明细只在 /health/details，且无令牌时与未知路由一样 404。
    for (const key of ['deps', 'flags', 'env', 'uptimeSec']) {
      if (key in body) throw new Error(`/health 公开响应不应包含 ${key}`);
    }
    const details = await fetch(new URL('/health/details', address));
    if (details.status !== 404) throw new Error(`/health/details 无令牌应返回 404，实际 ${details.status}`);
    console.log(`smoke ok: ${address}/health（${Date.now() - started}ms）`);
    child.kill('SIGTERM');
    clearTimeout(timer);
  } catch (error) {
    console.error('smoke failed:', error);
    child.kill('SIGKILL');
    clearTimeout(timer);
    process.exitCode = 1;
  }
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  output += chunk;
  const match = /LISTENING (\S+)/.exec(output);
  if (match) void check(match[1]);
});

child.on('exit', (code) => {
  clearTimeout(timer);
  if (process.exitCode === 0) {
    process.exit(0);
  }
  if (!checked && code !== 0) {
    console.error(`smoke: server 退出码 ${String(code)}`);
    process.exit(1);
  }
});
