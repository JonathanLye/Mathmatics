/**
 * #46 严格测验模式 e2e（mock 构建；真实服务端字段待 B 补，见 apps/student/src/types/attempt.ts ExamView）。
 *
 * 覆盖（390 手机 + 1280 桌面）：
 *  A. 说明页：规则 + 剩余时间 + 「切出 3 次锁定」→ 点开始才进入作答；
 *  B. 开始后：水印可见、倒计时可见、拍照/求助禁用、复制/粘贴/右键被 preventDefault 且上报 blocked；
 *  C. 切出次数警告：第 1/2 次弹窗；第 3 次服务端锁定 → 遮罩「本题已锁定，请联系老师」；
 *  D. 教师解锁（mock 服务端模拟 hook）→ 恢复作答；
 *  E. pageerror 空、无横向溢出；关键截图保存到 tests/.artifacts/flows-46。
 *
 * 注意：切出次数由服务端维护（11 §5.2）；e2e 用 mock 构建里显式的 window.__PG_EXAM_MOCK__
 * 模拟「服务端收到切出/教师解锁后返回新 state」，页面本身不做本地判定。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-46')

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

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function hasOverflow(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement
    return root.scrollWidth > root.clientWidth + 1
  })
}

/** uni-app 的 <button> 编译成 <uni-button>（自定义元素），Playwright isDisabled 不认；直接断言 disabled 属性。 */
async function isDisabled(page, testId) {
  const attr = await page.getByTestId(testId).first().getAttribute('disabled')
  return attr !== null
}

