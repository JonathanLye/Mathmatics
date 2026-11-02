// 本地服务：托管 index.html，并在本机用 Lean 4 + mathlib4 编译老师审过的参考证明。
// 用法：node server.mjs        然后打开 http://127.0.0.1:8787
// 环境变量：LEAN_PROJECT（含 mathlib 的 Lake 项目，默认 ~/lean-verify/proofcheck）、PORT。
// 安全：只监听本机；只编译 lean/ 下登记的文件，不接受页面传来的任意代码。
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.LEAN_PROJECT || path.join(os.homedir(), 'lean-verify', 'proofcheck');
const ELAN_BIN = path.join(os.homedir(), '.elan', 'bin');
const PORT = +process.env.PORT || 8787;
const TIMEOUT_MS = 240000;
const FILES = { epsN: 'EpsN.lean', series: 'Series.lean' };  // 题目 id → 参考证明
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

let queue = Promise.resolve();  // 同一时间只跑一个编译
function compile(id) {
  const run = () => new Promise(async resolve => {
    const file = path.join(here, 'lean', FILES[id]);
    const t0 = Date.now();
    let toolchain = '', code;
    try { toolchain = (await fs.readFile(path.join(PROJECT, 'lean-toolchain'), 'utf8')).trim(); code = await fs.readFile(file, 'utf8'); }
    catch (e) { return resolve({ ok: false, error: `找不到 Lean 项目或证明文件：${e.message}`, code: code || '' }); }
    const p = spawn(path.join(ELAN_BIN, 'lake'), ['env', 'lean', file], { cwd: PROJECT, env: { ...process.env, PATH: ELAN_BIN + path.delimiter + process.env.PATH } });
    let out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const timer = setTimeout(() => p.kill('SIGKILL'), TIMEOUT_MS);
    p.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: `无法启动 lake：${e.message}`, code }); });
    p.on('close', status => {
      clearTimeout(timer);
      const text = out.split(file).join(FILES[id]).trim();
      const hasError = /: error:/.test(text) || status !== 0;
      const sorry = /declaration uses [`'’]sorry/.test(text);
      resolve({ ok: !hasError && !sorry, sorry, ms: Date.now() - t0, toolchain, output: text, code });
    });
  });
  const r = queue.then(run); queue = r.catch(() => {}); return r;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, body, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  try {
    if (url.pathname === '/api/lean/check' && req.method === 'POST') {
      const id = url.searchParams.get('id');
      if (!Object.hasOwn(FILES, id)) return send(404, JSON.stringify({ ok: false, error: '未登记的题目' }));
      return send(200, JSON.stringify(await compile(id)));
    }
    if (url.pathname === '/api/ping') return send(200, '{"ok":true}');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const abs = path.join(here, rel);
    const ok = rel === 'index.html' || (rel.startsWith('vendor/') && abs.startsWith(path.join(here, 'vendor') + path.sep));
    if (!ok || !TYPES[path.extname(abs)]) return send(404, 'not found', 'text/plain');
    send(200, await fs.readFile(abs), TYPES[path.extname(abs)]);
  } catch (e) { send(500, JSON.stringify({ ok: false, error: String(e.message || e) })); }
}).listen(PORT, '127.0.0.1', () => console.log(`证明陪练场：http://127.0.0.1:${PORT}   Lean 项目：${PROJECT}`));
