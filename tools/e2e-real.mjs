#!/usr/bin/env node
// 真实服务全流程走查：本地起 server（PGlite）+ 生产构建的学生端和教师端（线上同款 CSP），用浏览器走一遍。
// 只碰本地临时库，不连线上，不调模型（help.llm 默认关）。
//
// 前置（输出到临时目录，不动 dist）：
//   npx uni build --outDir <dir>/student     （apps/student，VITE_USE_MOCK=false）
//   npx vite build --outDir <dir>/teacher    （apps/teacher）
// 用法：E2E_DIR=<dir> [E2E_BUNDLE=imports/batch-v3/bundle.jsonl.gz] node tools/e2e-real.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/student/'));
const { chromium } = require('playwright-core');

const DIR = process.env.E2E_DIR;
if (!DIR) {
  console.error('需要 E2E_DIR');
  process.exit(2);
}
const OUT = path.join(DIR, 'shots');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const API_PORT = 3977;
const WEB_PORT = 3978;
const PGLITE_DIR = path.join(DIR, 'pglite');
const TEACHER_PASSWORD = 'Local-e2e-teacher-1';
const STUDENT_PASSWORD = 'Local-e2e-student-1';
const STUDENT_PASSWORD_2 = 'Local-e2e-student-2';
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push(name + (detail ? ' -- ' + detail : ''));
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' -- ' + detail}`);
}

// ---- 数据库 ----
const serverEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  PGLITE_DIR,
  STUDENT_PASSWORD_ENFORCE: 'true',
  LOG_LEVEL: 'warn',
};
for (const key of ['DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY']) delete serverEnv[key];
fs.rmSync(PGLITE_DIR, { recursive: true, force: true });
function cli(args, options = {}) {
  const res = spawnSync(process.execPath, ['src/db/cli.ts', ...args], { cwd: path.join(root, 'apps/server'), env: { ...serverEnv, ...options.env }, input: options.input, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(`cli ${args[0]} 失败：${res.stderr?.slice(0, 500)}`);
  return res.stdout;
}
cli(['reset']);
cli(['create-teacher', 'e2e'], { env: { TEACHER_PASSWORD } });
const bundle = process.env.E2E_BUNDLE;
if (bundle) {
  const out = cli(['import-bundle'], { input: fs.readFileSync(path.resolve(root, bundle)) });
  console.log('import-bundle:', out.trim().split('\n').pop()?.slice(0, 200));
}

// ---- 服务 ----
const server = spawn(process.execPath, ['src/server.ts'], { cwd: path.join(root, 'apps/server'), env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
const serverErrors = [];
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    serverLog += text;
    for (const line of text.split('\n')) if (/"level":50|"level":60/.test(line)) serverErrors.push(line.slice(0, 300));
  });
}
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/health`);
    if (res.ok) break;
  } catch {
    /* 等服务起来 */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
function serveStatic(res, base, url) {
  let file = path.join(base, url);
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(base, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP });
  fs.createReadStream(file).pipe(res);
}
const web = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url.startsWith('/api/') || url === '/health') {
    const proxied = http.request({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    proxied.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(proxied);
    return;
  }
  if (url === '/t' || url.startsWith('/t/')) return serveStatic(res, path.join(DIR, 'teacher'), url.slice(2) || '/');
  return serveStatic(res, path.join(DIR, 'student'), url);
});
await new Promise((resolve) => web.listen(WEB_PORT, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${WEB_PORT}`;

// ---- 建班（只布置 epsN；不用 tools/local-demo.mjs，它会把题库里的题全布置一遍）----
let teacherCookie = '';
async function teacherApi(method, url, { body, headers = {} } = {}) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/v1${url}`, {
    method,
    headers: { 'x-requested-with': 'proof-gym', ...(teacherCookie ? { cookie: teacherCookie } : {}), ...(body && typeof body === 'object' ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) teacherCookie = set.split(';')[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
await teacherApi('POST', '/auth/teacher/login', { body: { username: 'e2e', password: TEACHER_PASSWORD } });
const cls = await teacherApi('POST', '/teacher/classes', { body: { name: '走查班', term: '2026 秋' } });
await teacherApi('POST', `/teacher/classes/${cls.classId}/roster`, { body: '2026001,张三\n2026002,李四\n', headers: { 'content-type': 'text/csv' } });
const assignment = await teacherApi('POST', '/teacher/assignments', { body: { classId: cls.classId, problemId: 'epsN', version: 1, mode: 'practice', openAt: new Date(Date.now() - 60_000).toISOString() } });
const INVITE = cls.inviteCode;
const EPS = assignment.assignmentId ?? assignment.id;
console.log('invite', INVITE, 'epsN assignment', EPS);

// ---- 浏览器工具 ----
function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse() : []) {
    const exe = path.join(base, dir, 'chrome-linux64', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
const cspViolations = [];
const http5xx = [];
function watch(p) {
  p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  p.on('console', (m) => {
    if (/Content Security Policy/.test(m.text()) && !/dcloud/.test(m.text())) cspViolations.push(m.text().slice(0, 200));
  });
  p.on('response', (r) => {
    if (r.status() >= 500 && r.url().includes('/api/')) http5xx.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`);
    if (r.status() >= 400 && r.status() < 500 && r.url().includes('/api/')) {
      r.text().then((t) => console.log(`  [${r.status()}] ${r.request().method()} ${r.url().replace(BASE, '').replace('/api/v1', '')} ${t.slice(0, 160)}`)).catch(() => {});
    }
  });
}
watch(page);

let shotNo = 0;
async function shot(p, name) {
  shotNo += 1;
  await p.waitForTimeout(350);
  await p.screenshot({ path: path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`) });
}
// 挡在前面的一次性提示和反馈面板先点掉，再点目标。
const OVERLAYS = ['coachmark-next', 'feedback-continue', 'interstitial-continue'];
async function clearOverlays(p, except = '') {
  for (const id of OVERLAYS) {
    if (id === except) continue;
    const loc = p.getByTestId(id).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 1500 }).catch(() => {});
      await p.waitForTimeout(250);
    }
  }
}
async function tap(p, id, { timeout = 15000, nth = 0 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      await p.getByTestId(id).nth(nth).click({ timeout: 1500 });
      return;
    } catch (e) {
      last = e;
      await clearOverlays(p, id);
    }
  }
  throw new Error(`点不到 ${id}：${String(last).split('\n')[0]}`);
}
async function tapLoc(p, loc, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      await loc.click({ timeout: 1500 });
      return;
    } catch (e) {
      last = e;
      await clearOverlays(p);
    }
  }
  throw new Error(`点不到：${String(last).split('\n')[0]}`);
}
async function fill(p, id, value) {
  await clearOverlays(p);
  const rootLoc = p.getByTestId(id).first();
  await rootLoc.waitFor({ state: 'visible', timeout: 10000 });
  const tag = await rootLoc.evaluate((el) => el.tagName.toLowerCase());
  const input = tag === 'textarea' || tag === 'input' ? rootLoc : rootLoc.locator('textarea, input').first();
  await input.fill(value);
  await p.waitForTimeout(200); // uni-app 的输入事件延后约 100ms 才写回 v-model
}
const visible = (p, id) => p.getByTestId(id).first().isVisible().catch(() => false);
const waitFor = (p, id, timeout = 12000) => p.getByTestId(id).first().waitFor({ state: 'visible', timeout });
async function waitForOverlaying(p, id, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await visible(p, id)) return true;
    await clearOverlays(p);
    await p.waitForTimeout(200);
  }
  throw new Error(`等不到 ${id}`);
}
const api = (p, method, url, body) =>
  p.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch('/api/v1' + url, {
        method,
        credentials: 'include',
        headers: { 'x-requested-with': 'proof-gym', 'x-pg-app': 'student', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        /* 非 JSON */
      }
      return { status: res.status, json };
    },
    { method, url, body },
  );