async function runViewport(browser, base, name, contextOptions) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(name + ': ' + (error instanceof Error ? error.message : String(error))))
  try {
    await page.goto('about:blank')
    await page.goto(base + '/#/pages/practice/index?exam=1', { waitUntil: 'networkidle' })
    await waitTestId(page, 'exam-intro')
    const introText = await bodyText(page)
    check(name + ' · 说明页出现且含「切出 3 次锁定」规则', introText.includes('第 3 次将锁定本题'))
    check(name + ' · 说明页显示服务端剩余时间', /\d{2}:\d{2}/.test(await page.getByTestId('exam-intro-remaining').innerText()))
    check(name + ' · 说明页阶段水印未出现（点开始后才进入）', (await countTestId(page, 'exam-watermark')) === 0)
    await page.screenshot({ path: path.join(outDir, name + '-1-intro.png'), fullPage: false })

    // 开始：必须点「开始」才进入作答
    await page.getByTestId('exam-start').click()
    await page.getByTestId('exam-intro').waitFor({ state: 'detached', timeout: 8000 })
    await waitTestId(page, 'exam-watermark')
    const countdown = await page.getByTestId('exam-countdown').innerText()
    check(name + ' · 开始后水印可见', (await countTestId(page, 'exam-watermark')) > 0)
    check(name + ' · 开始后倒计时可见', /\d{2}:\d{2}/.test(countdown), countdown)
    await page.screenshot({ path: path.join(outDir, name + '-2-answering.png'), fullPage: true })

    // 限制：拍照（手机 dock）/求助入口关闭 / 复制粘贴右键拦截
    if (contextOptions.isMobile) {
      // 拍照现在是输入器里的分段：打开输入器看分段的 aria-disabled，点了也不切过去。
      await page.getByTestId('write-next').click()
      await page.getByTestId('composer-tab-photo').waitFor({ state: 'visible', timeout: 5000 })
      check(name + ' · 拍照按钮禁用', (await page.getByTestId('composer-tab-photo').getAttribute('aria-disabled')) === 'true')
      // 分段是 aria-disabled，Playwright 默认不点；force 把点击发过去，验证点了也不切。
      await page.getByTestId('composer-tab-photo').click({ force: true })
      check(name + ' · 点拍照分段不会切过去', (await page.getByTestId('photo-take').count()) === 0)
      await page.getByTestId('editor-cancel').click()
      await page.getByTestId('editor-sheet').waitFor({ state: 'detached', timeout: 5000 })
      check(name + ' · 求助入口禁用（布置关闭提示）', await isDisabled(page, 'dock-help'))
    } else {
      check(name + ' · 求助入口禁用（桌面页边栏）', await isDisabled(page, 'exam-help-aside'))
    }

    const prevented = await page.evaluate(() => {
      const copy = new ClipboardEvent('copy', { cancelable: true, bubbles: true })
      document.dispatchEvent(copy)
      const paste = new ClipboardEvent('paste', { cancelable: true, bubbles: true, clipboardData: new DataTransfer() })
      document.dispatchEvent(paste)
      const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true })
      document.dispatchEvent(menu)
      const selection = new Event('selectstart', { cancelable: true, bubbles: true })
      document.dispatchEvent(selection)
      return { copy: copy.defaultPrevented, paste: paste.defaultPrevented, menu: menu.defaultPrevented, selection: selection.defaultPrevented }
    })
    check(name + ' · 复制/粘贴/右键/选中都被 preventDefault', Object.values(prevented).every(Boolean), JSON.stringify(prevented))

    const reported = await page.evaluate(async () => {
      const api = window.__PG_EVENTS__
      if (!api) return null
      await api.flush('manual')
      await new Promise((resolve) => setTimeout(resolve, 120))
      return api.events().map((event) => ({ type: event.type, payload: event.payload }))
    })
    const copyBlocked = Array.isArray(reported) && reported.some((event) => event.type === 'integ.copy' && event.payload?.blocked === true)
    const pasteBlocked = Array.isArray(reported) && reported.some((event) => event.type === 'paste' && event.payload?.blocked === true)
    const menuBlocked = Array.isArray(reported) && reported.some((event) => event.type === 'integ.contextmenu' && event.payload?.blocked === true)
    check(name + ' · 拦截事件上报 blocked（paste/copy/contextmenu）', copyBlocked && pasteBlocked && menuBlocked, JSON.stringify(reported?.filter((event) => String(event.type).startsWith('integ.') || event.type === 'paste').slice(-6)))

    // 切出警告：由 mock「服务端」返回新 state（前端不自行累加）
    const away = async () => {
      await page.evaluate(() => window.__PG_EXAM_MOCK__?.away())
    }
    await away()
    await waitTestId(page, 'exam-leave-warning')
    const warn1 = await page.getByTestId('exam-leave-warning-text').innerText()
    check(name + ' · 第 1 次切出警告文案', warn1.includes('你已离开 1 次') && warn1.includes('第 3 次将锁定本题'), warn1)
    await page.getByTestId('exam-warn-dismiss').click()
    await page.getByTestId('exam-leave-warning').waitFor({ state: 'detached', timeout: 5000 })

    await away()
    await waitTestId(page, 'exam-leave-warning')
    const warn2 = await page.getByTestId('exam-leave-warning-text').innerText()
    check(name + ' · 第 2 次切出警告文案', warn2.includes('你已离开 2 次'), warn2)
    await page.getByTestId('exam-warn-dismiss').click()
    await page.getByTestId('exam-leave-warning').waitFor({ state: 'detached', timeout: 5000 })

    await away()
    await waitTestId(page, 'exam-locked-mask')
    const lockedText = await page.getByTestId('exam-locked-title').innerText()
    check(name + ' · 第 3 次切出后显示服务端锁定遮罩', lockedText.includes('本题已锁定，请联系老师'), lockedText)
    check(name + ' · 锁定时没有切出警告弹窗', (await countTestId(page, 'exam-leave-warning')) === 0)
    await page.screenshot({ path: path.join(outDir, name + '-3-locked.png'), fullPage: true })

    // 教师解锁：mock hook 返回 active state（warnings 保留）
    await page.evaluate(() => window.__PG_EXAM_MOCK__?.unlock())
    await page.getByTestId('exam-locked-mask').waitFor({ state: 'detached', timeout: 8000 })
    await waitTestId(page, 'exam-bar')
    check(name + ' · 教师解锁后恢复作答（遮罩消失）', (await countTestId(page, 'exam-locked-mask')) === 0)
    await page.screenshot({ path: path.join(outDir, name + '-4-unlocked.png'), fullPage: true })

    check(name + ' · 全程无横向溢出', !(await hasOverflow(page)))
  } catch (error) {
    check(name + ' · 场景未中断', false, error instanceof Error ? error.message : String(error))
  } finally {
    await context.close()
  }
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-46] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-46] 找不到 chromium，可设置 PG_CHROMIUM'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  try {
    await runViewport(browser, base, 'mobile-390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await runViewport(browser, base, 'desktop-1280', { viewport: { width: 1280, height: 800 } })
    check('pageerror 为空', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-46] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
