#!/usr/bin/env node
// 把 10-开发文档/contracts（唯一源）同步到 packages/contracts（只读副本）。
// 用法：node tools/sync-contracts.mjs [--check]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, '证明陪练场_产品设计工作区', '10-开发文档', 'contracts');
const DST = path.join(root, 'packages', 'contracts');

const FILES = [
  'openapi.yaml',
  'events.schema.json',
  'problem-package.schema.json',
  'concept.schema.json',
  'schema.sql',
  'keyboard-layout.json',
  'tools/canon.mjs',
];
const DIRS = ['seed'];
const KEEP = new Set(['package.json', 'README.md', 'tsconfig.json']);
// 顶层保留的生成物目录（不参与「多余文件」检查）。
const KEEP_DIRS = new Set(['gen']);
// 任意层级都不属于契约源：依赖目录与版本库元数据（pnpm 会在 packages/contracts 下建 node_modules）。
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);
const SKIP_FILE_NAMES = new Set(['.DS_Store']);

const check = process.argv.includes('--check');

function walk(rel) {
  const abs = path.join(SRC, rel);
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const next = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...walk(next));
    else out.push(next);
  }
  return out;
}

function listExpected() {
  const files = [...FILES];
  for (const dir of DIRS) files.push(...walk(dir));
  for (const rel of files) {
    if (!fs.existsSync(path.join(SRC, rel))) throw new Error(`源缺少文件：${rel}`);
  }
  return files.sort();
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listCopied() {
  const out = [];
  const walkDst = (rel) => {
    for (const entry of fs.readdirSync(path.join(DST, rel), { withFileTypes: true })) {
      // 不看 isDirectory()：node_modules 可能是符号链接（pnpm），按名字跳过最稳。
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (SKIP_FILE_NAMES.has(entry.name)) continue;
      if (rel === '.' && KEEP_DIRS.has(entry.name)) continue;
      const next = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walkDst(next);
      else out.push(next);
    }
  };
  if (!fs.existsSync(DST)) return out;
  walkDst('.');
  return out.filter((rel) => !KEEP.has(rel)).sort();
}

const expected = listExpected();

if (check) {
  const problems = [];
  for (const rel of expected) {
    const dst = path.join(DST, rel);
    if (!fs.existsSync(dst)) problems.push(`缺失：${rel}`);
    else if (sha256(path.join(SRC, rel)) !== sha256(dst)) problems.push(`内容不一致：${rel}`);
  }
  for (const rel of listCopied()) {
    if (!expected.includes(rel)) problems.push(`多余：${rel}`);
  }
  if (problems.length) {
    console.error(`contracts 副本与唯一源不一致（${problems.length} 处）：`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('运行 node tools/sync-contracts.mjs 重新同步。');
    process.exit(1);
  }
  console.log(`contracts 副本与唯一源一致（${expected.length} 个文件）。`);
  process.exit(0);
}

for (const rel of expected) {
  const dst = path.join(DST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), dst);
}
for (const rel of listCopied()) {
  if (!expected.includes(rel)) fs.rmSync(path.join(DST, rel), { force: true });
}
console.log(`已同步 ${expected.length} 个文件到 packages/contracts。`);
