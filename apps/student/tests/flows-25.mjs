/**
 * #25 拍照识别 A 侧 e2e（Playwright + build:mock）。
 *
 * 覆盖：
 *  A. mock：点拍照 → 注入 fixture 图片（filechooser）→ 压缩 → mock /recognitions/photo 返回 3 行
 *     → 逐行确认面板（MathText/bbox）→「全部加入」→ 3 行追加到证明行列表（provenance=photo）。
 *  B. 真实模式 404：page.route 拦截 GET /attempts/{id} 返回状态、POST /recognitions/photo 返回 404
 *     → 提示「识别记录或作答不存在，请重新拍照/确认，或用键盘」，不渲染假识别结果。
 *  C. pageerror 为空、390 无横向溢出。
 *
 * 用法：先 npm run build:mock，再 npm run e2e:flows:25（PG_CHROMIUM 可指定 chromium）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-25')

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

const results = []
let failed = 0
const pageErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

async function waitTestId(page, testId, timeout = 12000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function hasOverflow(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement
    return root.scrollWidth > root.clientWidth + 1
  })
}

/**
 * 点击拍照按钮，然后把 fixture 注入 uni.chooseImage 生成的 input[type=file]。
 * 说明：uni.chooseImage H5 会动态创建 input 并 click()；headless 下 filechooser 事件不总稳定，
 * 直接定位该 input 用 setInputFiles 更可靠（仍走真实 change → uni tempFilePaths 路径）。
 */
async function clickPhotoWithFile(page, fixturePath) {
  // 必须先注册 filechooser 监听再点击：H5 会同步创建并打开 input[type=file]，
  // 未拦截时 headless 可能立刻 cancel，页面按「用户取消」关闭识别流程。
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 })
  await page.locator('.pg-dock__btn--photo').first().click()
  const chooser = await chooserPromise
  await chooser.setFiles(fixturePath)
}

const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
)

const REAL_ATTEMPT = '11111111-1111-4111-8111-111111111111'

