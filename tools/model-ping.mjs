#!/usr/bin/env node
// 部署前模型探活：用服务端同一套配置与适配器，对已配置的识别 provider 各发 1 次最小请求，
// 报告 ok/失败原因码与耗时。只打印 provider 名、模型 ID、状态，不打印任何密钥或响应体。
// 用法（密钥放在服务器的 env 文件里，本脚本不读文件内容，只由 node 加载）：
//   node --env-file=infra/.env tools/model-ping.mjs
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { loadModelRegistry } from '../apps/server/src/ai/registry.ts';
import { invokeDashscope } from '../apps/server/src/ai/dashscope.ts';
import { invokeSimpleTex } from '../apps/server/src/ai/simpletex.ts';

const MODELS_PATH = fileURLToPath(new URL('../apps/server/config/models.yaml', import.meta.url));

// 64x32 白底 PNG（含一小条黑线，免得被当成空图拒绝）。
function tinyPng() {
  const w = 64, h = 32;
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    if (y >= 14 && y < 18) for (let x = 8; x < 56; x++) raw.fill(0, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const registry = loadModelRegistry(MODELS_PATH, process.env);
const image = tinyPng().toString('base64');
let failed = 0;

async function ping(label, providerName, model, run) {
  const provider = registry.providers[providerName];
  if (!provider?.configured) {
    console.log(`SKIP ${label}（${providerName} 未配置：缺 ${provider?.missing.join(', ') ?? '?'}）`);
    return;
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs * 2);
  try {
    await run(provider, controller.signal);
    console.log(`ok   ${label}（${model}，${Date.now() - started}ms）`);
  } catch (error) {
    failed++;
    const reason = error && typeof error === 'object' && 'reason' in error ? String(error.reason) : 'unexpected';
    console.log(`FAIL ${label}（${model}，原因码 ${reason}，${Date.now() - started}ms）`);
  } finally {
    clearTimeout(timer);
  }
}

for (const role of ['ocr_line', 'ocr_line_std', 'ocr_page']) {
  const m = registry.models[role];
  await ping(`SimpleTex ${role}`, 'simpletex', m.endpoint, (p, signal) =>
    invokeSimpleTex({ baseUrl: p.values.baseUrl, appId: p.values.appId, appSecret: p.values.appSecret, endpoint: m.endpoint, input: { image, mime: 'image/png', fields: role === 'ocr_page' ? { rec_mode: 'document' } : {} }, signal, fetchImpl: fetch }),
  );
}
const cross = registry.models.cross;
await ping('DashScope cross', 'dashscope', cross.model, (p, signal) =>
  invokeDashscope({ baseUrl: p.values.baseUrl, apiKey: p.values.apiKey, model: cross.model, input: { image, mime: 'image/png', mode: 'line' }, signal, fetchImpl: fetch }),
);
console.log('说明：DeepSeek（fast/strong）在 apps/server 内没有运行时适配器（回退归类与生成微课的开关默认关），本脚本不探活；jev（typesafe）为影子模式，未配置会 SKIP。');
process.exit(failed === 0 ? 0 : 1);
