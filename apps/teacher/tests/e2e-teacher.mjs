/**
 * 教师端 E2E harness（#23/#35/#42，A 对 #129 的 P3-2）：
 * 登录 → 建班/导名单/布置（API，复用浏览器 Cookie）→ 学生作答（独立 request context）
 * → 看板 → 学生详情 → 指标 → 导出 → 题库/审核只读页 → 390/768/1280 → 深色。
 *
 * 前置：API server（默认 127.0.0.1:3000）+ 教师 dev server（默认 127.0.0.1:5174，/api 代理）。
 * 环境变量：
 *   PG_TEACHER_URL      默认 http://127.0.0.1:5174
 *   PG_TEACHER_USER     必填（本地测试账号）
 *   PG_TEACHER_PASSWORD 必填
 *   PG_CHROMIUM         可选，Chromium/headless-shell 可执行文件路径
 * 产物：tests/.artifacts/e2e-teacher/（截图不入库）；发现断言失败退出码 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, request } from 'playwright-core';

const BASE = process.env.PG_TEACHER_URL ?? 'http://127.0.0.1:5174';
const USER = process.env.PG_TEACHER_USER ?? '';
const PASSWORD = process.env.PG_TEACHER_PASSWORD ?? '';
if (USER === '' || PASSWORD === '') {
  console.error('缺少 PG_TEACHER_USER / PG_TEACHER_PASSWORD');
  process.exit(2);
}
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.artifacts', 'e2e-teacher');
fs.mkdirSync(OUT, { recursive: true });

const WRITE = { 'x-requested-with': 'proof-gym' };
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
const failures = [];
const assert = (ok, message) => {
  if (!ok) failures.push(message);
};

function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const exe = path.join(base, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(exe)) return exe;
    }
    for (const dir of fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const exe = path.join(base, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findChromium(),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot:', name);
};

async function main() {
  // 1) 教师登录（UI）
  await page.goto(`${BASE}/t/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('用户名').fill(USER);
  await page.getByPlaceholder('密码').fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/t/classes', { timeout: 15000 });
  await shot('01-classes-1280');

  // 2) 教师 API setup（浏览器 Cookie 自动共享）
  const api = context.request;
  const must = async (response, label) => {
    if (!response.ok()) throw new Error(`${label}: HTTP ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const cls = await must(
    await api.post(`${BASE}/api/v1/teacher/classes`, { data: { name: `E2E 班 ${Date.now()}`, term: '2026 秋' }, headers: WRITE }),
    'create class',
  );
  await must(
    await api.post(`${BASE}/api/v1/teacher/classes/${cls.classId}/roster`, {
      data: '2026999,测试学生\n',
      headers: { ...WRITE, 'content-type': 'text/csv' },
    }),
    'roster',
  );
  const assignment = await must(
    await api.post(`${BASE}/api/v1/teacher/assignments`, {
      data: { classId: cls.classId, problemId: 'epsN', version: 1, mode: 'practice', openAt: new Date(Date.now() - 60_000).toISOString() },
      headers: WRITE,
    }),
    'assignment',
  );

  // 3) 学生作答（独立 request context，不共享教师 Cookie）
  const studentCtx = await request.newContext({ baseURL: BASE });
  await must(await studentCtx.post(`${BASE}/api/v1/auth/student/login`, { data: { inviteCode: cls.inviteCode, studentNo: '2026999', deviceId: '00000000-0000-4000-8000-0000000000e2' }, headers: WRITE }), 'student login');
  await must(await studentCtx.post(`${BASE}/api/v1/consents`, { data: { version: 'p0-v1', items: REQUIRED }, headers: WRITE }), 'consent');
  const started = await must(await studentCtx.post(`${BASE}/api/v1/student/assignments/${assignment.assignmentId}/attempt`, { headers: WRITE }), 'start');
  await must(await studentCtx.post(`/api/v1/attempts/${started.state.attemptId}/layers/L1/skip`, { data: {}, headers: WRITE }), 'skip L1');
  await must(await studentCtx.post(`/api/v1/attempts/${started.state.attemptId}/layers/L2/skip`, { data: {}, headers: WRITE }), 'skip L2');
  await must(
    await studentCtx.post(`/api/v1/attempts/${started.state.attemptId}/lines`, {
      data: { statement: '$|a_n-3|=\\frac{5}{n+2}$', justification: '通分', input: { provenance: 'keyboard', draftId: '00000000-0000-4000-8000-0000000000e3' } },
      headers: WRITE,
    }),
    'add line',
  );
  const live = await must(await api.get(`${BASE}/api/v1/teacher/classes/${cls.classId}/live`), 'live');
  assert(live.rows.length === 1, `live rows=${live.rows.length}`);
  const metrics = await must(await api.get(`${BASE}/api/v1/teacher/classes/${cls.classId}/metrics`), 'metrics');
  assert(metrics.n === 1, `metrics.n=${metrics.n}`);

  // 4) 看板/详情/指标/导出/题库
  await page.goto(`${BASE}/t/classes/${cls.classId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6500);
  await shot('02-live-1280');
  // #48 C 侧：看板 SSE 应已连接（页面底部提示）
  await page.getByText(/SSE 已连接/).waitFor({ timeout: 8000 });
  await page.locator('tbody tr').first().click();
  await page.getByText('学生作答详情').waitFor({ timeout: 10000 });
  await shot('03-student-detail-1280');
  // 引擎状态级回放（#143）：打开回放并断言 engine 卡片
  await page.getByRole('button', { name: '回放' }).click();
  await page.getByText('回放（引擎状态级）').waitFor({ timeout: 15000 });
  await page.getByText('已提交行').first().waitFor({ timeout: 15000 });
  const replayText = await page.locator('body').innerText();
  assert(!replayText.includes('题目包加载失败'), '引擎回放回退到事件级（题目包加载失败）');
  assert(replayText.includes('engine replay'), '回放弹窗缺少引擎状态级说明');
  assert(replayText.includes('已提交行'), '回放弹窗缺少 engine 卡片');
  await shot('03b-replay-engine-1280');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.getByText('指标', { exact: true }).click();
  await page.getByText('完成率').waitFor({ timeout: 10000 });
  await shot('04-metrics-1280');
  await page.getByText('导出', { exact: true }).click();
  await shot('05-export-1280');
  await page.goto(`${BASE}/t/problems`, { waitUntil: 'networkidle' });
  await page.getByText('题库与审核').waitFor({ timeout: 10000 });
  await shot('06-problems-1280');
  // #182：学生视角预览四种典型状态
  const draftRow = page.locator('tbody tr').filter({ hasText: '草稿' }).first();
  await draftRow.locator('.t-link').last().click();
  await page.getByText('题目详情（含 secret，仅教师可见）').waitFor({ timeout: 10000 });
  await page.getByText('学生视角预览', { exact: false }).first().click();
  await page.getByText('L1 定义').first().waitFor({ timeout: 10000 });
  const previewTabs = await page.locator('.t-tabs__nav-item-text-wrapper').allInnerTexts();
  for (const label of ['L1 定义', 'L3 骨架', '额度用完', 'L6 总结']) {
    assert(previewTabs.some((item) => item.trim() === label), `学生视角预览缺少：${label}`);
  }
  await shot('06c-review-preview-1280');
  await page.keyboard.press('Escape');

  // 5) 三档 + 深色
  await page.goto(`${BASE}/t/classes/${cls.classId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(400);
  await shot('07-live-768');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await shot('08-live-390');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '深色' }).click();
  await page.waitForTimeout(500);
  await shot('09-live-dark-1280');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `1280 横向溢出 ${overflow}px`);
  assert(pageErrors.length === 0, `pageerror: ${pageErrors.join(' | ')}`);
}

try {
  await main();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify({ base: BASE, failures, pageErrors }, null, 2)}\n`);
  await browser.close();
}
if (failures.length > 0) {
  console.error('E2E FAIL:', failures.join('\n'));
  process.exit(1);
}
console.log('E2E OK；产物：', OUT);
