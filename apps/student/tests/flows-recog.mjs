/**
 * 识别确认面板端到端（#15/#25）：拍照 → 逐行确认面板（#25 起整页切行）→ 取消勾选/编辑 → 逐行加入/全部加入 → 忽略。
 *
 * 说明：旧 #15 的两路对比 + 差异高亮面板仍保留给「单行识别」回退；#25 拍照接口返回 lines 后
 * 使用 new PhotoRecognitionPanel（逐行 MathText/bbox/勾选/编辑）。
 * 用法：先 npm run build:mock，再 npm run e2e:flows:recog（PG_CHROMIUM 可指定 chromium）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-recog')

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

function serve(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(root, urlPath)
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

let pass = 0
let fail = 0
function ok(cond, name, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')) }
}
function includes(name, haystack, needle) {
  ok(String(haystack).includes(needle), name, '未找到「' + needle + '」，实际：' + String(haystack).replace(/\s+/g, ' ').slice(0, 220))
}
async function innerText(page, selector) {
  try { return await page.locator(selector).first().innerText({ timeout: 3000 }) } catch { return '' }
}
async function waitVisible(page, selector, timeout = 12000) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout })
}
async function waitGone(page, selector, timeout = 12000) {
  await page.locator(selector).first().waitFor({ state: 'detached', timeout })
}
async function count(page, selector) {
  return page.locator(selector).count()
}

const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
)

async function takePhoto(page, fixturePath) {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 })
  await page.locator('.pg-dock__btn--photo').first().click()
  const chooser = await chooserPromise
  await chooser.setFiles(fixturePath)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[recog] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[recog] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })
  const fixturePath = path.join(outDir, 'photo-fixture.png')
  fs.writeFileSync(fixturePath, FIXTURE_PNG)

  const server = await serve(distDir)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.message : String(error)))
  try {
    await page.goto('about:blank')
    await page.goto(base + '/#/pages/practice/index?mock=l3-active', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.body.innerText.includes('构造与推导'), { timeout: 15000 })
    await page.waitForTimeout(200)
    const before = await count(page, '[data-testid="proof-line"]')

    // 1) 拍照 → 逐行确认面板
    await takePhoto(page, fixturePath)
    await waitVisible(page, '[data-testid="photo-recognition-panel"]')
    includes('面板标题', await innerText(page, '.pg-photo__title'), '拍照识别 · 逐行确认')
    includes('3 行摘要', await innerText(page, '[data-testid="photo-lines-summary"]'), '识别出 3 行')
    ok((await count(page, '.pg-photo__line')) === 3, '逐行条目渲染（3 行）')
    includes('bbox 可见', await innerText(page, '[data-testid="photo-line-bbox-0"]'), '位置')

    // 2) 取消勾选第 2 行 → 已选变 2
    await page.getByTestId('photo-line-check-1').click()
    includes('取消勾选后摘要更新', await innerText(page, '[data-testid="photo-lines-summary"]'), '已选 2 行')

    // 3) 编辑第 1 行文本
    await page.getByTestId('photo-line-edit-0').click()
    const textarea = page.getByTestId('photo-line-input-0').locator('textarea').first()
    await textarea.fill('编辑后的第一行')
    await page.getByTestId('photo-line-edit-done-0').click()
    includes('编辑后行文本更新', await innerText(page, '[data-testid="photo-line-0"]'), '编辑后的第一行')

    // 4) 全部加入（2 行）→ 面板仍在（剩 1 行）
    await page.getByTestId('photo-add-selected').click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="proof-line"]').length >= n, before + 2, { timeout: 15000 })
    includes('加入后 toast', await innerText(page, '.pg-toast'), '已加入 2 行')
    includes('面板剩余 1 行', await innerText(page, '[data-testid="photo-lines-summary"]'), '识别出 1 行')

    // 5) 逐行加入剩余 1 行 → 面板关闭、总 +3
    // 上一批 add 之后 confirmRecognition 在途时面板按钮是禁用的；等它解除再点，避免点击落空。
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="photo-line-add-0"]')
      return Boolean(button) && !button.hasAttribute('disabled')
    }, { timeout: 10000 })
    await page.getByTestId('photo-line-add-0').click()
    await waitGone(page, '[data-testid="photo-recognition-panel"]')
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="proof-line"]').length >= n, before + 3, { timeout: 15000 })
    ok((await count(page, '[data-testid="proof-line"]')) === before + 3, '逐行加入后共新增 3 行')

    // 6) 再拍照 → 忽略 → 面板关闭、行数不变
    // 上一批 add 的 confirmRecognition 可能仍在途（recogBusy），稍等再拍避免被 busy 挡掉。
    await page.waitForTimeout(500)
    await takePhoto(page, fixturePath)
    await waitVisible(page, '[data-testid="photo-recognition-panel"]')
    await page.getByTestId('photo-ignore').click()
    await waitGone(page, '[data-testid="photo-recognition-panel"]')
    ok((await count(page, '[data-testid="proof-line"]')) === before + 3, '忽略后不新增行')
    includes('忽略 toast', await innerText(page, '.pg-toast'), '已忽略这次拍照识别')

    await page.screenshot({ path: path.join(outDir, 'recog-final.png'), fullPage: true })
    ok(pageErrors.length === 0, '页面无 JS 异常', pageErrors.slice(0, 2).join(' | '))
  } catch (error) {
    fail++
    console.log('FAIL 识别确认流程异常 :: ' + (error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' ') : String(error)))
  } finally {
    await context.close()
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('[recog] PASS ' + pass + ' · FAIL ' + fail)
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
