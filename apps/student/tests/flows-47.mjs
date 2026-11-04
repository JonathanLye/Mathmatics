/**
 * #47 接线 e2e：迁移题完整作答流程 + 自检自适应 + 图解接线 + 证明本「稍后重做」。
 *
 * 覆盖：
 * A. 完成页「再做一道迁移题」→ 迁移题子作答（任务卡 / #47 思路图 / 多行 / 批注 / 改写 / 删除 / 写完了）→ 回到完成页 → 证明本；
 * B. 证明本「稍后重做」（独立度分档 / 教师标记优先 / 冷却）→ 开始重做 → 新作答（L1）；
 * C. 第 4 层自检自适应：答错 → 先做下一题 → 隔题重试 → maxAttempts 封顶；
 * D. 图解接线：微课 seq-band（#47 收敛版）+ abs-triangle（#47 模板）。
 *
 * 严格性（沿用 PR #87/#89 审计口径）：
 * - 按钮/关键元素用 [data-testid] + role=button；真实鼠标点击，失败直接 FAIL，不回退 JS click；
 * - 监听 pageerror 并在结尾断言为空；390 手机 + 768 宽各验证一次无横向溢出。
 *
 * 前置：npm run build:mock
 * 用法：npm run e2e:flows:47
 * 产物：tests/.artifacts/flows-47/*.png + report.json（已 gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-47')

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

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
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

async function katexCount(page, testId) {
  return page.getByTestId(testId).locator('.katex').count()
}

async function isDisabled(page, testId) {
  return page.evaluate((id) => {
    const el = document.querySelector('[data-testid="' + id + '"]')
    return el ? el.hasAttribute('disabled') : null
  }, testId)
}

async function waitEnabled(page, testId, timeout = 8000) {
  await page.waitForFunction((id) => {
    const el = document.querySelector('[data-testid="' + id + '"]')
    return Boolean(el) && !el.hasAttribute('disabled')
  }, testId, { timeout })
}

async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
}

/** 真实点击：滚到可见后走鼠标事件；失败直接抛错（场景 catch 记 FAIL，不回退 JS click）。 */
async function tap(page, testId, label = testId, index = 0) {
  const loc = page.getByTestId(testId).nth(index)
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 8000 })
  console.log('      · 已点击 ' + label)
}

/** 填 uni-app textarea：data-testid 落在 <uni-textarea> 根节点上，真正的输入元素是内层 <textarea>。 */
async function fillTestId(page, testId, value) {
  const loc = page.getByTestId(testId)
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  const inner = loc.locator('textarea')
  const target = (await inner.count()) > 0 ? inner.first() : loc
  await target.fill(value)
}

async function openMock(page, base, mock) {
  await page.goto('about:blank')
  await page.goto(base + '/#/pages/practice/index?mock=' + mock, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 10000 })
}

async function addTransferLine(page, statement, justification) {
  await tap(page, 'transfer-add-line', '写下一行')
  await fillTestId(page, 'transfer-statement', statement)
  await fillTestId(page, 'transfer-justification', justification)
  await waitEnabled(page, 'transfer-editor-save')
  await tap(page, 'transfer-editor-save', '加入证明')
}

