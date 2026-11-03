/**
 * 第 1、2 层表单流程 e2e（issue #11 DoD：mock 下能走完 L1→L2→L3）。
 *
 * 覆盖：
 * 1) 打开 #/pages/practice/index?mock=l1-active → 输入定义 → 点「核对」→ 进入第 2 层；
 *    看通用骨架 → 输入框架 → 点「核对」→ 进入第 3 层（出现「写下一行」）。
 * 2) 第 1 层点「已掌握，跳过」→ 直接进入第 2 层。
 *
 * 用法：先 npm run build:h5，再 npm run e2e:flows
 * 依赖：playwright-core + 本机 ms-playwright 的 chromium（可用 PG_CHROMIUM 指定）。
 * 产物：tests/.artifacts/flows/*.png + report.json（目录已 gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows')

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

const results = []
let failed = 0

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function waitBodyText(page, needle, timeout = 6000) {
  await page.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout })
}

/** 找一个文本按钮的 uni-button 根元素（用于断言 disabled 状态）。 */
async function findButton(page, label) {
  const found = await page.evaluate((l) => {
    const btn = Array.from(document.querySelectorAll('uni-button')).find(
      (b) => (b.textContent || '').trim() === l,
    )
    if (!btn) return null
    return { disabled: btn.hasAttribute('disabled') }
  }, label)
  return found
}

async function waitButtonEnabled(page, label, timeout = 6000) {
  await page.waitForFunction((l) => {
    const btn = Array.from(document.querySelectorAll('uni-button')).find(
      (b) => (b.textContent || '').trim() === l,
    )
    return Boolean(btn) && !btn.hasAttribute('disabled')
  }, label, { timeout })
}

/** 点按钮：先真实点击；若被底部操作坞/预算条遮住则直接派发 click（uni-app 把 @tap 编译成 onClick）。 */
async function tap(page, label) {
  const loc = page.getByText(label, { exact: true }).first()
  await loc.waitFor({ state: 'visible', timeout: 6000 })
  await loc.scrollIntoViewIfNeeded()
  try {
    await loc.click({ timeout: 4000 })
  } catch {
    await loc.evaluate((el) => el.click())
  }
}

async function fillFirstTextarea(page, value) {
  const textarea = page.locator('textarea').first()
  await textarea.waitFor({ state: 'visible', timeout: 6000 })
  await textarea.fill(value)
}

async function openMock(page, port, mock) {
  // 先 about:blank 再进入目标 hash，强制 SPA 重新启动（同路径不同 hash 不会完整加载）
  await page.goto('about:blank')
  await page.goto('http://127.0.0.1:' + port + '/#/pages/practice/index?mock=' + mock, { waitUntil: 'networkidle' })
  await page.waitForSelector('textarea', { state: 'visible', timeout: 10000 })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows] 缺少构建产物：' + distDir + '，先运行 npm run build:h5')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const port = server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await ctx.newPage()

    // ---- 场景 1：L1 填写 → 核对 → L2 → 看通用骨架 → 核对 → L3 ----
    await openMock(page, port, 'l1-active')
    let text = await bodyText(page)
    check('打开 #/pages/practice/index?mock=l1-active 显示第 1 层表单', text.includes('第 1 层 · 记忆核验'))
    check('L1 任务说明由 MathText 渲染', text.includes('定义') && !text.includes('$\\{a_n\\}$'))
    check('L1 有 KaTeX 渲染的公式', (await page.locator('.katex').count()) > 0)
    check(
      'L1 有「核对」「看不懂」「已掌握，跳过」',
      text.includes('核对') && text.includes('看不懂') && text.includes('已掌握，跳过'),
    )
    const emptyDisabled = await findButton(page, '核对')
    check('L1 输入为空时「核对」不可点', Boolean(emptyDisabled && emptyDisabled.disabled))

    await fillFirstTextarea(page, '任取 $\\varepsilon>0$，存在 $N$，当 $n>N$ 时 $|a_n-A|<\\varepsilon$。')
    await waitBodyText(page, '公式预览')
    check('L1 输入后出现 MathText 公式预览', (await bodyText(page)).includes('公式预览'))
    await waitButtonEnabled(page, '核对')
    await page.screenshot({ path: path.join(outDir, '1-l1.png'), fullPage: true })

    await tap(page, '核对')
    await waitBodyText(page, '第 2 层 · 证明骨架')
    text = await bodyText(page)
    check('点「核对」后从 L1 进入 L2（出现「第 2 层」）', text.includes('第 2 层'))
    check(
      'L2 有「核对」「看通用骨架」「跳过」',
      text.includes('核对') && text.includes('看通用骨架') && text.includes('跳过'),
    )
    check('L2 未点按钮时不显示通用骨架', (await page.locator('.pg-layer__template').count()) === 0)
    await page.screenshot({ path: path.join(outDir, '2-l2.png'), fullPage: true })

    await tap(page, '看通用骨架')
    const templateBox = page.locator('.pg-layer__template')
    await templateBox.waitFor({ state: 'visible', timeout: 6000 })
    check(
      '点「看通用骨架」后用 MathText 展开模板',
      (await templateBox.innerText()).includes('待构造') && (await templateBox.locator('.katex').count()) > 0,
    )
    await page.screenshot({ path: path.join(outDir, '3-l2-template.png'), fullPage: true })

    await fillFirstTextarea(
      page,
      '任取 $\\varepsilon>0$。取 $N=$ ＿（待构造）。则当 $n>N$ 时，$\\cdots<\\varepsilon$。真正要解决的是：把 $|a_n-3|$ 控制成只含 $n$ 的量。',
    )
    await waitButtonEnabled(page, '核对')
    await tap(page, '核对')
    await waitBodyText(page, '写下一行')
    text = await bodyText(page)
    check('L2 点「核对」后进入 L3（出现「写下一行」）', text.includes('写下一行'))
    await page.screenshot({ path: path.join(outDir, '4-l3.png'), fullPage: true })

    // ---- 场景 2：L1 跳过 → L2 ----
    await openMock(page, port, 'l1-active')
    check('（跳过场景）重新打开 mock=l1-active', (await bodyText(page)).includes('第 1 层 · 记忆核验'))
    await tap(page, '已掌握，跳过')
    await waitBodyText(page, '第 2 层 · 证明骨架')
    check('点「已掌握，跳过」后从 L1 进入 L2', (await bodyText(page)).includes('第 2 层'))
    await page.screenshot({ path: path.join(outDir, '5-l1-skip.png'), fullPage: true })

    await ctx.close()
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2), 'utf8')
  console.log('[flows] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
