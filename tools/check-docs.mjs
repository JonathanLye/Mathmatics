#!/usr/bin/env node
// 文档结构检查（仓库根运行：node tools/check-docs.mjs）
// 1. 10-开发文档 00–13 号分册与仓库规则文件都在；
// 2. 这些 Markdown 里的相对链接都指向真实存在的文件/目录（跳过代码块、外链、锚点）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = '证明陪练场_产品设计工作区/10-开发文档';
const B_REVIEW = '证明陪练场_产品设计工作区/12-B线代码复审';
const errors = [];

const required = [
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  '.github/CODEOWNERS',
  '.github/pull_request_template.md',
  `${DOCS}/contracts/README.md`,
];
for (const f of required) {
  if (!existsSync(join(root, f))) errors.push(`缺少必备文件：${f}`);
}

const docFiles = readdirSync(join(root, DOCS)).filter((f) => f.endsWith('.md'));
for (let i = 0; i <= 13; i++) {
  const prefix = String(i).padStart(2, '0') + '-';
  const hits = docFiles.filter((f) => f.startsWith(prefix));
  if (hits.length !== 1) errors.push(`${DOCS}：${prefix}* 分册应恰好 1 个，实际 ${hits.length} 个`);
}

const scan = [
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  ...docFiles.map((f) => `${DOCS}/${f}`),
  `${DOCS}/contracts/README.md`,
  ...(existsSync(join(root, B_REVIEW))
    ? readdirSync(join(root, B_REVIEW))
        .filter((f) => f.endsWith('.md'))
        .map((f) => `${B_REVIEW}/${f}`)
    : []),
].filter((f) => existsSync(join(root, f)));

const LINK = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
let checked = 0;

for (const file of scan) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  let fence = null;
  lines.forEach((line, idx) => {
    const m = line.match(/^\s*(```|~~~)/);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1] === fence) fence = null;
      return;
    }
    if (fence) return;
    const text = line.replace(/`[^`]*`/g, '');
    for (const [, raw] of text.matchAll(LINK)) {
      let target = raw.replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch {
        // 保留原样
      }
      checked++;
      const abs = resolve(root, dirname(file), target);
      if (!existsSync(abs)) {
        errors.push(`${file}:${idx + 1} 链接失效 → ${raw}（解析为 ${relative(root, abs)}）`);
      }
    }
  });
}

if (errors.length) {
  console.error(`check-docs: ${errors.length} 个问题`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-docs: OK（${scan.length} 个文件，${checked} 个相对链接）`);
