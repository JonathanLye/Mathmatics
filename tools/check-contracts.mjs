#!/usr/bin/env node
// 契约门禁：先校验 packages/contracts 与唯一源一致，再在唯一源目录跑 npm run check。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = path.join(root, '证明陪练场_产品设计工作区', '10-开发文档', 'contracts');
const cacheDir = path.join(root, 'work', '.npm-cache');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? cacheDir },
  });
  if (result.error) {
    console.error(`无法执行 ${command}：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

fs.mkdirSync(cacheDir, { recursive: true });
run(process.execPath, ['tools/sync-contracts.mjs', '--check'], root);

if (!fs.existsSync(path.join(contractsDir, 'node_modules'))) {
  console.log('contracts/node_modules 不存在，先执行 npm ci ...');
  run('npm', ['ci'], contractsDir);
}

run('npm', ['run', 'check'], contractsDir);