async function answerSelfcheck(page, itemId, text) {
  await fillTestId(page, 'selfcheck-input-' + itemId, text)
  await waitEnabled(page, 'selfcheck-submit-' + itemId)
  await tap(page, 'selfcheck-submit-' + itemId, '提交 ' + itemId)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-47] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-47] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  /** A：完成页 → 再做迁移题 → 完整作答（2 行 + 依据 + 批注 + 改写/删除）→ 写完了 → 完成页 → 证明本。 */
  const scenarioMigration = async (page) => {
    await openMock(page, base, 'completed')
    await waitTestId(page, 'completion-card')
    check('完成页有「再做一道迁移题」入口', (await countTestId(page, 'make-transfer')) === 1)
    await tap(page, 'make-transfer', '再做一道迁移题')
    await waitTestId(page, 'transfer-attempt')

    const text = await bodyText(page)
    check('进入迁移题子作答（kind=transfer、独立作答页）', text.includes('迁移题 · 完整作答') && text.includes('函数极限'))
    check('迁移题任务卡用 MathText 渲染', (await katexCount(page, 'transfer-attempt-task')) > 0)
    check('#47 迁移题思路对照图已接线（SVG）', (await page.getByTestId('transfer-outline').locator('svg').count()) === 1)
    check(
      '思路图文字可见（H5 SVG 标签改用 HTML 叠层）',
      (await page.getByTestId('transfer-outline').locator('.pg-svg__label').count()) >= 8 &&
        (await page.getByTestId('transfer-outline').innerText()).includes('函数极限'),
    )
    check('初始没有证明行、写完了不可点', (await countTestId(page, 'transfer-empty')) === 1 && (await isDisabled(page, 'transfer-finish')) === true)
    await page.screenshot({ path: path.join(outDir, '1-transfer-start.png'), fullPage: true })

    await addTransferLine(page, '当 0<|x-1|<δ 时，', '由 |x-1| 的定义，x 进入去心邻域')
    await waitTestId(page, 'transfer-line-1')
    check('加入第 1 行：行内批注 + 来源徽标', (await countTestId(page, 'transfer-note-1')) === 1 && (await bodyText(page)).includes('键盘'))

    // #153：迁移题批注卡片与 L3 一致（署名/时间/关闭），关闭只影响本页展示（不回写服务端）
    check(
      '迁移题批注卡片可关闭（#153）',
      (await countTestId(page, 'transfer-note-time-1')) === 1 && (await countTestId(page, 'transfer-note-dismiss-1')) === 1,
    )
    await tap(page, 'transfer-note-dismiss-1', '关闭迁移题批注')
    await waitGoneTestId(page, 'transfer-note-1')
    check('关闭迁移题批注后本页不再显示该条', (await countTestId(page, 'transfer-note-1')) === 0)
    await addTransferLine(page, '|f(x)-3|=2|x-1|<2δ=ε', '放大后取 δ=ε/2')
    await waitTestId(page, 'transfer-line-2')
    await waitEnabled(page, 'transfer-finish')
    check('两行 + 依据齐全 → 「写完了」可点（mock reducer 判定）', (await isDisabled(page, 'transfer-finish')) === false)
    await page.screenshot({ path: path.join(outDir, '2-transfer-lines.png'), fullPage: true })

    // 删除一行 → 不达标；再补回来 → 达标（删除/重写接线）
    await tap(page, 'transfer-delete-2', '删除第 2 行')
    await waitGoneTestId(page, 'transfer-line-2')
    check('删除一行后「写完了」重新置灰', (await isDisabled(page, 'transfer-finish')) === true)
    await addTransferLine(page, '|f(x)-3|=2|x-1|<2δ=ε', '放大后取 δ=ε/2')
    await waitTestId(page, 'transfer-line-2')
    await waitEnabled(page, 'transfer-finish')

    // 改写一行：编辑器带出原内容，改依据后保存
    await tap(page, 'transfer-edit-1', '改一行')
    await waitTestId(page, 'transfer-editor')
    await fillTestId(page, 'transfer-justification', '由 |x-1| 的定义（改）')
    await waitEnabled(page, 'transfer-editor-save')
    await tap(page, 'transfer-editor-save', '保存改写')
    await page.waitForFunction(() => (document.body.innerText || '').includes('（改）'))
    check('改写一行后新依据出现在行内', true)

    // 宽屏不横向溢出（02 §3）
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(200)
    check('迁移题作答页在 768 宽无横向溢出', await noOverflow(page))
    await page.screenshot({ path: path.join(outDir, '3-transfer-768.png'), fullPage: false })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(200)

    await tap(page, 'transfer-finish', '写完了')
    await waitTestId(page, 'transfer-complete-card')
    check('迁移题写完 → 子作答完成页', (await bodyText(page)).includes('迁移题完成'))
    await page.screenshot({ path: path.join(outDir, '4-transfer-done.png'), fullPage: true })
    await tap(page, 'back-to-parent', '回到本题完成页')
    await waitTestId(page, 'completion-card')
    check('回到本题完成页（父作答 state）', (await bodyText(page)).includes('本题完成'))
    await tap(page, 'add-to-notebook', '加入证明本')
    await page.waitForSelector('[data-testid="notebook-card"]', { state: 'visible', timeout: 10000 })
    check('完成页可进入证明本', (await countTestId(page, 'notebook-card')) >= 1)
  }

  /** B：证明本「稍后重做」分组 → 开始重做 → 新作答（L1）。 */
  const scenarioRedo = async (page) => {
    await waitTestId(page, 'redo-list')
    const redoText = await page.getByTestId('redo-list').innerText()
    check('证明本显示「稍后重做」分组', redoText.includes('稍后重做') && (await countTestId(page, 'redo-item-0')) === 1)
    const firstRedo = await page.getByTestId('redo-item-0').innerText()
    check('教师标记的题排最前（排序接线）', firstRedo.includes('老师/系统标记') && firstRedo.includes('交错级数'))
    check('近期完成进入冷却期（不推荐）', (await countTestId(page, 'redo-skipped')) === 1)
    check('依赖档题进入稍后重做（独立度分档）', redoText.includes('依赖'))
    await page.screenshot({ path: path.join(outDir, '5-proofbook-redo.png'), fullPage: true })

    await tap(page, 'redo-start-0', '开始重做')
    await waitTestId(page, 'layer1-form')
    check('「开始重做」发起新作答（回到第 1 层）', (await bodyText(page)).includes('第 1 层 · 记忆核验'))
    await page.screenshot({ path: path.join(outDir, '6-redo-new-attempt.png'), fullPage: true })
  }

  /** C：自检自适应：答错 → 先做下一题 → 隔题重试 → maxAttempts 封顶 → 完成。 */
  const scenarioSelfcheck = async (page) => {
    await openMock(page, base, 'l4-active')
    await waitTestId(page, 'selfcheck-form')
    check('自检自适应出第一题（SC1 依据维度）', (await countTestId(page, 'selfcheck-item-SC1')) === 1)

    await answerSelfcheck(page, 'SC1', '短')
    await waitTestId(page, 'selfcheck-item-SC2')
    await page.waitForFunction(() => (document.querySelector('[data-testid="selfcheck-hint"]')?.textContent || '').includes('先做下一题'))
    check('答错后提示「先做下一题」并换题', true)

    await answerSelfcheck(page, 'SC2', 'N 只依赖 ε，与 n 无关。')
    await waitTestId(page, 'selfcheck-retry-SC1')
    check('隔一道题后回来重试答错题', (await page.getByTestId('selfcheck-hint').innerText()).includes('再试一次'))

    await answerSelfcheck(page, 'SC1', '短')
    await waitTestId(page, 'selfcheck-item-SC3')
    const progressText = await page.getByTestId('selfcheck-progress').innerText()
    check('maxAttempts 封顶：一题次数用尽后跳过', progressText.includes('次数用尽'))
    await page.screenshot({ path: path.join(outDir, '7-selfcheck-adaptive.png'), fullPage: true })

    await answerSelfcheck(page, 'SC3', '把 n>N 换成 n≥1，第 2 行会断。')
    await waitTestId(page, 'selfcheck-item-SC5')
    await answerSelfcheck(page, 'SC5', '用到了 n 是正整数（n+2>n>0）。')
    await waitTestId(page, 'transfer-form')
    check('自检结束 → 第 5 层迁移题', (await bodyText(page)).includes('第 5 层 · 迁移题'))
  }

  /** D：图解接线：微课 seq-band（#47 收敛版）+ abs-triangle。 */
  const scenarioDiagrams = async (page) => {
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    await tap(page, 'layer1-lesson', '看不懂')
    await waitTestId(page, 'micro-course')
    check('微课 seq-band 图解（SVG）', (await page.getByTestId('seq-band-svg').count()) === 1)
    check('seq-band 坐标/阈值文字可见', (await page.getByTestId('seq-band').locator('.pg-svg__label').count()) >= 5)
    check('seq-band 默认 N 与种子参数一致（ε=0.3 → N=3）', (await page.getByTestId('seq-band-n').innerText()).includes('3'))
    await tap(page, 'micro-option-0', '第 1 步正确选项')
    await waitTestId(page, 'micro-feedback-right')
    await tap(page, 'micro-next', '下一步')
    await page.waitForFunction(() => (document.querySelector('[data-testid="micro-stepno"]')?.textContent || '').includes('第 2 / 5 步'))
    await waitTestId(page, 'abs-triangle')
    check('微课第 2 步接入 abs-triangle 图解（SVG）', (await page.getByTestId('abs-triangle').locator('svg').count()) === 1)
    check('abs-triangle 刻度/距离文字可见', (await page.getByTestId('abs-triangle').locator('.pg-svg__label').count()) >= 4)
    await page.screenshot({ path: path.join(outDir, '8-micro-diagrams.png'), fullPage: true })
    await tap(page, 'micro-close', '关闭微课')
    await waitGoneTestId(page, 'micro-course')
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => {
      pageErrors.push(err instanceof Error ? err.message : String(err))
    })

    for (const [name, scenario] of [
      ['迁移题完整流程', scenarioMigration],
      ['证明本稍后重做', scenarioRedo],
      ['自检自适应', scenarioSelfcheck],
      ['图解接线', scenarioDiagrams],
    ]) {
      try {
        await scenario(page)
      } catch (e) {
        check('场景「' + name + '」未中断（点击/等待失败即 FAIL）', false, e instanceof Error ? e.message : String(e))
      }
    }

    check('390 宽无横向溢出', await noOverflow(page))
    check('页面无未捕获 JS 异常（pageerror）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    await ctx.close()
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-47] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
