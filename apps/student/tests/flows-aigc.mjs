/**
 * AIGC 显式标识 e2e（Refs #37 / task-90；12 §7 上线检查单）。
 *
 * 覆盖：
 * 1) URL 带 ?aigc=1（mock 测试开关）→ 第 1 层微课顶部出现「补充讲解」块 + 「AI 生成 · 仅作学习提示」标签；
 * 2) 默认 URL（不带开关，等价线上 P0：无 AI 生成文本）→ 不出现标签/补充讲解块；
 * 3) 全程无未捕获 JS 异常。
 *
 * 前置：npm run build:mock（dist/build/h5）。
 * 用法：npm run e2e:flows:aigc（CI student-e2e job 会自动跑所有 e2e:flows* 脚本）。
 * 产物：tests/.artifacts/flows-aigc/*.png + report.json（已 gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-aigc')

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
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'ms-playwright') : null,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean)
  const subPaths = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux64', 'chrome'],
    ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ]
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()
    for (const dir of dirs) {
      for (const sub of subPaths) {
        const exe = path.join(base, dir, ...sub)
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

async function waitTestId(page, testId, timeout = 8000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
}

async function waitGoneTestId(page, testId, timeout = 8000) {
  await page.waitForSelector('[data-testid="' + testId + '"]', { state: 'detached', timeout })
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function tap(page, testId, label = testId) {
  const loc = page.getByTestId(testId).first()
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 8000 })
  console.log('      · 已点击 ' + label)
}

async function openMock(page, base, mock, extra = '') {
  await page.goto('about:blank')
  await page.goto(base + '/#/pages/practice/index?mock=' + mock + extra, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-aigc] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[flows-aigc] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome 可执行文件')
    process.exit(2)
  }
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir, 0)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => { pageErrors.push(err instanceof Error ? err.message : String(err)) })

    // 1) 测试开关打开：微课显示生成补充讲解 + AIGC 标签
    await openMock(page, base, 'l1-active', '&aigc=1')
    await waitTestId(page, 'layer1-form')
    await tap(page, 'layer1-lesson', '看不懂')
    await waitTestId(page, 'micro-course')
    await waitTestId(page, 'aigc-tag')
    check('?aigc=1 时微课出现 AIGC 标签', (await countTestId(page, 'aigc-tag')) === 1)
    const tagText = (await page.getByTestId('aigc-tag').innerText()).trim()
    check('标签文案 = AI 生成 · 仅作学习提示', tagText === 'AI 生成 · 仅作学习提示', tagText)
    check('补充讲解块出现且含 mock 占位文本', (await countTestId(page, 'micro-generated')) === 1
      && (await page.getByTestId('micro-generated').innerText()).includes('（mock）'))
    check('标签位于补充讲解块内（每条 AI 生成文本下方）', (await page.getByTestId('micro-generated').getByTestId('aigc-tag').count()) === 1)
    check('补充讲解块有标题「补充讲解」', (await page.getByTestId('micro-generated').innerText()).includes('补充讲解'))
    await page.screenshot({ path: path.join(outDir, '1-aigc-tag-on.png'), fullPage: true })
    await tap(page, 'micro-close', '关闭微课')
    await waitGoneTestId(page, 'micro-course')

    // 2) 默认开关关闭：不显示标签/补充讲解（等价线上 P0 无生成文本）
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    await tap(page, 'layer1-lesson', '看不懂')
    await waitTestId(page, 'micro-course')
    check('默认（不带 ?aigc=1）不显示 AIGC 标签', (await countTestId(page, 'aigc-tag')) === 0)
    check('默认不显示补充讲解块', (await countTestId(page, 'micro-generated')) === 0)
    const bodyText = await page.evaluate(() => document.body.innerText)
    check('默认页面文本不含 AIGC 标识文案', !bodyText.includes('AI 生成 · 仅作学习提示'))
    await page.screenshot({ path: path.join(outDir, '2-aigc-tag-off.png'), fullPage: true })

    check('页面无未捕获 JS 异常（pageerror）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    await ctx.close()

    // 3) 深色模式（prefers-color-scheme: dark）：标签/补充讲解走 tokens，仍可见可读
    const darkCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
    })
    const darkPage = await darkCtx.newPage()
    darkPage.on('pageerror', (err) => { pageErrors.push(err instanceof Error ? err.message : String(err)) })
    await openMock(darkPage, base, 'l1-active', '&aigc=1')
    await waitTestId(darkPage, 'layer1-form')
    await tap(darkPage, 'layer1-lesson', '看不懂')
    await waitTestId(darkPage, 'micro-course')
    await waitTestId(darkPage, 'aigc-tag')
    check('深色模式（prefers-color-scheme: dark）下 AIGC 标签仍可见', (await countTestId(darkPage, 'aigc-tag')) === 1)
    const darkTagColor = await darkPage.evaluate(() => {
      const el = document.querySelector('[data-testid="aigc-tag"]')
      return el ? getComputedStyle(el).color : ''
    })
    check('深色模式标签颜色来自 tokens（非空且不是纯黑）', Boolean(darkTagColor) && darkTagColor !== 'rgb(0, 0, 0)', darkTagColor)
    await darkPage.screenshot({ path: path.join(outDir, '3-aigc-tag-dark.png'), fullPage: true })
    await darkCtx.close()
  } catch (error) {
    check('流程执行', false, error instanceof Error ? error.message : String(error))
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-aigc] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
