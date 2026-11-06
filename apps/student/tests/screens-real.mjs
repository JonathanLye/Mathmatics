/**
 * 学生端真实后端截图（给人工核查用）：对已起好的 server + H5 dev server（VITE_USE_MOCK=false），
 * 用真实登录/年龄/同意/首页/做题页路径截图。浅色/深色 × 手机 390。只读 + 登录，不改题目数据。
 * 用法：PG_STUDENT_URL=http://127.0.0.1:5175 PG_INVITE=<邀请码> PG_FRESH_NO=<浅色学号,深色学号（从未登录过）> [PG_FRESH_INVITE=<它们所在班的邀请码>] PG_BUSY_NO=<已做到 L3 的学号> node tests/screens-real.mjs
 * 输出：tests/.artifacts/screens-real/<light|dark>/NN-name.png
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const BASE = process.env.PG_STUDENT_URL ?? 'http://127.0.0.1:5175';
const INVITE = process.env.PG_INVITE ?? '';
// 新同学：浅色/深色各用一个从未登录过的学号（逗号分隔两个）；可属于另一个班（PG_FRESH_INVITE）。
const FRESH_LIST = (process.env.PG_FRESH_NO ?? '').split(',').filter(Boolean);
const FRESH_INVITE = process.env.PG_FRESH_INVITE ?? INVITE;
const BUSY = process.env.PG_BUSY_NO ?? '';
if (!INVITE || FRESH_LIST.length === 0 || !BUSY) {
  console.error('缺少 PG_INVITE / PG_FRESH_NO / PG_BUSY_NO');
  process.exit(2);
}
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.artifacts', 'screens-real');

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
const problems = [];

async function login(page, no, invite = INVITE) {
  await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle' });
  await page.getByTestId('login-invite').locator('input').first().fill(invite).catch(async () => page.getByTestId('login-invite').fill(invite));
  await page.getByTestId('login-studentno').locator('input').first().fill(no).catch(async () => page.getByTestId('login-studentno').fill(no));
}

async function run(theme) {
  const dir = path.join(OUT, theme);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const mk = async (viewport) => {
    const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${theme}: ${String(e)}`));
    return { ctx, page };
  };
  const shot = async (page, name) => {
    await page.waitForTimeout(700);
    n += 1;
    await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`${theme} ${name}: 横向溢出 ${overflow}px`);
  };

  // 新同学：登录 → 年龄 → 同意 → 首页 → 开始做题
  {
    const { ctx, page } = await mk({ width: 390, height: 844 });
    await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle' });
    await shot(page, 'login');
    await login(page, FRESH_LIST[theme === 'dark' ? 1 : 0] ?? FRESH_LIST[0], FRESH_INVITE);
    await page.getByTestId('login-submit').click();
    // 同一个新同学第二次跑（深色）时已完成年龄/同意，直接到首页。
    const next = await Promise.race([
      page.getByTestId('age-page').waitFor({ timeout: 10000 }).then(() => 'age'),
      page.getByTestId('home-page').waitFor({ timeout: 10000 }).then(() => 'home'),
    ]);
    if (next === 'age') {
      await shot(page, 'age');
      await page.getByTestId('age-option-ge18').click();
      await page.getByTestId('age-submit').click();
      await page.getByTestId('consent-page').waitFor({ timeout: 10000 });
      await shot(page, 'consent');
      await page.getByTestId('consent-submit').click();
    }
    await page.getByTestId('home-page').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await shot(page, 'home-new');
    await ctx.close();
  }
  // 已做到第 3 层、领过提示的同学：首页 → 继续 → 做题页 → 求助抽屉
  {
    const { ctx, page } = await mk({ width: 390, height: 844 });
    await login(page, BUSY);
    await page.getByTestId('login-submit').click();
    await page.getByTestId('home-page').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await shot(page, 'home-busy');
    const go = page.getByTestId('home-inprogress-card').first();
    await go.click().catch(() => problems.push(`${theme}: 首页没有进行中的卡片`));
    await page.waitForTimeout(2500);
    await shot(page, 'practice-l3');
    await page.getByTestId('dock-help').click().catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, 'help-drawer');
    await ctx.close();
  }
}

await run('light');
await run('dark');
await browser.close();
console.log(`问题 ${problems.length} 条\n${problems.join('\n')}\n输出：${OUT}`);
process.exit(problems.length === 0 ? 0 : 1);