function realState() {
  return {
    attemptId: REAL_ATTEMPT,
    stateVersion: 3,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem: {
      problemId: 'epsN',
      version: 1,
      title: '数列极限 · ε-N',
      stem: '用 $\\varepsilon$-$N$ 定义证明极限。',
      chapter: '第二章 数列极限',
      keyCount: 4,
    },
    currentLayer: 'L3',
    layers: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((layer, index) => ({
      layer,
      title: ['记忆核验', '证明骨架', '构造与推导', '自检', '迁移题', '总结'][index],
      status: layer === 'L1' || layer === 'L2' ? 'done' : layer === 'L3' ? 'active' : 'locked',
      enabled: true,
      skippable: ['L1', 'L2', 'L4', 'L5'].includes(layer),
    })),
    budget: { revealUsed: 0, revealMax: 2, keysOwn: 0, keysTotal: 4 },
    def: { task: '写出定义。', conceptId: 'seq-limit', submissions: 1, last: '任取 ε>0。', lessonSuggested: false },
    frame: { task: '写出骨架。', template: null, last: '取 N=…', templateShown: true },
    steps: { lines: [], canFinish: false },
    notes: [],
    help: { hintAvailable: true, nextLevel: 'H0', nextCost: 0, waitSec: 0, needAttempt: false, rapidLockUntil: null, exhausted: false, flagged: false, stuckOffer: false },
    integrity: { mode: 'practice', locked: false, warnings: 0, maxWarnings: null, notice: null, watermark: null },
    serverTime: new Date().toISOString(),
  }
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-25] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-25] 找不到 chromium，可设置 PG_CHROMIUM'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })
  const fixturePath = path.join(outDir, 'photo-fixture.png')
  fs.writeFileSync(fixturePath, FIXTURE_PNG)

  const server = await serve(distDir)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  // ---------- A. mock：拍照 → 逐行确认 → 全部加入 ----------
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const pageA = await contextA.newPage()
  pageA.on('pageerror', (error) => pageErrors.push('mock: ' + (error instanceof Error ? error.message : String(error))))
  try {
    await pageA.goto('about:blank')
    await pageA.goto(base + '/#/pages/practice/index?mock=l3-active', { waitUntil: 'networkidle' })
    await pageA.waitForFunction(() => document.body.innerText.includes('写证明'), { timeout: 15000 })
    const beforeLines = await countTestId(pageA, 'proof-line')
    check('mock：做题页初始行列表可见', beforeLines >= 2, 'lines=' + beforeLines)

    await clickPhotoWithFile(pageA, fixturePath)
    await waitTestId(pageA, 'photo-recognition-panel', 20000)
    const summary = await pageA.getByTestId('photo-lines-summary').innerText()
    check('拍照后出现逐行确认面板（3 行）', summary.includes('识别出 3 行'), summary)
    check('面板逐行展示 MathText/bbox', (await countTestId(pageA, 'photo-line-0')) === 1 && (await pageA.getByTestId('photo-line-bbox-0').innerText()).includes('位置'))
    check('逐行文本含第 3 行中文', (await pageA.getByTestId('photo-line-2').innerText()).includes('取'))
    await pageA.screenshot({ path: path.join(outDir, '1-photo-panel.png'), fullPage: true })

    await pageA.getByTestId('photo-add-selected').click()
    await pageA.getByTestId('photo-recognition-panel').waitFor({ state: 'detached', timeout: 20000 })
    await pageA.waitForFunction((count) => document.querySelectorAll('[data-testid="proof-line"]').length >= count, beforeLines + 3, { timeout: 15000 })
    const afterLines = await countTestId(pageA, 'proof-line')
    check('全部加入后新增 3 行', afterLines === beforeLines + 3, 'before=' + beforeLines + ' after=' + afterLines)
    check('加入行显示拍照来源徽标', (await bodyText(pageA)).includes('拍照'))
    check('加入 toast', (await bodyText(pageA)).includes('已加入 3 行'))
    check('390 宽无横向溢出（mock）', !(await hasOverflow(pageA)))
    await pageA.screenshot({ path: path.join(outDir, '2-lines-added.png'), fullPage: true })
  } catch (error) {
    check('mock 拍照流程未中断', false, error instanceof Error ? error.message : String(error))
  } finally {
    await contextA.close()
  }

  // ---------- B. 真实模式：404=作答/识别记录不存在（不是“即将上线”） ----------
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const pageB = await contextB.newPage()
  pageB.on('pageerror', (error) => pageErrors.push('404: ' + (error instanceof Error ? error.message : String(error))))
  try {
    await pageB.route('**/api/v1/attempts/**', (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: realState() }) })
    })
    await pageB.route('**/api/v1/recognitions/photo**', (route) =>
      route.fulfill({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: '请求的内容不存在' } }),
      }),
    )
    await pageB.goto('about:blank')
    await pageB.goto(base + '/#/pages/practice/index?api=real&attemptId=' + REAL_ATTEMPT, { waitUntil: 'networkidle' })
    await pageB.waitForFunction(() => document.body.innerText.includes('写证明'), { timeout: 20000 })
    await clickPhotoWithFile(pageB, fixturePath)
    await pageB.waitForFunction(() => document.body.innerText.includes('识别记录或作答不存在，请重新拍照/确认，或用键盘'), { timeout: 20000 })
    check('404：提示「识别记录或作答不存在，请重新拍照/确认，或用键盘」', true)
    check('404：不渲染假识别面板', (await countTestId(pageB, 'photo-recognition-panel')) === 0)
    check('404：不新增证明行', (await countTestId(pageB, 'proof-line')) === 0)
    await pageB.screenshot({ path: path.join(outDir, '3-404-real-semantics.png'), fullPage: true })
  } catch (error) {
    check('404 真实语义流程未中断', false, error instanceof Error ? error.message : String(error))
  } finally {
    await contextB.close()
  }

  check('pageerror 为空', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  await browser.close()
  await new Promise((resolve) => server.close(resolve))

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-25] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