async function scenario(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}（场景中断）`, false, String(e).split('\n')[0].slice(0, 240));
    await shot(page, 'FAILED-' + name.replace(/\s+/g, '-')).catch(() => {});
  }
}
async function loginPage(p) {
  await p.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  if (await visible(p, 'intro-skip')) await tap(p, 'intro-skip');
}

const EPS_LINES = [
  ['$|a_n-3|=\\left|\\frac{3n+1}{n+2}-3\\right|=\\frac{5}{n+2}$', '通分化简，再取绝对值'],
  ['$\\frac{5}{n+2}<\\frac{5}{n}$，要使 $\\frac{5}{n}<\\varepsilon$，只需 $n>\\frac{5}{\\varepsilon}$', '分母变小，分式变大'],
  ['取 $N=\\left\\lceil\\frac{5}{\\varepsilon}\\right\\rceil$', '$N$ 只依赖 $\\varepsilon$'],
  ['当 $n>N$ 时，$|a_n-3|=\\frac{5}{n+2}<\\frac{5}{n}<\\varepsilon$', '把前面三行串起来'],
];
const SELFCHECK = {
  SC1: '由第 1 行化简的结果放大得到。',
  SC2: 'N 是门槛，只依赖 ε，与 n 无关。',
  SC3: '第 2 行和第 4 行会断。',
  SC4: 'N 是项数，要取自然数，取得足够大就行。',
  SC5: '用到 n 为正，分母变小后分式变大。',
  SC6: '第 1 行和第 2 行最需要重新设计。',
};
const SUMMARY = [
  '证明了这个数列的极限是 3。',
  '分三块：化简、放大、取 N，前一块交给后一块用。',
  '放大成 5/n 这个选择决定了成败。',
  '写到当 n>N 时小于 ε 才算证完。',
  '先化简再放大、N 只依赖 ε 下次还能用。',
];
async function writeLine(p, statement, justification) {
  await tap(p, 'write-next');
  await tap(p, 'composer-tab-keyboard');
  await fill(p, 'editor-statement', statement);
  if (justification) await fill(p, 'editor-justification', justification);
  await tap(p, 'editor-submit');
  await p.getByTestId('feedback-continue').first().waitFor({ state: 'visible', timeout: 10000 });
}

function splitProofLines(text) {
  // 和 packages/content-checks/src/replay.ts 同样的切法：$ 外的句号、分号断行。
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    let current = '';
    let inMath = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === '\\' && raw[i + 1] === '$') {
        current += '\\$';
        i += 1;
        continue;
      }
      if (ch === '$') inMath = !inMath;
      current += ch;
      if (!inMath && (ch === '。' || ch === '；')) {
        out.push(current);
        current = '';
      }
    }
    out.push(current);
  }
  return out.map((line) => line.trim()).filter(Boolean);
}
const bundleProblems = new Map();
if (bundle) {
  for (const line of zlib.gunzipSync(fs.readFileSync(path.resolve(root, bundle))).toString('utf8').split('\n')) {
    if (!line.includes('"pkg"')) continue;
    const row = JSON.parse(line);
    if (row.pkg) bundleProblems.set(row.pkg.id, row.pkg);
  }
}

let attemptId = '';
const stateOf = async () => (await api(page, 'GET', `/attempts/${attemptId}`)).json.state;

// ================= 场景 =================
await scenario('首次登录：设密码、年龄、同意、欢迎、导览', async () => {
  await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('第一次来自动放开场动画', await visible(page, 'intro-story'));
  await shot(page, 'intro');
  await tap(page, 'intro-skip');
  await shot(page, 'login');
  if (await visible(page, 'login-mode-invite')) await tap(page, 'login-mode-invite');
  await fill(page, 'login-invite', INVITE);
  await fill(page, 'login-studentno', '2026001');
  await tap(page, 'login-submit');
  await waitFor(page, 'setpw-page');
  await fill(page, 'setpw-password', '12345678');
  await fill(page, 'setpw-confirm', '12345678');
  await tap(page, 'setpw-submit');
  await waitFor(page, 'setpw-error');
  check('弱密码被拦', await visible(page, 'setpw-error'));
  await fill(page, 'setpw-password', STUDENT_PASSWORD);
  await fill(page, 'setpw-confirm', STUDENT_PASSWORD);
  await tap(page, 'setpw-submit');
  await waitFor(page, 'age-page');
  await tap(page, 'age-option-ge18');
  await tap(page, 'age-submit');
  await waitFor(page, 'consent-page');
  await shot(page, 'consent');
  const consentText = await page.locator('body').innerText();
  check('同意书写明模型服务', /通义千问|DeepSeek/.test(consentText), consentText.slice(0, 120));
  check('同意书写明数据在境内，不再提香港和境外模型', /中国境内/.test(consentText) && !/香港|境外/.test(consentText), consentText.slice(0, 160));
  await tap(page, 'consent-submit');
  await waitFor(page, 'welcome-page');
  await fill(page, 'welcome-nickname', '小明');
  await tap(page, 'welcome-next');
  await tap(page, 'welcome-next');
  await shot(page, 'welcome-last');
  await tap(page, 'welcome-next');
  await tap(page, 'welcome-go');
  const end = Date.now() + 20000;
  while (Date.now() < end && !(await visible(page, 'home-page'))) {
    for (const id of ['welcome-done', 'welcome-enter', 'intro-skip']) if (await visible(page, id)) await tap(page, id).catch(() => {});
    await page.waitForTimeout(300);
  }
  check('走到首页', await visible(page, 'home-page'), page.url());
  await page.waitForTimeout(1200);
  check('首页导览出现', await visible(page, 'coachmark'));
  await shot(page, 'home-tour');
  while (await visible(page, 'coachmark-next')) {
    await page.getByTestId('coachmark-next').click();
    await page.waitForTimeout(300);
  }
  await shot(page, 'home');
  const me = await api(page, 'GET', '/me');
  check('昵称已保存，不要求再设密码', me.status === 200 && me.json.displayName === '小明' && me.json.needsPassword !== true, JSON.stringify(me.json).slice(0, 160));
});

await scenario('主线：老师布置的题走完六层', async () => {
  const started = await api(page, 'POST', `/student/assignments/${EPS}/attempt`);
  attemptId = started.json.state.attemptId;
  await page.evaluate((id) => { location.hash = `#/pages/practice/index?attemptId=${id}&from=teacher`; }, attemptId);
  await waitForOverlaying(page, 'layer1-form');
  await page.waitForTimeout(800);
  check('第一次进入这一层有就地提示', await visible(page, 'coachmark'));
  await shot(page, 'l1-coach');
  await fill(page, 'layer1-form', '数列越来越接近某个数');
  await tap(page, 'layer1-check');
  await page.getByTestId('feedback-continue').first().waitFor({ state: 'visible', timeout: 10000 });
  const ask = await page.getByTestId('feedback-panel').innerText();
  check('L1 没写全：指出缺什么，不说错', ask.length > 2 && !/错误|不对/.test(ask), ask.slice(0, 80));
  await shot(page, 'l1-feedback');
  await fill(page, 'layer1-form', '对任意 $\\varepsilon>0$，存在正整数 $N$，当 $n>N$ 时，都有 $|a_n-A|<\\varepsilon$。');
  await tap(page, 'layer1-check');
  await waitForOverlaying(page, 'layer2-form');
  check('L1 通过进入 L2', (await stateOf()).currentLayer === 'L2');
  await fill(page, 'layer2-form', '任取 $\\varepsilon>0$。取 $N=$ ＿（待构造）。则当 $n>N$ 时，$|a_n-3|<\\varepsilon$。');
  await tap(page, 'layer2-check');
  await waitForOverlaying(page, 'write-next');
  check('L2 通过进入 L3', (await stateOf()).currentLayer === 'L3');
  await shot(page, 'l3-start');

  await writeLine(page, ...EPS_LINES[0]);
  check('写出关键步骤：绿色反馈', (await page.getByTestId('feedback-panel').getAttribute('data-feedback-tone')) === 'ok');
  check('反馈里有经验', await visible(page, 'feedback-xp'));
  await shot(page, 'l3-ok');
  await tap(page, 'feedback-continue');
  await writeLine(page, '取 $N=n+1$', '随便取的');
  check('错误写法：问问题，不判错', (await page.getByTestId('feedback-panel').getAttribute('data-feedback-tone')) === 'sea');
  await shot(page, 'l3-question');
  await tap(page, 'feedback-continue');

  // 求助（help.llm 关：走题包预写内容）
  await tap(page, 'dock-help');
  await page.locator('.pg-help__intent--concept').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(900);
  await clearOverlays(page);
  await shot(page, 'help-drawer');
  await tapLoc(page, page.locator('.pg-help__intent--concept').first());
  await page.waitForTimeout(1500);
  await clearOverlays(page);
  await shot(page, 'help-answer');
  await tapLoc(page, page.locator('.pg-help__close'));
  await page.waitForTimeout(500);

  for (const line of EPS_LINES.slice(1)) {
    await writeLine(page, ...line);
    await tap(page, 'feedback-continue');
  }
  await shot(page, 'l3-rail');
  check('关键步骤写齐，可以写完', (await stateOf()).steps.canFinish === true);
  await tap(page, 'finish-steps');
  await page.waitForTimeout(800);
  await clearOverlays(page);

  const sc = (await stateOf()).selfcheck;
  check('进入自检', (await stateOf()).currentLayer === 'L4' && sc.items.length > 0);
  for (const item of sc.items) {
    await fill(page, 'selfcheck-input-' + item.itemId, SELFCHECK[item.itemId] ?? '第 1 行');
    await tap(page, 'selfcheck-submit-' + item.itemId);
    await page.waitForTimeout(700);
    await clearOverlays(page);
  }
  await page.waitForTimeout(600);
  await clearOverlays(page);
  check('自检答完进入换题', (await stateOf()).currentLayer === 'L5', (await stateOf()).currentLayer);
  await shot(page, 'l5');

  // 第 5 层：真做迁移题，做完主题要能往下走（线上 v1 的死胡同）
  await tap(page, 'transfer-start');
  await page.waitForTimeout(1500);
  const parentId = attemptId;
  await waitForOverlaying(page, 'transfer-attempt');
  check('开始迁移题，进入子作答', await visible(page, 'transfer-add-line'));
  const parentAfterStart = await stateOf();
  check('主题记下了子作答', Boolean(parentAfterStart.transfer?.childAttemptId ?? parentAfterStart.transfer?.attemptId), JSON.stringify(parentAfterStart.transfer ?? {}).slice(0, 160));
  for (const [s, j] of [['$|(2x+1)-3|=2|x-1|$', '化简'], ['取 $\\delta=\\frac{\\varepsilon}{2}$', '$\\delta$ 只依赖 $\\varepsilon$'], ['当 $0<|x-1|<\\delta$ 时，$|f(x)-3|=2|x-1|<2\\delta=\\varepsilon$', '代入前两行，由定义得证']]) {
    await tap(page, 'transfer-add-line');
    await fill(page, 'transfer-statement', s);
    await fill(page, 'transfer-justification', j);
    await tap(page, 'transfer-editor-save');
    await page.waitForTimeout(900);
    await clearOverlays(page);
  }
  await shot(page, 'transfer-lines');
  await tap(page, 'transfer-finish');
  await waitForOverlaying(page, 'back-to-parent');
  await shot(page, 'transfer-done');
  await tap(page, 'back-to-parent');
  await page.waitForTimeout(1500);
  attemptId = parentId;
  check('迁移题做完，主题进入总结', (await stateOf()).currentLayer === 'L6', (await stateOf()).currentLayer);

  await clearOverlays(page);
  await page.getByTestId('summary-input-0').first().waitFor({ timeout: 10000 });
  for (let i = 0; i < SUMMARY.length; i += 1) await fill(page, 'summary-input-' + i, SUMMARY[i]);
  await tap(page, 'summary-submit');
  await waitForOverlaying(page, 'completion-card');
  await page.waitForTimeout(1200);
  await shot(page, 'completion');
  const done = await stateOf();
  check('本题完成', done.status === 'completed');
  check('完成页显示经验', await visible(page, 'completion-xp'));

  const before = (await api(page, 'GET', '/student/progress')).json;
  check('奖励入账', before.xp?.total > 0 || before.xpTotal > 0 || JSON.stringify(before).includes('"xp"'), JSON.stringify(before).slice(0, 200));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const after = (await api(page, 'GET', '/student/progress')).json;
  check('刷新后奖励不重复', JSON.stringify(after.xp) === JSON.stringify(before.xp), `${JSON.stringify(before.xp)} vs ${JSON.stringify(after.xp)}`);
  check('刷新后还是完成页', await visible(page, 'completion-card'));
});

