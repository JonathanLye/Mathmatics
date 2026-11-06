/**
 * 教师端页面截图集（给人工核查用）：对一个已有数据的班级，按 浅色/深色 × 桌面 1280 / 手机 390 截全套页面。
 * 用法：PG_TEACHER_URL=http://127.0.0.1:5174 PG_TEACHER_USER=… PG_TEACHER_PASSWORD=… PG_CLASS_ID=<班级 id> [PG_FOCUS_NAME=吴磊] node tests/screens-teacher.mjs
 * 输出：tests/.artifacts/screens-teacher/<light|dark>-<desktop|mobile>/NN-name.png；只截图，不改数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const BASE = process.env.PG_TEACHER_URL ?? 'http://127.0.0.1:5174';
const USER = process.env.PG_TEACHER_USER ?? '';
const PASSWORD = process.env.PG_TEACHER_PASSWORD ?? '';
const CLASS_ID = process.env.PG_CLASS_ID ?? '';
const FOCUS = process.env.PG_FOCUS_NAME ?? '';
if (USER === '' || PASSWORD === '' || CLASS_ID === '') {
  console.error('缺少 PG_TEACHER_USER / PG_TEACHER_PASSWORD / PG_CLASS_ID');
  process.exit(2);
}
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.artifacts', 'screens-teacher');

function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const exe = path.join(base, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });
const errors = [];
let count = 0;

async function run(theme, device, viewport) {
  const dir = path.join(OUT, `${theme}-${device}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport, colorScheme: theme });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}-${device}: ${String(e)}`));
  let n = 0;
  const shot = async (name, full = false) => {
    await page.waitForTimeout(500);
    n += 1;
    count += 1;
    await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: full });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) errors.push(`${theme}-${device} ${name}: 横向溢出 ${overflow}px`);
  };
  const setTheme = async () => {
    await page.evaluate((t) => {
      if (t === 'dark') document.documentElement.setAttribute('theme-mode', 'dark');
      else document.documentElement.removeAttribute('theme-mode');
    }, theme);
  };

  await page.goto(`${BASE}/t/login`, { waitUntil: 'networkidle' });
  await setTheme();
  await shot('login');
  await page.getByPlaceholder('用户名').fill(USER);
  await page.getByPlaceholder('密码').fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/t/classes', { timeout: 15000 });
  await setTheme();
  await page.locator('[data-testid^="class-card-"]').first().waitFor({ timeout: 8000 });
  await shot('classes');

  await page.goto(`${BASE}/t/classes/${CLASS_ID}`, { waitUntil: 'networkidle' });
  await setTheme();
  await page.waitForTimeout(6500);
  await shot('live-cards', true);

  await page.locator('.stat-card').filter({ hasText: '在写' }).first().click();
  await shot('live-filter-writing');
  await page.getByText('清除', { exact: true }).click();

  await page.getByRole('button', { name: '表格' }).click().catch(() => {});
  await shot('live-table', true);
  await page.getByRole('button', { name: '卡片' }).click().catch(() => {});

  const focus = FOCUS === '' ? page.locator('.live-tile, [data-testid^="live-tile"]').first() : page.getByText(FOCUS, { exact: true }).first();
  await focus.click().catch(() => errors.push(`${theme}-${device}: 没找到学生卡片`));
  await page.getByText('学生作答详情').waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  await shot('student-drawer');
  await page.keyboard.press('Escape');
  await page.locator('.t-drawer__close-btn').first().click().catch(() => {});
  await page.waitForTimeout(700);

  for (const [label, name] of [['名单', 'roster'], ['布置', 'assignments'], ['指标', 'metrics'], ['导出', 'export'], ['设置', 'class-settings']]) {
    await page.locator('.t-tabs__nav-item').filter({ hasText: label }).first().click();
    await page.waitForTimeout(1200);
    await shot(name, true);
  }

  await page.goto(`${BASE}/t/problems`, { waitUntil: 'networkidle' });
  await setTheme();
  await shot('problems');
  await page.getByText('审核', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1000);
  await shot('problem-review');
  await page.goto(`${BASE}/t/settings`, { waitUntil: 'networkidle' });
  await setTheme();
  await shot('account-settings');
  await context.close();
}

await run('light', 'desktop', { width: 1280, height: 900 });
await run('dark', 'desktop', { width: 1280, height: 900 });
await run('light', 'mobile', { width: 390, height: 844 });
await run('dark', 'mobile', { width: 390, height: 844 });
await browser.close();
console.log(`共 ${count} 张；问题 ${errors.length} 条\n${errors.join('\n')}\n输出：${OUT}`);
process.exit(errors.length === 0 ? 0 : 1);
