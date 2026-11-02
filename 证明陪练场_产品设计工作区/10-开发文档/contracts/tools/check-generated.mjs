// 生成物同步检查：events.schema.json 与 events-catalog.mjs；08 §3 与 `--markdown` 输出。
// 这是 A5 的 CI 门禁：生成区禁止手改，改 events 只改 tools/events-catalog.mjs 后重跑生成。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, markdown } from './events-catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
let bad = 0;

const gen = JSON.stringify(buildSchema(), null, 2) + '\n';
const cur = fs.readFileSync(path.join(root, 'events.schema.json'), 'utf8');
if (gen !== cur) { console.log('✗ events.schema.json 与 events-catalog.mjs 不同步'); bad++; }

const doc = fs.readFileSync(path.join(root, '..', '08-事件与数据字典.md'), 'utf8');
const m = /<!-- GENERATED:events BEGIN[^>]*-->([\s\S]*?)<!-- GENERATED:events END -->/.exec(doc);
if (!m) { console.log('✗ 08 §3 缺少 GENERATED:events 标记'); bad++; }
else if (m[1].trim() !== markdown().trim()) { console.log('✗ 08 §3 与 events-catalog.mjs --markdown 不同步'); bad++; }

console.log(bad ? `${bad} 处不同步` : '生成物同步检查通过（events.schema.json / 08 §3）');
process.exit(bad ? 1 : 0);
