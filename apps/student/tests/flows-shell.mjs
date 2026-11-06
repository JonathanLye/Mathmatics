/**
 * 外壳 e2e：五个标签、外观、退出登录、兜底页、错误页；全程带线上 CSP，撒花和弹层不能触发违规。
 *
 * 前置：pnpm run build:mock
 * 用法：pnpm run e2e:flows:shell
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist', 'build', 'h5')
const outDir = path.join(__dirname, '.artifacts', 'flows-shell')

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'"
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function serve(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(root, urlPath)
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

let failed = 0
function check(name, ok, detail = '') {
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

const TABS = [
  ['tab-path', 'home-page', '/pages/home/index'],
  ['tab-practice', 'practice-zone-page', '/pages/practice-zone/index'],
  ['tab-mistakes', 'mistakes-page', '/pages/mistakes/index'],
  ['home-proofbook', 'notebook-card', '/pages/proofbook/index'],
  ['tab-me', 'me-page', '/pages/me/index'],
]

async function main() {
  if (!fs.existsSync(distDir)) { console.error('[flows-shell] 先运行 pnpm run build:mock'); process.exit(2) }
  const exe = process.env.PG_CHROMIUM
  if (!exe || !fs.existsSync(exe)) { console.error('[flows-shell] 设置 PG_CHROMIUM 指向 chromium'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const pageErrors = []
  const cspViolations = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)))
  page.on('console', (msg) => {
    // uni-h5 自带样式里引用的导航栏阴影图（cdn.dcloud.net.cn）被 CSP 拦下，无功能影响，不算我们的违规。
    if (/Content Security Policy/i.test(msg.text()) && !msg.text().includes('cdn.dcloud.net.cn')) cspViolations.push(msg.text())
  })
  const goto = async (route) => {
    await page.goto('about:blank')
    await page.goto(base + '/#' + route, { waitUntil: 'networkidle' })
  }
  const tap = async (testId) => {
    const loc = page.getByTestId(testId).first()
    await loc.waitFor({ state: 'visible', timeout: 8000 })
    await loc.click({ timeout: 8000 })
  }
  const visible = (testId, timeout = 8000) => page.getByTestId(testId).first().waitFor({ state: 'visible', timeout })

  try {
    console.log('--- 五个标签 ---')
    await goto('/pages/home/index')
    await visible('tab-practice')
    const fit = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.pg-tabbar__item'))
      return {
        count: items.length,
        minWidth: Math.min(...items.map((el) => el.getBoundingClientRect().width)),
        clipped: items.filter((el) => el.querySelector('.pg-tabbar__label').scrollWidth > el.clientWidth).length,
      }
    })
    check('390 宽放得下五个标签，每个至少 44px，标签不被截断', fit.count === 5 && fit.minWidth >= 44 && fit.clipped === 0, JSON.stringify(fit))
    for (const [tab, marker, url] of TABS) {
      await tap(tab)
      await visible(marker)
      check('点 ' + tab + ' 到 ' + url, page.url().includes(url))
    }

    console.log('--- 外观 ---')
    await goto('/pages/me/index')
    await tap('me-theme-dark')
    check('选深色写 html[data-theme=dark]', (await page.locator('html').getAttribute('data-theme')) === 'dark')
    await page.reload({ waitUntil: 'networkidle' })
    await visible('me-page')
    check('刷新后还是深色', (await page.locator('html').getAttribute('data-theme')) === 'dark')
    await tap('me-theme-light')
    check('选浅色写 html[data-theme=light]', (await page.locator('html').getAttribute('data-theme')) === 'light')
    await tap('me-theme-system')
    check('跟随系统时去掉 data-theme', (await page.locator('html').getAttribute('data-theme')) === null)

    console.log('--- 退出登录 ---')
    await tap('me-logout')
    await visible('me-logout-cancel')
    await page.screenshot({ path: path.join(outDir, 'logout-dialog.png') })
    await tap('me-logout-cancel')
    await page.getByTestId('me-logout-cancel').waitFor({ state: 'detached', timeout: 5000 })
    check('取消后留在我的', page.url().includes('/pages/me/index'))
    await tap('me-logout')
    await tap('me-logout-confirm')
    await visible('login-submit') // 登录页是首页面，地址是 #/，不能靠 URL 判断
    check('确认后回到登录页', true)

    console.log('--- 兜底页 ---')
    await goto('/pages/nope/index')
    await visible('not-found-page')
    check('未知路由到兜底页', true)
    await page.screenshot({ path: path.join(outDir, 'not-found.png') })
    await tap('not-found-action')
    await visible('tab-path')
    check('兜底页能回到路径', true)

    console.log('--- 弹层（截图看样子）---')
    await goto('/pages/dev/gallery')
    await tap('gallery-open-sheet')
    await page.waitForTimeout(450)
    await page.screenshot({ path: path.join(outDir, 'sheet.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
    await tap('gallery-coach')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: path.join(outDir, 'coachmark.png') })
    await page.keyboard.press('Escape')
    await goto('/pages/dev/gallery')
    await tap('gallery-celebrate')
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(outDir, 'celebrate.png') })
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="celebration"] canvas')
      if (!canvas) return { canvas: false, pixels: 0 }
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let pixels = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) pixels++
      return { canvas: true, width: canvas.width, height: canvas.height, pixels }
    })
    check('庆祝时真的撒了花（画布上有像素）', painted.pixels > 0, JSON.stringify(painted))
    check('撒花和弹层没有触发 CSP 违规', cspViolations.length === 0, cspViolations.slice(0, 2).join(' | ').slice(0, 200))

    console.log('--- 渲染出错 ---')
    await goto('/pages/dev/gallery')
    await tap('gallery-crash')
    await visible('not-found-page')
    check('渲染崩溃整页换成错误页', page.url().includes('kind=error'))
    await page.screenshot({ path: path.join(outDir, 'error.png') })
    await tap('not-found-action')
    await page.waitForTimeout(500)
    check('错误页“再试一次”有响应', !page.url().includes('kind=error'), page.url())

    const unexpected = pageErrors.filter((msg) => !msg.includes('gallery'))
    check('没有未捕获异常（陈列页故意崩溃除外）', unexpected.length === 0, unexpected.slice(0, 2).join(' | ').slice(0, 200))
  } finally {
    await browser.close()
    server.close()
  }
  console.log('[flows-shell] 失败 ' + failed + ' 项')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
