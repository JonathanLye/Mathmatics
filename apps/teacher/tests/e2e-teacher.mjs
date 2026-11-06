/**
 * 教师端 E2E harness（#23/#35/#42，A 对 #129 的 P3-2）：
 * 登录 → 建班/导名单/布置（API，复用浏览器 Cookie）→ 学生作答（独立 request context）
 * → 看板 → 学生详情 → 指标 → 导出 → 题库/审核只读页 → 390/768/1280 → 深色。
 *
 * 学生密码：脚本里的学生只用邀请码 + 学号登录、不设密码，所以被测服务必须关闭 STUDENT_PASSWORD_ENFORCE（开发默认关闭）。
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
// 学号每次运行不同：同一台服务上重复跑时，学生账号和年龄段已存在（年龄段记录后不可改），固定学号会在第二次运行时 409。
const STUDENT_NO = String(3_000_000 + Math.floor(Math.random() * 6_000_000));
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
      data: `${STUDENT_NO},测试学生\n`,
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
  await must(await studentCtx.post(`${BASE}/api/v1/auth/student/login`, { data: { inviteCode: cls.inviteCode, studentNo: STUDENT_NO, deviceId: '00000000-0000-4000-8000-0000000000e2' }, headers: WRITE }), 'student login');
  // #64/#152：学生写接口前先选年龄段（<14 关闭）。
  await must(await studentCtx.post('/api/v1/auth/student/age-band', { data: { ageBand: 'ge18' }, headers: WRITE }), 'age band');
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
  await page.goto(`${BASE}/t/classes`, { waitUntil: 'networkidle' });
  await page.locator(`[data-testid="class-card-${cls.classId}"]`).waitFor({ timeout: 5000 });
  await shot('01b-class-cards-1280');
  await page.goto(`${BASE}/t/classes/${cls.classId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6500);
  await shot('02-live-1280');
  // #169：数字卡筛选（在线）
  await page.locator('.stat-card').filter({ hasText: '在写' }).first().click();
  await page.getByText(/筛选：在写/).waitFor({ timeout: 5000 });
  await shot('02c-live-filter-1280');
  await page.getByText('清除', { exact: true }).click();
  // #167：名单列表（姓名/认领状态）
  await page.getByText('名单', { exact: true }).first().click();
  await page.getByText('测试学生').first().waitFor({ timeout: 10000 });
  await shot('02b-roster-1280');
  await page.getByText('实时看板', { exact: true }).first().click();
  await page.waitForTimeout(500);
  // #180：布置表单从已发布题目选择
  await page.locator('.t-tabs__nav-item').filter({ hasText: /^布置$/ }).click();
  await page.getByPlaceholder('选择已发布的题目版本').waitFor({ timeout: 10000 });
  await shot('02d-assignment-form-1280');
  await page.locator('.t-tabs__nav-item').filter({ hasText: /^实时看板$/ }).click();
  await page.waitForTimeout(400);
  // #166：按布置筛选看板
  await page.locator('.live-toolbar .t-select').first().waitFor({ timeout: 10000 });
  await shot('02a-live-switcher-1280');
  // #48 C 侧：看板实时连接应已建立（页面底部提示；文案去掉了 SSE 这类开发术语）
  await page.getByText(/实时连接正常/).waitFor({ timeout: 8000 });
  await page.locator('.live-tile:not([disabled])').first().click();
  await page.getByText('学生作答详情').waitFor({ timeout: 10000 });
  await shot('03-student-detail-1280');
  // 引擎状态级回放（#143）：打开回放并断言 engine 卡片
  await page.getByRole('button', { name: '回放' }).click();
  await page.getByText('作答回放', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText('已提交行').first().waitFor({ timeout: 15000 });
  const replayText = await page.locator('body').innerText();
  assert(!replayText.includes('现在只能按操作记录回放'), '回放回退到只按操作记录回放（题目信息没能加载）');
  assert(replayText.includes('按作答状态回放'), '回放弹窗缺少按作答状态回放的说明');
  assert(replayText.includes('已提交行'), '回放弹窗缺少作答状态卡片');
  await shot('03b-replay-engine-1280');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.getByText('指标', { exact: true }).click();
  await page.getByText('完成率').waitFor({ timeout: 10000 });
  await shot('04-metrics-1280');
  await page.getByText('导出', { exact: true }).click();
  await page.getByText('字段字典', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '创建导出任务' }).click();
  await page.getByText('任务', { exact: false }).first().waitFor({ timeout: 10000 });
  await page.getByRole('link', { name: '下载' }).waitFor({ timeout: 15000 });
  await shot('05-export-1280');
  // #176：班级默认设置页签
  await page.locator('.t-tabs__nav-item').filter({ hasText: /^设置$/ }).click();
  await page.getByText('默认提示额度').waitFor({ timeout: 10000 });
  await shot('05c-class-settings-1280');
  // #165：布置列表来自 GET /teacher/assignments（不再只显示会话内创建）
  await page.getByText('布置', { exact: true }).first().click();
  await page.getByText('数列极限 · ε-N').first().waitFor({ timeout: 10000 });
  await shot('05b-assignments-1280');

  await page.goto(`${BASE}/t/problems`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '题库' }).waitFor({ timeout: 10000 });
  await shot('06-problems-1280');
  // #182：学生视角预览四种典型状态
  // 全新 seed 只有已发布题目，用第一行（harness 不依赖环境里恰好有草稿）。
  await page.locator('tbody tr').first().locator('.t-link').filter({ hasText: '审核' }).click();
  await page.getByText('题目详情（含参考答案信息，仅老师可见）').waitFor({ timeout: 10000 });
  await page.getByText('学生视角预览', { exact: false }).first().click();
  await page.getByText('回忆定义').first().waitFor({ timeout: 10000 });
  // 逐个点开，断言各自内容；预览区只能出现 public 字段，不得出现 secret.keys 的文本（#183 A 复审）。
  const preview = page.locator('details').filter({ hasText: '学生视角预览' });
  const previewChecks = [
    ['回忆定义', null],
    ['写证明', '写证明：'],
    ['提示额度用完', '提示额度上限（题目设置）'],
    ['总结', '总结：'],
  ];
  for (const [label, text] of previewChecks) {
    await preview.locator('.t-tabs__nav-item').filter({ hasText: label }).click();
    if (text) await preview.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
  }
  const rawPackage = JSON.parse((await page.locator('.pkg-json').textContent()) ?? '{}');
  const secretTexts = (rawPackage.secret?.keys ?? []).flatMap((key) => [key.label, ...(key.examples ?? [])]).filter((t) => typeof t === 'string' && t.length >= 4);
  assert(secretTexts.length > 0, '题目包 secret.keys 应有文本可供负向断言');
  const previewText = (await preview.textContent()) ?? '';
  for (const secretText of secretTexts) {
    assert(!previewText.includes(secretText), `学生视角预览泄露 secret：${secretText}`);
  }
  await shot('06c-review-preview-1280');
  await page.keyboard.press('Escape');
  // #178：来源与最近审核列确实显示（插槽没进 columns 时不会渲染）
  await page.locator('thead').getByText('最近审核').waitFor({ timeout: 5000 });
  await page.locator('thead').getByText('来源').waitFor({ timeout: 5000 });
  // #171：题库状态筛选（已发布）：选中后每一行都应是已发布
  await page.locator('.problem-filters .t-select').first().click();
  await page.locator('.t-select__dropdown').getByText('已发布', { exact: true }).click();
  await page.getByText(/已显示 \d+ 道题/).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const filteredRows = await page.locator('tbody tr').count();
  assert(filteredRows >= 1, '题库筛选已发布应至少 1 行');
  const filteredPublished = await page.locator('tbody tr').filter({ hasText: '已发布' }).count();
  assert(filteredPublished === filteredRows, `筛选后应全是已发布：${filteredPublished}/${filteredRows}`);
  await shot('06a-problems-filter-1280');
  await page.goto(`${BASE}/t/settings`, { waitUntil: 'networkidle' });
  await page.getByText('布置作业的默认做法').waitFor({ timeout: 10000 });
  await shot('06b-settings-1280');

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
