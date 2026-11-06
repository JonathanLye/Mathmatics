/**
 * 登录前“先试一道”e2e（生产构建 + 线上同款 CSP）：不登录走完剧本，全程不发任何接口请求。
 *
 * 前置：pnpm --filter @proof-gym/student build:mock
 * 用法：pnpm --filter @proof-gym/student e2e:flows:tour
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist', 'build', 'h5')
const outDir = path.join(__dirname, '.artifacts', 'flows-tour')
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'"
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (url.startsWith('/api/')) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end('{"error":{"code":"UNAUTHORIZED","message":"请先登录"}}')
    return
  }
  let file = path.join(distDir, url === '/' ? 'index.html' : url)
  if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const BASE = `http://127.0.0.1:${server.address().port}`

function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM
  const base = path.join(os.homedir(), '.cache', 'ms-playwright')
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse() : []) {
    const exe = path.join(base, dir, 'chrome-linux64', 'chrome')
    if (fs.existsSync(exe)) return exe
  }
  return undefined
}

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' -- ' + detail}`)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] })

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = []
  const violations = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (/Content Security Policy/.test(m.text()) && !/dcloud/.test(m.text())) violations.push(m.text())
  })

  // 从登录页入口进来
  await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle' })
  const skip = page.getByTestId('intro-skip')
  if (await skip.count()) await skip.click()
  await page.getByTestId('login-try').click()
  await page.getByTestId('tour-page').waitFor({ timeout: 10000 })
  check(`${name}: 登录页“先试一道”进入试玩`, page.url().includes('pages/tour/index'))

  // 从这里开始数请求：试玩页不能发任何接口请求
  const requests = []
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.method() + ' ' + r.url())
  })

  const tap = (id) => page.getByTestId(id).click()
  const lineCount = () => page.locator('[data-line-id]').count()
  const writeLine = async () => {
    await tap('write-next')
    await page.getByTestId('tour-composer').waitFor({ timeout: 5000 })
    await page.waitForTimeout(300)
    await tap('tour-submit')
    await page.getByTestId('tour-feedback-continue').waitFor({ timeout: 5000 })
    await page.waitForTimeout(300)
  }

  await page.screenshot({ path: path.join(outDir, `${name}-1-start.png`) })
  await writeLine()
  check(`${name}: 第 1 行写下，绿色反馈`, (await lineCount()) === 1 && (await page.locator('[data-feedback-tone="ok"]').count()) > 0)
  await page.screenshot({ path: path.join(outDir, `${name}-2-ok.png`) })
  await tap('tour-feedback-continue')

  await writeLine()
  check(`${name}: 第 2 行是助教的问题，不判错`, (await page.locator('[data-feedback-tone="sea"]').count()) > 0)
  await page.screenshot({ path: path.join(outDir, `${name}-3-question.png`) })
  await tap('tour-feedback-continue')
  const guide = await page.getByTestId('tour-guide').innerText()
  check(`${name}: 小方提示点灯泡`, guide.includes('灯泡'), guide)

  await tap('tour-help')
  await page.locator('.pg-help__intent--concept').waitFor({ timeout: 5000 })
  await page.locator('.pg-help__intent--concept').click()
  await page.waitForFunction(() => document.body.innerText.includes('向上取整'), null, { timeout: 8000 })
  check(`${name}: 求助抽屉给出引导`, true)
  await page.screenshot({ path: path.join(outDir, `${name}-4-help.png`) })
  await page.locator('.pg-help__close').click()
  await page.locator('.pg-help__close').waitFor({ state: 'detached', timeout: 5000 })
  const guideAfter = await page.getByTestId('tour-guide').innerText()
  check(`${name}: 问过之后提示改写第 2 行`, guideAfter.includes('第 2 行'), guideAfter)

  await writeLine()
  check(`${name}: 改写第 2 行后还是 2 行`, (await lineCount()) === 2)
  await tap('tour-feedback-continue')
  await writeLine()
  check(`${name}: 第 3 行写下`, (await lineCount()) === 3)
  await tap('tour-feedback-continue')

  await tap('tour-finish')
  await page.getByTestId('tour-login').waitFor({ timeout: 8000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(outDir, `${name}-5-done.png`) })
  check(`${name}: 走完剧本，全程 0 个接口请求`, requests.length === 0, requests.slice(0, 3).join(' | '))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${name}: 没有横向滚动`, overflow <= 0, String(overflow))

  await tap('tour-login')
  await page.getByTestId('login-submit').waitFor({ timeout: 8000 })
  check(`${name}: 回到登录页`, (await page.getByTestId('tour-page').count()) === 0)
  check(`${name}: 没有页面错误`, errors.length === 0, errors[0])
  check(`${name}: 没有 CSP 违规`, violations.length === 0, violations[0])

  // 直接打开试玩页也不应被跳去登录，也不发请求
  const direct = await ctx.newPage()
  const directRequests = []
  direct.on('request', (r) => {
    if (r.url().includes('/api/')) directRequests.push(r.url())
  })
  await direct.goto(`${BASE}/#/pages/tour/index`, { waitUntil: 'networkidle' })
  await direct.waitForTimeout(800)
  check(`${name}: 未登录直接打开试玩页不跳转`, await direct.getByTestId('tour-page').isVisible())
  check(`${name}: 直接打开也是 0 个接口请求`, directRequests.length === 0, directRequests.slice(0, 3).join(' | '))
  await ctx.close()
}

// 做题页就地提示：第一次进来出一条，点掉后不再出；测验里一条都不出（演示数据要先点“重看引导”才启用）
async function activate(page) {
  await page.goto(`${BASE}/#/pages/dev/gallery`, { waitUntil: 'networkidle' })
  await page.getByTestId('me-replay-onboarding').click()
  await page.waitForTimeout(600)
  const skip = page.getByTestId('intro-skip')
  if (await skip.count()) await skip.click()
  await page.waitForTimeout(300)
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await activate(page)
  await page.evaluate(() => { location.hash = '#/pages/practice/index?mock=l1-active' })
  const next = page.getByTestId('coachmark-next')
  await next.waitFor({ timeout: 8000 })
  check('就地提示：第一次进入这一层时出现', await next.isVisible())
  await page.screenshot({ path: path.join(outDir, 'coach-layer.png') })
  await next.click()
  await page.waitForTimeout(900)
  check('就地提示：点掉后消失且不再出现', (await next.count()) === 0)
  await page.getByTestId('dock-help').click()
  await next.waitFor({ timeout: 8000 })
  check('就地提示：第一次打开求助时出现', (await page.locator('.pg-coach__title').innerText()).includes('求助'))
  await page.screenshot({ path: path.join(outDir, 'coach-help.png') })
  await next.click()
  await page.waitForTimeout(300)
  await ctx.close()

  const exam = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const examPage = await exam.newPage()
  await activate(examPage)
  await examPage.evaluate(() => { location.hash = '#/pages/practice/index?mock=exam-active' })
  await examPage.waitForTimeout(2500)
  check('就地提示：测验里一条都不出', (await examPage.getByTestId('coachmark-next').count()) === 0)
  await exam.close()
}

await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
