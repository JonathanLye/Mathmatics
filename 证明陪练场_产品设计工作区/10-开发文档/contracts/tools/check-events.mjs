// 校验事件样例：入库事件符合 events.schema.json；前端上报事件符合 $defs/ClientEvent；
// 并验证"服务端类型不能由前端上报"（防伪造）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { default: Ajv2020 } = await import('ajv/dist/2020.js');
const { default: addFormats } = await import('ajv-formats');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'events.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
const vStored = ajv.compile(schema);
const vClient = ajv.compile({ ...schema.$defs.ClientEvent, $defs: schema.$defs });
let bad = 0;
fs.readFileSync(path.join(root, 'seed/events.sample.jsonl'), 'utf8').trim().split('\n').forEach((l, i) => {
  const e = JSON.parse(l); if (!vStored(e)) { bad++; console.log(`✗ stored #${i + 1} ${e.type}: ${ajv.errorsText(vStored.errors)}`); }
});
for (const e of JSON.parse(fs.readFileSync(path.join(root, 'seed/client-events.sample.json'), 'utf8'))) {
  if (!vClient(e)) { bad++; console.log(`✗ client ${e.type}: ${ajv.errorsText(vClient.errors)}`); }
}
const forged = { id: '0192f0a0-0000-7000-8000-0000000000ff', type: 'hint.deliver', tsClient: '2026-11-05T12:00:00Z', sessionId: '0192f0a0-4444-7000-8000-000000000001', deviceId: '0192f0a0-5555-7000-8000-000000000001', clientSeq: 1, payload: { hintId: 'K1.H4', key: 'K1', level: 'H4', revealDelta: 0, revealAfter: 0 } };
if (vClient(forged)) { bad++; console.log('✗ 前端能伪造服务端事件 hint.deliver'); }
console.log(bad ? `${bad} 处不通过` : `事件样例全部通过（${schema.allOf.length} 种事件）`);
process.exit(bad ? 1 : 0);