await scenario('证明本、错题和重做', async () => {
  await page.evaluate(() => { location.hash = '#/pages/proofbook/index'; });
  await waitFor(page, 'notebook-page');
  await waitFor(page, 'notebook-card', 10000);
  check('证明本有内容', (await page.getByTestId('notebook-card').count()) >= 1);
  await shot(page, 'notebook');
  await tap(page, 'notebook-open');
  await waitFor(page, 'proof-detail-lines');
  await shot(page, 'proof-detail');
  check('证明详情有公式', (await page.locator('.katex').count()) > 0);

  await page.evaluate(() => { location.hash = '#/pages/mistakes/index'; });
  await waitFor(page, 'mistakes-page');
  await page.waitForTimeout(1200);
  await shot(page, 'mistakes');
  check('错题有记录', (await page.getByTestId('mistake-item').count()) >= 1);
  await tap(page, 'mistake-redo');
  await page.waitForTimeout(1800);
  const redoId = /attemptId=([0-9a-f-]+)/.exec(page.url())?.[1];
  check('重做开了一份新作答', Boolean(redoId) && redoId !== attemptId, page.url());
  if (redoId) {
    const redo = (await api(page, 'GET', `/attempts/${redoId}`)).json.state;
    check('重做是练习模式', redo.kind === 'redo' && redo.mode === 'practice', `${redo.kind} ${redo.mode}`);
    await clearOverlays(page);
    await shot(page, 'redo');
  }
});

