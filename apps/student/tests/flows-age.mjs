/**
 * #145 学生端年龄分档 + guardianNotice e2e（stacked on B #131）。
 *
 * 前置：npm run build:mock（?mock= 与 mock me 只在 DEV / VITE_ENABLE_MOCK=1 时生效）
 * 用法：npm run e2e:flows:age
 *
 * 场景（mock me 默认 ge18，?ageBand=null|lt14|14to17 覆盖，供本脚本）：
 *  1) ageBand=null 开做题页 → 被送到年龄选择页 → 选 ge18 → 继续原目标（回到做题页）；
 *  2) ageBand=lt14 → 年龄页「暂不开通」；在年龄页主动选 lt14 提交后同样被挡（无继续入口）；
 *  3) ageBand=14to17 开同意页 → guardianNotice 只读（无开关、不签署），5 个可签项不变，提交后进首页；
 *  4) 默认 ge18 直接进做题页（守卫不拦截既有流程）；
 *  5) 登录（ageBand=null）后先去年龄页，选档后回到原目标（同意页）。
 * 严格性：按钮用 data-testid 定位、真实点击；监听 pageerror 并断言无未捕获异常。
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const distDir = path.join(appDir, 'dist', 'build', 'h5')
const outDir = path.join(__dirname, '.artifacts', 'flows-age')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  ].filter(Boolean)
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()
    for (const d of dirs) {
      for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux64', 'chrome-linux']) {
        const exe = path.join(base, d, sub, sub.startsWith('chrome-win') ? 'chrome.exe' : 'chrome')
        if (fs.existsSync(exe)) return exe
      }
    }
  }
  return null
}

function serve(root, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(root, urlPath)
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

const results = []
let failed = 0
const pageErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}
async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}
async function waitTestId(page, testId, timeout = 10000) {
  await page.getByTestId(testId).first().waitFor({ state: 'visible', timeout })
}
async function waitGoneTestId(page, testId, timeout = 10000) {
  await page.waitForSelector('[data-testid="' + testId + '"]', { state: 'detached', timeout })
}
async function tap(page, testId, label = testId) {
  const loc = page.getByTestId(testId).first()
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 8000 })
  console.log('      · 已点击 ' + label)
}
/** 先 about:blank 再进目标 hash，保证每次场景都是全新的 SPA（mock 年龄 override 也重置）。 */
async function gotoRoute(page, base, route) {
  await page.goto('about:blank')
  await page.goto(base + '/#' + route, { waitUntil: 'networkidle' })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-age] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-age] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)))

  try {
    // ---------------- 场景 1：null → 选择 → 练习 ----------------
    console.log('--- 场景 1：未选年龄 → 年龄选择页 → 选 ≥18 → 回到做题页 ---')
    await gotoRoute(page, base, '/pages/practice/index?mock=l3-active&ageBand=null')
    await waitTestId(page, 'age-page')
    check('ageBand=null：进入做题页前被送到年龄选择页', (await countTestId(page, 'age-page')) === 1)
    check('年龄页给出三档', (await countTestId(page, 'age-option-ge18')) === 1
      && (await countTestId(page, 'age-option-14to17')) === 1
      && (await countTestId(page, 'age-option-lt14')) === 1)
    check('<14 风险说明可见', (await page.getByTestId('age-risk-note').first().innerText()).includes('暂不开通'))
    check('未选年龄时看不到做题页', !(await bodyText(page)).includes('写下一行'))
    await page.screenshot({ path: path.join(outDir, '1-age-choose.png'), fullPage: true })

    await tap(page, 'age-option-ge18', '选「18 岁及以上」')
    await tap(page, 'age-submit', '确认分档')
    await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
    check('选 ge18 后继续原目标（回到做题页）', (await countTestId(page, 'age-page')) === 0 && (await bodyText(page)).includes('写下一行'))
    await page.screenshot({ path: path.join(outDir, '2-back-to-practice.png'), fullPage: true })

    // ---------------- 场景 2：lt14 阻止进入 ----------------
    console.log('--- 场景 2：lt14 → 暂不开通（直接带参数 + 年龄页主动选） ---')
    await gotoRoute(page, base, '/pages/practice/index?mock=l3-active&ageBand=lt14')
    await waitTestId(page, 'age-page')
    await waitTestId(page, 'age-blocked')
    const blockedText = await page.getByTestId('age-blocked').innerText()
    check('ageBand=lt14：年龄页显示「暂不开通」', blockedText.includes('暂不开通'))
    check('lt14 风险说明可见', blockedText.includes('监护人'))
    check('lt14 没有「确认分档」/「继续」入口', (await countTestId(page, 'age-submit')) === 0 && (await countTestId(page, 'age-continue')) === 0)
    check('lt14 进不了做题页', !(await bodyText(page)).includes('写下一行'))
    await page.screenshot({ path: path.join(outDir, '3-lt14-blocked.png'), fullPage: true })

    await gotoRoute(page, base, '/pages/practice/index?mock=l3-active&ageBand=null')
    await waitTestId(page, 'age-page')
    await tap(page, 'age-option-lt14', '选「未满 14 岁」')
    await tap(page, 'age-submit', '确认分档（lt14）')
    await waitTestId(page, 'age-blocked')
    check('在年龄页主动选 lt14：提交后展示暂不开通，不继续', (await countTestId(page, 'age-continue')) === 0 && !(await bodyText(page)).includes('写下一行'))

    // ---------------- 场景 3：14to17 → guardianNotice 只读 ----------------
    console.log('--- 场景 3：14–17 同意页 guardianNotice 只读、不签署 ---')
    await gotoRoute(page, base, '/pages/consent/index?ageBand=14to17')
    await waitTestId(page, 'consent-page')
    await waitTestId(page, 'consent-item-guardianNotice')
    check('14to17 同意书含 guardianNotice 只读段', (await bodyText(page)).includes('建议告知监护人'))
    check('guardianNotice 标记为「只读说明」', (await page.getByTestId('consent-readonly-badge').innerText()).includes('只读说明'))
    const guardianSwitchCount = await page
      .getByTestId('consent-item-guardianNotice')
      .locator('[data-testid^="consent-switch-"]')
      .count()
    check('guardianNotice 段没有开关（不签署）', guardianSwitchCount === 0, '开关数 ' + guardianSwitchCount)
    const signableSwitchCount = await page.locator('[data-testid^="consent-switch-"]').count()
    check('其他 5 个可签项逻辑不变', signableSwitchCount === 5, '开关数 ' + signableSwitchCount)
    await page.screenshot({ path: path.join(outDir, '4-guardian-notice.png'), fullPage: true })
    await tap(page, 'consent-submit', '同意并开始')
    await waitTestId(page, 'home-page')
    check('14to17 签署后进入首页', (await countTestId(page, 'home-page')) === 1)

    // ---------------- 场景 4：ge18 直接进入（不阻塞既有流程） ----------------
    console.log('--- 场景 4：默认 ge18 直接进做题页 ---')
    await gotoRoute(page, base, '/pages/practice/index?mock=l3-active')
    await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
    check('默认 ge18：不弹年龄页、直接进入做题页', (await countTestId(page, 'age-page')) === 0 && (await bodyText(page)).includes('写下一行'))

    // ---------------- 场景 5：登录（null）→ 年龄页 → 原目标（同意页） ----------------
    console.log('--- 场景 5：登录后先去年龄页，选档后继续原目标 ---')
    await gotoRoute(page, base, '/pages/login/index?ageBand=null')
    await waitTestId(page, 'login-submit')
    await page.getByTestId('login-invite').locator('input').fill('ABC123')
    await page.getByTestId('login-studentno').locator('input').fill('2026001')
    await tap(page, 'login-submit', '登录')
    await waitTestId(page, 'age-page')
    check('登录后（null）先去年龄选择页', (await countTestId(page, 'age-page')) === 1)
    await tap(page, 'age-option-14to17', '选「14–17 岁」')
    await tap(page, 'age-submit', '确认分档')
    await waitTestId(page, 'consent-page')
    check('选档后继续原目标（同意页）', (await countTestId(page, 'consent-page')) === 1)
    check('14to17：同意页出现 guardianNotice', (await countTestId(page, 'consent-item-guardianNotice')) === 1)
    await page.screenshot({ path: path.join(outDir, '5-login-to-consent.png'), fullPage: true })

    check('页面无未捕获 JS 异常', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300))
  } catch (e) {
    failed++
    console.log('FAIL 场景异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ') : String(e)))
    try {
      await page.screenshot({ path: path.join(outDir, 'error.png'), fullPage: true })
    } catch { /* 忽略 */ }
  } finally {
    await ctx.close()
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-age] PASS ' + results.filter((r) => r.ok).length + ' · FAIL ' + failed)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
