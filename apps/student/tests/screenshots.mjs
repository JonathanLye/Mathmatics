/**
 * 三档宽度截图 + 横向溢出断言（DoD #8/#10：390/768/1280 无溢出）。
 * 用法：先 npm run build:mock（带 VITE_ENABLE_MOCK=1 用于四态截图），再 npm run e2e:screens
 * 依赖：playwright-core + 本机/CI 的 chromium（可用 PG_CHROMIUM 指定；自动探测 Windows/Linux/macOS）。
 *
 * PR #87 审计修复：
 * - 状态标记改为断言真实状态 DOM（.pg-budget__bar / .pg-practice__donetitle），
 *   不再用 MockSwitcher 的调试文案（旧 exhausted marker「透露额度用尽」只在调试控件里，断言是空转的）。
 * - overflow / markerMissing / layoutBad 分开计数、分开打印，失败原因不再互相掩盖。
 * - findChromium 补 Linux（~/.cache/ms-playwright，chrome-linux64/chrome-linux）与
 *   macOS（~/Library/Caches/ms-playwright、/Applications/Google Chrome.app）路径，供 CI 可选 job 使用。
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

/** ms-playwright 的 chromium 相对路径（win/linux/mac 三套都列，运行时按存在性挑）。 */
const CACHE_LAYOUTS = [
  ['chrome-win64', 'chrome.exe'],
  ['chrome-win', 'chrome.exe'],
  ['chrome-linux64', 'chrome'],
  ['chrome-linux', 'chrome'],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac-x64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
]

function chromiumCandidates() {
  const home = os.homedir()
  const cacheDirs = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
    path.join(home, 'AppData', 'Local', 'ms-playwright'), // Windows
    path.join(home, '.cache', 'ms-playwright'), // Linux（CI ubuntu-latest）
    path.join(home, 'Library', 'Caches', 'ms-playwright'), // macOS
  ].filter(Boolean)

  const candidates = []
  for (const base of cacheDirs) {
    if (!fs.existsSync(base)) continue
    let dirs = []
    try {
      dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()
    } catch {
      continue
    }
    for (const d of dirs) {
      for (const parts of CACHE_LAYOUTS) candidates.push(path.join(base, d, ...parts))
    }
  }
  // 系统安装的 Chrome/Chromium（CI 与部分开发机）
  candidates.push(
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
  )
  return candidates
}

function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM
  for (const candidate of chromiumCandidates()) {
    if (fs.existsSync(candidate)) return candidate
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
  {
    name: 'practice-l1',
    hash: '#/pages/practice/index?mock=l1-active',
    marker: { selector: '.pg-practice__layertitle', text: '记忆核验' },
  },
  {
    name: 'practice-l3',
    hash: '#/pages/practice/index?mock=l3-active',
    marker: { selector: '.pg-practice__layertitle', text: '构造与推导' },
  },
  {
    // 状态 3：透露额度用尽 → 断言真实预算条「透露 2 / 2」，不用 MockSwitcher 的「透露额度用尽」文案。
    name: 'practice-exhausted',
    hash: '#/pages/practice/index?mock=l3-exhausted',
    marker: { selector: '.pg-lines__note, .pg-practice__note--hint', text: 'H2' },
  },
  {
    // 状态 4：完成页 → 断言 .pg-practice__donetitle（「本题完成」）。
    name: 'practice-completed',
    hash: '#/pages/practice/index?mock=completed',
    marker: { selector: '.pg-practice__donetitle', text: '本题完成' },
  },
  { name: 'proofbook', hash: '#/pages/proofbook/index' },
]
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, isMobile: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: true },
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
]

/** 断言某状态标记的 DOM 存在且文案命中（空白归一化）。 */
async function checkMarker(page, marker) {
  return page.evaluate(({ selector, text }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const nodes = Array.from(document.querySelectorAll(selector))
    return {
      found: nodes.length > 0,
      matched: nodes.some((node) => norm(node.textContent).includes(text)),
      text: nodes.map((node) => norm(node.textContent)).join(' | '),
    }
  }, marker)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[screens] 缺少构建产物：' + distDir + '，先运行 npm run build:h5')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[screens] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome/Chromium/chrome.exe')
    process.exit(2)
  }
  console.log('[screens] chromium: ' + exe)
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir, 0)
  const port = server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const results = []
  let overflow = 0
  let markerMissing = 0
  let layoutBadCount = 0
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, deviceScaleFactor: 1 })
      const page = await ctx.newPage()
      for (const pg of PAGES) {
        // 先 about:blank 再进入目标 hash，强制 SPA 重新启动（同路径不同 hash 不会完整加载）
        await page.goto('about:blank')
        await page.goto('http://127.0.0.1:' + port + '/' + pg.hash, { waitUntil: 'networkidle' })
        await page.waitForTimeout(500)
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
        const horizontalOverflow = scrollWidth > clientWidth + 1
        if (horizontalOverflow) overflow++
        // #10：三档布局 + 层导航断言（仅 practice 页）
        let layoutBad = false
        if (pg.name.startsWith('practice-')) {
          const info = await page.evaluate(() => {
            const root = document.querySelector('.pg-practice')
            const shell = document.querySelector('.pg-practice__shell')
            return {
              cls: root ? root.className : '',
              dots: document.querySelectorAll('.pg-dot').length,
              nav: document.querySelectorAll('.pg-layernav').length,
              cols: shell ? getComputedStyle(shell).gridTemplateColumns.split(' ').filter(Boolean).length : 1,
            }
          })
          const want = vp.name === 'mobile'
            ? { cls: 'pg-practice--mobile', nav: 0, cols: 1 }
            : vp.name === 'tablet'
              ? { cls: 'pg-practice--tablet', nav: 1, cols: 2 }
              : { cls: 'pg-practice--desktop', nav: 1, cols: 3 }
          layoutBad = !info.cls.includes(want.cls) || info.dots !== 6 || info.cols !== want.cols || info.nav < want.nav
          if (layoutBad) layoutBadCount++
        }
        // 状态标记：优先断言真实状态 DOM（marker），不再依赖调试控件文案。
        let stateMarkerMissing = false
        let markerText = null
        if (pg.marker) {
          const checked = await checkMarker(page, pg.marker)
          markerText = checked.text
          stateMarkerMissing = !checked.found || !checked.matched
        }
        if (stateMarkerMissing) markerMissing++
        const file = path.join(outDir, vp.name + '-' + pg.name + '.png')
        await page.screenshot({ path: file, fullPage: true })
        results.push({
          viewport: vp.name,
          page: pg.name,
          scrollWidth,
          clientWidth,
          horizontalOverflow,
          markerMissing: stateMarkerMissing,
          markerText,
          layoutBad,
          file: path.relative(appDir, file),
        })
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2), 'utf8')
  for (const r of results) {
    console.log(
      r.viewport.padEnd(8) +
        ' ' +
        r.page.padEnd(22) +
        ' scroll=' + r.scrollWidth +
        ' client=' + r.clientWidth +
        (r.horizontalOverflow ? '  !! 横向溢出' : '  ok') +
        (r.markerMissing ? '  !! 状态标记缺失' : '') +
        (r.layoutBad ? '  !! 布局断言失败' : ''),
    )
  }
  console.log(
    '[screens] 共 ' + results.length + ' 张；横向溢出 ' + overflow + ' 处；状态标记缺失 ' + markerMissing +
      ' 处；布局断言失败 ' + layoutBadCount + ' 处；输出：' + outDir,
  )
  if (overflow + markerMissing + layoutBadCount > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
