/**
 * #26 全流程 e2e：微课 + seq-band 图解；L3 写完了 → L4 自检 → L5 迁移 → L6 总结 → 完成页 → 证明本。
 *
 * 严格性（沿用 PR #87/#89 审计口径）：
 * - 按钮/关键元素用 [data-testid] + role=button 定位；点击先 scrollIntoViewIfNeeded 再走真实鼠标事件，
 *   失败直接 FAIL（不回退 JS click）；
 * - 监听 pageerror，结尾断言无未捕获 JS 异常。
 *
 * 前置：npm run build:mock（?mock= 只在 DEV / VITE_ENABLE_MOCK=1 时生效）
 * 用法：npm run e2e:flows:26
 * 产物：tests/.artifacts/flows-26/*.png + report.json（已 gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-26')

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

async function nValue(page, testId) {
  return page.evaluate((id) => {
    const el = document.querySelector('[data-testid="' + id + '"]')
    const match = (el?.textContent || '').match(/\d+/)
    return match ? Number(match[0]) : null
  }, testId)
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

/** 点 seq-band 滑块的某一比例位置（uni-slider 的点击会按比例设置值）。 */
async function clickSliderAt(page, testId, ratio) {
  const loc = page.getByTestId(testId)
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  const box = await loc.boundingBox()
  if (!box) throw new Error('滑块不可见：' + testId)
  await loc.click({ position: { x: Math.max(2, Math.round(box.width * ratio)), y: Math.round(box.height / 2) } })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-26] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-26] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  /** 场景 1：第 1 层「看不懂」→ 微课 → seq-band 调 ε → 小核验（先错后对）→ 回到定义。 */
  const scenarioMicroCourse = async (page) => {
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    await tap(page, 'layer1-lesson', '看不懂')
    await waitTestId(page, 'micro-course')
    check('点「看不懂」打开第 1 层微课', (await bodyText(page)).includes('第 1 / 5 步'))
    check('微课正文由 MathText 渲染（KaTeX）', (await page.getByTestId('micro-course').locator('.katex').count()) > 0)

    await waitTestId(page, 'seq-band')
    check('微课含 seq-band 图解（SVG）', (await page.getByTestId('seq-band-svg').count()) === 1)
    const initialN = await nValue(page, 'seq-band-n')
    check('seq-band 按种子参数显示默认 N（ε=0.3 → N=3）', initialN === 3, 'N=' + initialN)

    await clickSliderAt(page, 'seq-band-slider', 0.85)
    const afterBig = await nValue(page, 'seq-band-n')
    check('拖动 ε 滑块调大 ε → N 不变或变小', afterBig !== null && initialN !== null && afterBig <= initialN, 'N=' + afterBig)
    await page.screenshot({ path: path.join(outDir, '1-micro-seqband.png'), fullPage: true })

    await clickSliderAt(page, 'seq-band-slider', 0.15)
    const afterSmall = await nValue(page, 'seq-band-n')
    check('调小 ε → N 变大（N 依赖 ε）', afterSmall !== null && afterBig !== null && afterSmall > afterBig, 'N=' + afterSmall)

    check('小核验可选（有选项按钮）', (await countTestId(page, 'micro-option-0')) === 1)
    await tap(page, 'micro-option-1', '错误选项')
    await waitTestId(page, 'micro-feedback-wrong')
    check('小核验答错：给引导、可重选、下一步不可点', (await isDisabled(page, 'micro-next')) === true)
    await tap(page, 'micro-option-0', '正确选项')
    await waitTestId(page, 'micro-feedback-right')
    check('小核验答对：绿色反馈 + 下一步可点', (await isDisabled(page, 'micro-next')) === false)
    await page.screenshot({ path: path.join(outDir, '2-micro-check.png'), fullPage: true })

    await tap(page, 'micro-next', '下一步')
    await page.waitForFunction(() => (document.querySelector('[data-testid="micro-stepno"]')?.textContent || '').includes('第 2 / 5 步'))
    check('微课可进入第 2 步', true)
    // 第 2–4 步都选第 1 个选项（mock 数据的正确答案），逐步前进
    for (const step of [2, 3, 4]) {
      await tap(page, 'micro-option-0', '第 ' + step + ' 步正确选项')
      await waitTestId(page, 'micro-feedback-right')
      await tap(page, 'micro-next', '下一步')
      if (step < 4) {
        await page.waitForFunction((next) => (document.querySelector('[data-testid="micro-stepno"]')?.textContent || '').includes('第 ' + next + ' / 5 步'), step + 1)
      }
    }
    await page.waitForFunction(() => (document.querySelector('[data-testid="micro-stepno"]')?.textContent || '').includes('第 5 / 5 步'))
    check('微课走到最后一步（回到定义）', (await countTestId(page, 'micro-return')) === 1)

    // 02 §3：平板 / 桌面宽度也不横向溢出（微课在 390 之外的两档宽度各截一张）。
    for (const width of [768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(200)
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      )
      check('微课在 ' + width + ' 宽无横向溢出', noOverflow)
      await page.screenshot({ path: path.join(outDir, 'micro-' + width + '.png'), fullPage: false })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(200)

    await tap(page, 'micro-return', '回到定义')
    await waitGoneTestId(page, 'micro-course')
    check('点「回到定义」关闭微课，回到第 1 层表单', (await countTestId(page, 'layer1-form')) === 1)
    await page.screenshot({ path: path.join(outDir, '3-back-to-definition.png'), fullPage: true })
  }

  /** 场景 2：L3 写完了 → L4 自检（含 followup）→ L5 迁移 → L6 总结 → 完成页 → 证明本。 */
  const scenarioFullFlow = async (page) => {
    await openMock(page, base, 'l3-ready')
    await page.waitForSelector('.pg-lines__add', { state: 'visible', timeout: 10000 })
    check('mock=l3-ready 打开第 3 层且「写完了」可点', (await isDisabled(page, 'finish-steps')) === false)
    await tap(page, 'finish-steps', '写完了')
    await waitTestId(page, 'selfcheck-form')

    check('进入第 4 层自检：3 道题', (await countTestId(page, 'selfcheck-item-SC1')) === 1 && (await bodyText(page)).includes('第 4 层 · 自检'))
    check('自检页只读展示自己写的证明', (await countTestId(page, 'selfcheck-proof')) === 1)

    // SC1 先答太短 → followup，再补一句 → accepted
    await fillTestId(page, 'selfcheck-input-SC1', '不知道')
    await waitEnabled(page, 'selfcheck-submit-SC1')
    await tap(page, 'selfcheck-submit-SC1', '提交 SC1（太短）')
    await waitTestId(page, 'selfcheck-followup-SC1')
    check('自检回答太短 → 只追问一句、不给讲解', (await page.getByTestId('selfcheck-followup-SC1').innerText()).includes('再具体'))
    await fillTestId(page, 'selfcheck-input-SC1', '第 1 行通分以后得到的。')
    await waitEnabled(page, 'selfcheck-submit-SC1')
    await tap(page, 'selfcheck-submit-SC1', '提交 SC1')
    await page.waitForFunction(() => (document.querySelector('[data-testid="selfcheck-status-SC1"]')?.textContent || '').includes('已通过'))
    check('自检回答合格 → 显示已通过', true)

    for (const itemId of ['SC2', 'SC3']) {
      await fillTestId(page, 'selfcheck-input-' + itemId, 'N 只依赖 ε，与 n 无关。')
      await waitEnabled(page, 'selfcheck-submit-' + itemId)
      await tap(page, 'selfcheck-submit-' + itemId, '提交 ' + itemId)
      if (itemId === 'SC3') {
        // 最后一题通过后服务端直接推进到第 5 层，自检表单会卸载，不能再等状态标记。
        await waitTestId(page, 'transfer-form')
      } else {
        await page.waitForFunction(
          (id) => (document.querySelector('[data-testid="selfcheck-status-' + id + '"]')?.textContent || '').includes('已通过'),
          itemId,
        )
      }
    }
    await page.screenshot({ path: path.join(outDir, '4-自检通过.png'), fullPage: true })
    check('三道自检全通过后自动进入第 5 层', (await countTestId(page, 'selfcheck-form')) === 0)
    await waitTestId(page, 'transfer-form')
    check('三道自检全通过 → 第 5 层迁移题', (await bodyText(page)).includes('第 5 层 · 迁移题'))
    await tap(page, 'transfer-start', '开始迁移题')
    await waitTestId(page, 'transfer-task')
    check('开始迁移题后下发题面并用 MathText 渲染', (await katexCount(page, 'transfer-task')) > 0)
    await fillTestId(page, 'transfer-input', '任取 ε>0，取 δ=ε/2。当 0<|x-1|<δ 时，|f(x)-3|<ε。')
    await waitEnabled(page, 'transfer-submit')
    await page.screenshot({ path: path.join(outDir, '5-迁移题.png'), fullPage: true })
    await tap(page, 'transfer-submit', '提交迁移题')

    await waitTestId(page, 'summary-form')
    check('进入第 6 层总结：五问', (await countTestId(page, 'summary-item-4')) === 1)
    const answers = [
      '证了 lim(3n+1)/(n+2)=3。',
      '分两块：化简差、放大到 5/n。',
      '把分式放大成只含 n 的式子。',
      '当 n>N 时推出 |a_n-3|<ε。',
      '放缩下次能用；直接猜 N 只适用于本题。',
    ]
    for (let i = 0; i < answers.length; i += 1) {
      await fillTestId(page, 'summary-input-' + i, answers[i])
    }
    await waitEnabled(page, 'summary-submit')
    await page.screenshot({ path: path.join(outDir, '6-总结.png'), fullPage: true })
    await tap(page, 'summary-submit', '提交总结')

    await waitTestId(page, 'completion-card')
    const doneText = await page.getByTestId('completion-card').innerText()
    check('提交总结后进入完成页（本题完成）', doneText.includes('本题完成'))
    check('完成页显示 mathlib4 对照与未校验逻辑顺序提示', doneText.includes('mathlib4') && doneText.includes('未校验逻辑顺序'))
    await page.screenshot({ path: path.join(outDir, '7-完成页.png'), fullPage: true })

    await tap(page, 'add-to-notebook', '加入证明本')
    await page.waitForSelector('[data-testid="notebook-card"]', { state: 'visible', timeout: 10000 })
    const notebookText = await bodyText(page)
    check('证明本显示已完成作业列表（含本题）', (await countTestId(page, 'notebook-card')) >= 1 && notebookText.includes('数列极限'))
    await page.screenshot({ path: path.join(outDir, '8-证明本.png'), fullPage: true })

    await tap(page, 'notebook-open', '回到该题', 0)
    await waitTestId(page, 'completion-card')
    check('证明本「回到该题」重新打开该题（完成页）', (await countTestId(page, 'completion-card')) === 1)
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => {
      pageErrors.push(err instanceof Error ? err.message : String(err))
    })

    for (const [name, scenario] of [
      ['微课 + seq-band 图解', scenarioMicroCourse],
      ['L3→L4→L5→L6→完成页→证明本', scenarioFullFlow],
    ]) {
      try {
        await scenario(page)
      } catch (e) {
        check('场景「' + name + '」未中断（点击/等待失败即 FAIL）', false, e instanceof Error ? e.message : String(e))
      }
    }

    check('页面无未捕获 JS 异常（pageerror）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    await ctx.close()
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-26] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
