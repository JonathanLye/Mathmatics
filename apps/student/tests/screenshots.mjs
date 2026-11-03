/**
 * 三档宽度截图 + 横向溢出断言（DoD #8/#10：390/768/1280 无溢出）。
 * 用法：先 npm run build:h5，再 npm run e2e:screens
 * 依赖：playwright-core + 本机 ms-playwright 的 chromium（可用 PG_CHROMIUM 指定）。
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
const outDir = path.join(__dirname, '.artifacts', 'screens')

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
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const exe = path.join(base, d, sub, 'chrome.exe')
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

const PAGES = [
  { name: 'login', hash: '#/pages/login/index' },
  { name: 'consent', hash: '#/pages/consent/index' },
  { name: 'home', hash: '#/pages/home/index' },
  { name: 'practice-l1', hash: '#/pages/practice/index?mock=l1-active' },
  { name: 'practice-l3', hash: '#/pages/practice/index?mock=l3-active' },
  { name: 'practice-exhausted', hash: '#/pages/practice/index?mock=l3-exhausted' },
  { name: 'practice-completed', hash: '#/pages/practice/index?mock=completed' },
  { name: 'proofbook', hash: '#/pages/proofbook/index' },
]
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, isMobile: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: true },
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
]

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[screens] 缺少构建产物：' + distDir + '，先运行 npm run build:h5')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[screens] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir, 0)
  const port = server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const results = []
  let overflow = 0
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, deviceScaleFactor: 1 })
      const page = await ctx.newPage()
      for (const pg of PAGES) {
        await page.goto('http://127.0.0.1:' + port + '/' + pg.hash, { waitUntil: 'networkidle' })
        await page.waitForTimeout(500)
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
        const bad = scrollWidth > clientWidth + 1
        if (bad) overflow++
        const file = path.join(outDir, vp.name + '-' + pg.name + '.png')
        await page.screenshot({ path: file, fullPage: true })
        results.push({ viewport: vp.name, page: pg.name, scrollWidth, clientWidth, horizontalOverflow: bad, file: path.relative(appDir, file) })
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2), 'utf8')
  for (const r of results) console.log(r.viewport.padEnd(8) + ' ' + r.page.padEnd(22) + ' scroll=' + r.scrollWidth + ' client=' + r.clientWidth + (r.horizontalOverflow ? '  !! 横向溢出' : '  ok'))
  console.log('[screens] 共 ' + results.length + ' 张；横向溢出 ' + overflow + ' 处；输出：' + outDir)
  if (overflow > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
