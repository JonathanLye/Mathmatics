/**
 * #37 微信内打开提示 e2e（Refs #37 / 12 §7 上线检查单）。
 *
 * 覆盖：
 * - 微信内置浏览器 UA（MicroMessenger）首次进入 登录页 / 首页 / 做题页 → 出现非阻塞提示；
 * - 「复制链接」→ clipboard 写入当前页面链接并给出反馈；
 * - 「我知道了」→ 本 tab sessionStorage 记住，刷新/同 tab 再进不显示；
 * - 新 tab（新 context）会重新提示；
 * - 普通 Chrome UA 不显示。
 *
 * 前置：npm run build:mock（?mock= 只在 DEV / VITE_ENABLE_MOCK=1 时生效）
 * 用法：npm run e2e:flows:wechat
 * 可选：PG_CHROMIUM 指向 chrome.exe（找不到时脚本会从 ms-playwright 目录兜底查找）
 * 产物：tests/.artifacts/flows-wechat/*.png + report.json（已 gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-wechat')

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

const UA = {
  androidWeChat:
    'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40.2420(0x28002833) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
}

const DISMISS_KEY = 'pg.wechatHintDismissed'

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
    if (!file.startsWith(root)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

const results = []
const pageErrors = []
let failed = 0

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

async function waitTestId(page, testId, timeout = 8000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
}

async function waitGoneTestId(page, testId, timeout = 8000) {
  await page.waitForSelector('[data-testid="' + testId + '"]', { state: 'detached', timeout })
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-wechat] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[flows-wechat] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe')
    process.exit(2)
  }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const origin = new URL(base).origin
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  const openPage = async (page, hash) => {
    await page.goto(base + '/#' + hash, { waitUntil: 'networkidle' })
  }
  const watchErrors = (page, tag) => {
    page.on('pageerror', (err) => {
      pageErrors.push(tag + ': ' + (err instanceof Error ? err.message : String(err)))
    })
  }

  try {
    // ---------- 场景 1：微信 UA 首次进入 登录页 / 首页 / 做题页 ----------
    const wechatCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: UA.androidWeChat,
    })
    await wechatCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    const page = await wechatCtx.newPage()
    watchErrors(page, 'wechat')

    await openPage(page, '/pages/login/index')
    await waitTestId(page, 'wechat-hint')
    const loginHintText = await page.getByTestId('wechat-hint-text').innerText()
    check('微信 UA 打开登录页：出现提示', (await countTestId(page, 'wechat-hint')) === 1)
    check('提示文案引导「在浏览器中打开」', loginHintText.includes('微信内打开') && loginHintText.includes('在浏览器中打开'))
    check(
      '提示含「复制链接」「我知道了」两个动作',
      (await countTestId(page, 'wechat-copy')) === 1 && (await countTestId(page, 'wechat-dismiss')) === 1,
    )
    await page.screenshot({ path: path.join(outDir, '1-login-wechat-hint.png'), fullPage: true })

    await openPage(page, '/pages/home/index')
    await page.waitForSelector('[data-testid="home-page"]', { state: 'visible', timeout: 10000 })
    await waitTestId(page, 'wechat-hint')
    check('微信 UA 打开首页：出现提示', (await countTestId(page, 'wechat-hint')) === 1)

    await openPage(page, '/pages/practice/index?mock=l3-active')
    await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
    await waitTestId(page, 'wechat-hint')
    check('微信 UA 打开做题页入口：出现提示', (await countTestId(page, 'wechat-hint')) === 1)
    await page.screenshot({ path: path.join(outDir, '2-practice-wechat-hint.png'), fullPage: true })

    // ---------- 场景 2：复制链接 ----------
    const href = await page.evaluate(() => location.href)
    await page.getByTestId('wechat-copy').click()
    await waitTestId(page, 'wechat-copy-state')
    const copyState = await page.getByTestId('wechat-copy-state').innerText()
    check('点「复制链接」：[已复制] 反馈可见', copyState.includes('已复制'), copyState)
    let copied = null
    let readError = ''
    try {
      copied = await page.evaluate(() => navigator.clipboard.readText())
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e)
    }
    check('剪贴板内容就是当前页面链接', copied === href, readError ? 'clipboard 读取失败：' + readError : '')
    // 复制后提示仍然存在（非阻塞，不自动关闭）
    check('复制后提示不消失（非阻塞）', (await countTestId(page, 'wechat-hint')) === 1)
    await page.screenshot({ path: path.join(outDir, '3-copied.png'), fullPage: true })

    // ---------- 场景 3：关闭后本 tab 不再显示 ----------
    await page.getByTestId('wechat-dismiss').click()
    await waitGoneTestId(page, 'wechat-hint')
    check('点「我知道了」后提示消失', (await countTestId(page, 'wechat-hint')) === 0)
    const stored = await page.evaluate((key) => sessionStorage.getItem(key), DISMISS_KEY)
    check('本 tab 记住已关闭（sessionStorage=1）', stored === '1', 'sessionStorage=' + String(stored))

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
    await page.waitForTimeout(300)
    check('刷新同一 tab 不再显示提示', (await countTestId(page, 'wechat-hint')) === 0)

    await openPage(page, '/pages/home/index')
    await page.waitForSelector('[data-testid="home-page"]', { state: 'visible', timeout: 10000 })
    await page.waitForTimeout(300)
    check('同 tab 再进首页不再显示提示', (await countTestId(page, 'wechat-hint')) === 0)
    await wechatCtx.close()

    // ---------- 场景 4：新 tab（新 context）重新提示 ----------
    const freshCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: UA.androidWeChat,
    })
    const freshPage = await freshCtx.newPage()
    watchErrors(freshPage, 'wechat-fresh')
    await openPage(freshPage, '/pages/login/index')
    await waitTestId(freshPage, 'wechat-hint')
    check('新 tab（新 sessionStorage）重新显示提示', (await countTestId(freshPage, 'wechat-hint')) === 1)
    await freshCtx.close()

    // ---------- 场景 5：普通 Chrome UA 不显示 ----------
    const chromeCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: UA.chrome,
    })
    const chromePage = await chromeCtx.newPage()
    watchErrors(chromePage, 'chrome')
    await openPage(chromePage, '/pages/practice/index?mock=l3-active')
    await chromePage.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
    await chromePage.waitForTimeout(500)
    check('普通 Chrome UA 不显示微信提示', (await countTestId(chromePage, 'wechat-hint')) === 0)
    await chromeCtx.close()

    check('页面无未捕获 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } catch (e) {
    check('微信提示 e2e 流程未中断（点击/等待失败即 FAIL）', false, e instanceof Error ? e.message : String(e))
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-wechat] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