await scenario('练习区和导入题', async () => {
  await page.evaluate(() => { location.hash = '#/pages/practice-zone/index'; });
  await waitFor(page, 'practice-zone-page');
  await waitFor(page, 'zone-list', 15000);
  await page.waitForTimeout(800);
  await shot(page, 'zone');
  const countText = await page.getByTestId('zone-count').first().innerText();
  const count = Number(/\d+/.exec(countText)?.[0] ?? 0);
  if (bundle) check('练习区有导入的题', count >= 500, countText);
  else check('练习区有题', count >= 1, countText);
  await tap(page, 'zone-card');
  await waitFor(page, 'zone-sheet', 8000);
  await page.waitForTimeout(600);
  await shot(page, 'zone-sheet');
  check('题目卡片有题面', (await page.getByTestId('zone-sheet-stem').first().innerText()).length > 4);
  if (bundle) check('题目卡片写明出处', /题目出自《/.test(await page.getByTestId('zone-sheet-source').first().innerText()));
  await tap(page, 'zone-sheet-solution');
  await page.waitForTimeout(1200);
  await shot(page, 'zone-solution');
  const solutionText = await page.locator('body').innerText();
  check('解题思路入口可用', /思路/.test(solutionText));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Esc 只关最上面一层面板', await visible(page, 'zone-sheet-action'));
  await tap(page, 'zone-sheet-action');
  await page.waitForTimeout(2200);
  await clearOverlays(page);
  const zoneAttempt = /attemptId=([0-9a-f-]+)/.exec(page.url())?.[1];
  check('从练习区开始作答', Boolean(zoneAttempt), page.url());
  await waitForOverlaying(page, 'write-next');
  await shot(page, 'zone-attempt');
  await tap(page, 'dock-help');
  await page.waitForTimeout(800);
  await clearOverlays(page);
  check('自学题求助里有“看解题思路”', await visible(page, 'help-solution'));
  await shot(page, 'zone-help');
  await tap(page, 'help-solution');
  await page.waitForTimeout(1000);
  await shot(page, 'zone-help-solution');
  check('解题思路面板打开', /思路/.test(await page.locator('body').innerText()));
  await tap(page, 'solution-reveal-approach');
  await waitFor(page, 'solution-approach');
  await shot(page, 'zone-solution-approach');
  check('思路有内容', (await page.getByTestId('solution-approach').innerText()).length > 10);
  if (bundle) check('AI 整理的解题思路有“AI 生成”标识', await visible(page, 'aigc-tag'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await page.locator('.pg-help__close').isVisible().catch(() => false)) await tapLoc(page, page.locator('.pg-help__close'));
  await page.waitForTimeout(400);

  // 把一道导入的题在浏览器里写完（题包的参考证明逐行输入）。
  if (bundle) {
    attemptId = zoneAttempt;
    const before = await stateOf();
    const problemId = before.problem.problemId ?? before.problem.id;
    const pkg = bundleProblems.get(problemId);
    check('这道题来自导入题包', Boolean(pkg), String(problemId));
    if (pkg) {
      const lines = splitProofLines(pkg.secret.referenceProofs[0].text);
      for (const text of lines) {
        await writeLine(page, text, '由上一行得到');
        await tap(page, 'feedback-continue');
      }
      await shot(page, 'imported-lines');
      const mid = await stateOf();
      check('导入题写完关键步骤', mid.steps?.canFinish === true, JSON.stringify(mid.budget ?? {}).slice(0, 100));
      await tap(page, 'finish-steps');
      await page.waitForTimeout(900);
      await clearOverlays(page);
      await page.getByTestId('summary-input-0').first().waitFor({ timeout: 12000 });
      const questions = (await stateOf()).summary?.questions ?? [];
      for (let i = 0; i < questions.length; i += 1) await fill(page, 'summary-input-' + i, SUMMARY[i] ?? '这一步的关键是逐条核对条件。');
      await tap(page, 'summary-submit');
      await page.waitForTimeout(1200);
      // 缺要点时追问一次：提示留在页面上，再交一次就通过。
      if (!(await visible(page, 'completion-card'))) {
        await clearOverlays(page);
        await waitFor(page, 'summary-followup');
        await shot(page, 'imported-summary-followup');
        check('总结缺要点：追问留在页面上', (await page.getByTestId('summary-followup').innerText()).length > 6);
        await tap(page, 'summary-submit');
      }
      await waitForOverlaying(page, 'completion-card');
      await page.waitForTimeout(1000);
      await shot(page, 'imported-completion');
      check('导入题完成', (await stateOf()).status === 'completed');
      check('完成页没有开不了的“换题”入口', (await page.getByTestId('make-transfer').count()) === 0);
      await teacherApi('GET', '/teacher/classes').catch(() => {});
      const hide = await teacherApi('PATCH', `/teacher/problems/${problemId}/visibility`, { body: { hidden: true } }).catch((e) => e);
      const after = await api(page, 'GET', `/student/practice?q=${encodeURIComponent(pkg.public.title.slice(0, 20))}`);
      check('下架后练习区搜不到', !JSON.stringify(after.json).includes(problemId), `${String(hide.message ?? '')} ${JSON.stringify(after.json).slice(0, 120)}`);
      await teacherApi('PATCH', `/teacher/problems/${problemId}/visibility`, { body: { hidden: false } }).catch(() => {});
      await page.goto(`${BASE}/#/pages/home/index`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const kicker = await page.getByTestId('home-unit-banner').first().innerText();
      check('单元编号按章内位置显示', !/第 \d{3} 单元/.test(kicker), kicker.slice(0, 40));
    }
  }
});

await scenario('账号：退出、密码登录、邀请码不能冒登、改密', async () => {
  await page.goto(`${BASE}/#/pages/me/index`, { waitUntil: 'networkidle' });
  await waitForOverlaying(page, 'me-page');
  await page.waitForTimeout(800);
  await shot(page, 'me');
  await tap(page, 'me-logout');
  await page.waitForTimeout(800);
  const confirm = page.locator('[data-testid="me-logout-confirm"], [data-testid="dialog-confirm"]').first();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await waitFor(page, 'login-submit');
  check('退出后回到登录页', true);
  if (await visible(page, 'login-mode-invite')) await tap(page, 'login-mode-invite');
  await fill(page, 'login-invite', INVITE);
  await fill(page, 'login-studentno', '2026001');
  await tap(page, 'login-submit');
  await page.waitForTimeout(1500);
  check('设过密码的学号不能只凭邀请码登录', await visible(page, 'login-submit'));
  await shot(page, 'invite-only-refused');
  if (await visible(page, 'login-mode-password')) await tap(page, 'login-mode-password');
  await fill(page, 'login-studentno', '2026001');
  await fill(page, 'login-password', 'wrong-password-1');
  await tap(page, 'login-submit');
  await waitFor(page, 'login-error');
  const wrong = await page.getByTestId('login-error').innerText();
  await fill(page, 'login-password', STUDENT_PASSWORD);
  await tap(page, 'login-submit');
  await waitForOverlaying(page, 'home-page');
  check('密码登录成功；错误提示不泄露账号是否存在', wrong.length > 0 && !/不存在/.test(wrong), wrong);

  // 改密：当前密码输错只提示，不踢回登录页。
  await page.evaluate(() => { location.hash = '#/pages/me/account'; });
  await waitFor(page, 'account-page');
  const pw = async (id, value) => {
    await page.getByTestId(id).locator('input').fill(value);
    await page.waitForTimeout(200);
  };
  await pw('account-current', 'wrong-password-1');
  await pw('account-next', STUDENT_PASSWORD_2);
  await pw('account-confirm', STUDENT_PASSWORD_2);
  await tap(page, 'account-save');
  await waitFor(page, 'account-error');
  check('当前密码输错：留在原页并提示', await visible(page, 'account-page'));
  await pw('account-current', STUDENT_PASSWORD);
  await tap(page, 'account-save');
  await page.getByText('密码改好了').first().waitFor({ state: 'visible', timeout: 6000 });
  check('改密成功后这台设备还在线', (await api(page, 'GET', '/me')).status === 200);

  // 重看引导：去欢迎页放开场，放完回首页。
  await page.evaluate(() => { location.hash = '#/pages/me/index'; });
  await waitForOverlaying(page, 'me-page');
  await tap(page, 'me-replay-onboarding');
  await waitFor(page, 'welcome-page');
  check('重看引导回到欢迎页', page.url().includes('replay=1'), page.url());
  await page.waitForTimeout(800);
  await shot(page, 'replay-intro');
  if (await visible(page, 'intro-skip')) await tap(page, 'intro-skip');
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/#/pages/home/index`, { waitUntil: 'networkidle' });
  await waitForOverlaying(page, 'home-page');
  await page.waitForTimeout(1000);
  await clearOverlays(page);
  check('重看后首页正常，没被赶回同意页', page.url().includes('/pages/home/index'), page.url());
});

await scenario('隐私政策：不登录也能看', async () => {
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await anon.newPage();
  watch(p);
  await p.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  if (await visible(p, 'intro-skip')) await tap(p, 'intro-skip');
  check('登录页底部有 ICP 和公安备案号', /粤ICP备2026019694号/.test(await p.getByTestId('site-icp').first().innerText()) && /粤公网安备44060602003163号/.test(await p.getByTestId('site-psb').first().innerText()));
  check('ICP 备案号链接工信部系统', (await p.getByTestId('site-icp').first().getAttribute('href')) === 'https://beian.miit.gov.cn/');
  await shot(p, 'login-record');
  await tap(p, 'login-policy');
  await waitFor(p, 'privacy-policy-page');
  const text = await p.locator('body').innerText();
  check('隐私政策写明保存期限、第三方、权利和 AI 标识', ['保存', 'DeepSeek', 'SimpleTex', '通义千问', '删除', 'AI 生成', '投诉'].every((w) => text.includes(w)));
  check('隐私政策不提香港', !text.includes('香港'));
  check('隐私政策写明运营方和联系方式', text.includes('JonathanLye工作室') && text.includes('junhongli105@gmail.com'));
  await shot(p, 'privacy-policy');
  await anon.close();
});

await scenario('两端隔离和教师端', async () => {
  const t = await ctx.newPage();
  watch(t);
  await t.setViewportSize({ width: 1280, height: 800 });
  await t.goto(`${BASE}/t/`, { waitUntil: 'networkidle' });
  check('教师登录页有备案号和隐私政策入口', /粤ICP备2026019694号/.test(await t.getByTestId('site-record').innerText()) && (await t.getByTestId('login-policy').count()) === 1);
  await t.getByPlaceholder('用户名').fill('e2e');
  await t.getByPlaceholder('密码').fill(TEACHER_PASSWORD);
  await t.keyboard.press('Enter');
  await t.locator('[data-testid^="class-card-"]').first().waitFor({ timeout: 12000 });
  await shot(t, 'teacher-classes');
  const studentMe = await api(page, 'GET', '/me');
  check('同一浏览器：学生端登录不受教师登录影响', studentMe.status === 200 && studentMe.json.role === 'student', JSON.stringify(studentMe.json).slice(0, 120));
  const crossStudent = await t.evaluate(async () => (await fetch('/api/v1/teacher/classes', { credentials: 'include' })).status);
  check('教师接口教师端可用', crossStudent === 200, String(crossStudent));

  const cookies = await ctx.cookies();
  const names = cookies.map((c) => c.name);
  check('两端 Cookie 分开', names.includes('pg_sid_s') && names.includes('pg_sid_t'), names.join(','));
  const onlyTeacher = await browser.newContext();
  await onlyTeacher.addCookies(cookies.filter((c) => c.name === 'pg_sid_t'));
  const op = await onlyTeacher.newPage();
  await op.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const crossed = await op.evaluate(async () => (await fetch('/api/v1/student/home', { credentials: 'include' })).status);
  check('只有教师 Cookie 访问学生接口被拒', crossed === 401 || crossed === 403, String(crossed));
  await onlyTeacher.close();

  await t.locator('[data-testid^="class-card-"]').first().click();
  await t.waitForTimeout(1500);
  await shot(t, 'teacher-class');
  await t.locator('.t-tabs__nav-item').filter({ hasText: /^实时看板$/ }).click();
  await t.waitForTimeout(1500);
  await shot(t, 'teacher-live');
  const liveText = await t.locator('body').innerText();
  check('看板不露开发术语', !/SSE|mock|\bL3\b|P0|dependent/.test(liveText), (liveText.match(/SSE|mock|\bL3\b|P0|dependent/) ?? [''])[0]);
  await t.locator('.t-tabs__nav-item').filter({ hasText: /^自学进度$/ }).click();
  await t.waitForTimeout(1200);
  await shot(t, 'teacher-selfstudy');
  const selfStudy = await teacherApi('GET', `/teacher/classes/${cls.classId}/self-study`);
  const row = (selfStudy.students ?? selfStudy.rows ?? []).find((r) => /张三|小明/.test(JSON.stringify(r)));
  console.log('self-study row', JSON.stringify(row ?? selfStudy).slice(0, 300));
  check('自学进度记下了看过解答', /"(solutions?[A-Za-z]*|revealed|solutionsViewed|viewedSolutions)":\s*[1-9]/.test(JSON.stringify(row ?? {})), JSON.stringify(row ?? selfStudy).slice(0, 200));
  await t.locator('.t-tabs__nav-item').filter({ hasText: /^名单$/ }).click();
  await t.waitForTimeout(1200);
  await shot(t, 'teacher-roster');
  check('名单显示已设密码，并能重置', (await t.getByTestId('roster-reset-password').count()) >= 1);

  await t.goto(`${BASE}/t/problems`, { waitUntil: 'networkidle' });
  await t.waitForTimeout(1500);
  await shot(t, 'teacher-problems');
  if (bundle) check('题库有“AI 整理”的题', (await t.locator('body').innerText()).includes('AI 整理'));
  await t.close();
});

await browser.close();
web.close();
server.kill();

console.log('\n== 汇总');
check('没有页面错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('没有 CSP 违规', cspViolations.length === 0, cspViolations.slice(0, 2).join(' | '));
check('没有接口 5xx', http5xx.length === 0, [...new Set(http5xx)].slice(0, 5).join(' | '));
check('服务端没有错误日志', serverErrors.length === 0, serverErrors.slice(0, 2).join(' | '));
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n'));
fs.writeFileSync(path.join(DIR, 'server.log'), serverLog);
process.exit(failed > 0 ? 1 : 0);
