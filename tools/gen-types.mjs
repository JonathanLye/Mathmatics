#!/usr/bin/env node
// 从唯一源契约生成 TypeScript 类型与 openapi.json。
// 用法：node tools/gen-types.mjs [--check]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'packages', 'contracts');
const COMMITTED = path.join(SOURCE, 'gen');
const check = process.argv.includes('--check');
const outDir = check ? path.join(root, 'work', 'gen-check') : COMMITTED;
const bin = path.join(root, 'node_modules', '.bin');

const targets = [
  { input: 'openapi.yaml', output: 'api.ts', tool: 'openapi-typescript' },
  { input: 'events.schema.json', output: 'events.ts', tool: 'json2ts' },
  { input: 'problem-package.schema.json', output: 'problem-package.ts', tool: 'json2ts' },
  { input: 'concept.schema.json', output: 'concept.ts', tool: 'json2ts' },
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw new Error(`无法执行 ${command}：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} 退出码 ${String(result.status)}`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const openapi = parseYaml(fs.readFileSync(path.join(SOURCE, 'openapi.yaml'), 'utf8'));
fs.writeFileSync(path.join(outDir, 'openapi.json'), `${JSON.stringify(openapi, null, 2)}\n`);

for (const target of targets) {
  const input = path.join(SOURCE, target.input);
  const output = path.join(outDir, target.output);
  if (target.tool === 'openapi-typescript') {
    run(path.join(bin, 'openapi-typescript'), [input, '-o', output]);
  } else {
    run(path.join(bin, 'json2ts'), ['-i', input, '-o', output]);
  }
  console.log(`生成 ${path.relative(root, output)}`);
}

if (check) {
  const problems = [];
  for (const file of fs.readdirSync(outDir)) {
    const generated = path.join(outDir, file);
    const committed = path.join(COMMITTED, file);
    if (!fs.existsSync(committed)) problems.push(`缺失：gen/${file}`);
    else if (fs.readFileSync(generated).compare(fs.readFileSync(committed)) !== 0) {
      problems.push(`内容不一致：gen/${file}`);
    }
  }
  for (const file of fs.existsSync(COMMITTED) ? fs.readdirSync(COMMITTED) : []) {
    if (!fs.existsSync(path.join(outDir, file))) problems.push(`多余：gen/${file}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  if (problems.length) {
    console.error(`契约类型生成物不一致（${problems.length} 处）：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('运行 pnpm gen:types 重新生成。');
    process.exit(1);
  }
  console.log('契约类型生成物与唯一源一致。');
}
