/**
 * 第 1、2 层表单流程 e2e（issue #11；PR #89 审计后严格化）。
 *
 * 覆盖：
 * 1) mock=l1-active → L1 输入 → 点「核对」→ L2 → 点「看通用骨架」（走 /framework/template）→ 输入 → 点「核对」→ L3；
 * 2) 跳层：L1「已掌握，跳过」→ L2；L2「跳过」→ L3（走 /layers/{L}/skip，不是文本提交）。
 *
 * 严格性（PR #89 审计问题 3）：
 * - 按钮用 [data-testid] + role=button 定位；点击先 scrollIntoViewIfNeeded 再走真实鼠标事件，失败直接 FAIL，不回退 JS click；
 * - 监听 pageerror，结尾断言无未捕获 JS 异常。
 *
 * 用法：先 npm run build:mock，再 npm run e2e:flows
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
const pageErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed++
  console.log(((ok) ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

/** 按 data-testid 等元素出现（关键元素统一挂 data-testid，见 Layer1Form/Layer2Form）。 */
async function waitTestId(page, testId, timeout = 8000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
}

async function waitGoneTestId(page, testId, timeout = 8000) {
  await page.waitForSelector('[data-testid="' + testId + '"]', { state: 'detached', timeout })
}

async function testIdCount(page, testId) {
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

async function hasRoleButton(page, name) {
  return (await page.getByRole('button', { name, exact: true }).count()) === 1
}

/**
 * 真实点击：按 data-testid 找到 uni-button 根元素，滚到视口中部后用鼠标点击。
 * 失败直接抛错（由场景 catch 记为 FAIL）—— 不回退到 el.click()，避免遮挡/不可点被掩盖成假绿。
 */
async function tap(page, testId, label = testId) {
  const loc = page.getByTestId(testId)
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  // 目标可能被底部操作坞（fixed）压住：先滚动到可见，再走真实鼠标点击；失败就抛错 → 场景记 FAIL。
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 8000 })
  console.log('      · 已点击 ' + label)
}

async function fillForm(page, value) {
  const input = page.getByRole('textbox')
  await input.waitFor({ state: 'visible', timeout: 8000 })
  await input.fill(value)
}

async function openMock(page, base, mock) {
  // 先 about:blank 再进入目标 hash，强制 SPA 重新启动（同路径不同 hash 不会完整加载）
  await page.goto('about:blank')
  await page.goto(base + '/#/pages/practice/index?mock=' + mock, { waitUntil: 'networkidle' })
  await page.waitForSelector('textarea', { state: 'visible', timeout: 10000 })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  const scenarioLayerList = async (page) => {
    // ---- 层列表：点已完成或当前层只收起列表，不出开发提示 ----
    await page.goto('about:blank')
    await page.goto(base + '/#/pages/practice/index?mock=l3-active', { waitUntil: 'networkidle' })
    await page.locator('.pg-topbar__progress').click()
    const sheet = page.locator('.pg-layersheet')
    await sheet.waitFor({ state: 'visible', timeout: 5000 })
    await sheet.locator('.pg-layersheet__row--current').click()
    await sheet.waitFor({ state: 'detached', timeout: 5000 })
    check('点当前层：列表收起，不弹提示', !(await bodyText(page)).includes('还不能跳过去'))
    await page.locator('.pg-topbar__progress').click()
    await sheet.waitFor({ state: 'visible', timeout: 5000 })
    await sheet.locator('.pg-layersheet__row').first().click()
    await sheet.waitFor({ state: 'detached', timeout: 5000 })
    check('点已完成的层：列表收起，不弹提示', !(await bodyText(page)).includes('还不能跳过去'))
  }

  const scenarioCheckFeedback = async (page) => {
    // ---- 核对没通过：服务端的问题挂在表单下面，手机和桌面都能看到 ----
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    check('还没核对时没有问题卡', (await testIdCount(page, 'layer1-feedback')) === 0)
    await fillForm(page, '数列越来越接近某个数')
    await waitEnabled(page, 'layer1-check')
    await tap(page, 'layer1-check', '核对（缺成分）')
    await waitTestId(page, 'layer1-feedback')
    check('核对没通过：留在第 1 层，问题卡显示缺的成分', (await testIdCount(page, 'layer1-form')) === 1 && (await page.getByTestId('layer1-feedback').innerText()).includes('缺少'))
    check('问题卡里的公式由 MathText 渲染', (await katexCount(page, 'layer1-feedback')) > 0)
    check('写的内容还在输入框里', (await page.getByRole('textbox').inputValue()) === '数列越来越接近某个数')
    await page.screenshot({ path: path.join(outDir, '0-l1-feedback-' + page.viewportSize().width + '.png'), fullPage: true })
  }

  const scenarioFill = async (page) => {
    // ---- 场景 1：L1 填写 → 核对 → L2 → 看通用骨架 → 核对 → L3 ----
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    let text = await bodyText(page)
    check('打开 mock=l1-active 渲染第 1 层表单', text.includes('第 1 层') && text.includes('回忆定义'))
    check('L1 任务说明由 MathText 渲染（KaTeX）', (await katexCount(page, 'layer1-task')) > 0)
    check('L1 任务说明没有把 LaTeX 源码当纯文本裸露', !text.includes('$\\{a_n\\}$'))
    check(
      'L1 有「核对」「看不懂」「已掌握，跳过」三个 role=button 按钮',
      (await hasRoleButton(page, '核对')) &&
        (await hasRoleButton(page, '看不懂')) &&
        (await hasRoleButton(page, '已掌握，跳过')),
    )
    check('L1 有输入区（role=textbox）', (await page.getByRole('textbox').count()) === 1)
    check('L1 输入为空时「核对」禁用', (await isDisabled(page, 'layer1-check')) === true)
    check(
      '非第 3 层没有写证明行的操作坞（手写/键盘/拍照），只用本层表单',
      (await testIdCount(page, 'dock-ink')) === 0 && (await testIdCount(page, 'dock-keyboard')) === 0 && (await testIdCount(page, 'dock-photo')) === 0,
    )
    check('非第 3 层仍能求助（顶栏灯泡）', (await testIdCount(page, 'dock-help')) === 1)
    check(
      'L1 输入上限对齐契约 MathText.maxLength=4000',
      (await page.getByRole('textbox').getAttribute('maxlength')) === '4000',
    )

    await fillForm(page, '任取 $\\varepsilon>0$，存在 $N$，当 $n>N$ 时 $|a_n-A|<\\varepsilon$。')
    await waitTestId(page, 'layer1-preview')
    check('L1 输入后公式预览用 MathText 渲染（KaTeX）', (await katexCount(page, 'layer1-preview')) > 0)
    await waitTestId(page, 'layer1-count')
    check('L1 有字数提示（N / 4000）', /\/\s*4000/.test(await page.getByTestId('layer1-count').innerText()))
    await waitEnabled(page, 'layer1-check')
    check('L1 输入后「核对」可点', (await isDisabled(page, 'layer1-check')) === false)
    await page.screenshot({ path: path.join(outDir, '1-l1.png'), fullPage: true })

    await tap(page, 'layer1-check', '核对')
    await waitTestId(page, 'layer2-form')
    await waitGoneTestId(page, 'layer1-form')
    text = await bodyText(page)
    check('点「核对」后从 L1 进入 L2（出现「第 2 层」）', text.includes('第 2 层'))
    check(
      'L2 有「核对」「看通用骨架」「跳过」三个 role=button 按钮',
      (await hasRoleButton(page, '核对')) &&
        (await hasRoleButton(page, '看通用骨架')) &&
        (await hasRoleButton(page, '跳过')),
    )
    check('L2 未看模板时不显示通用骨架', (await testIdCount(page, 'layer2-template')) === 0)
    await page.screenshot({ path: path.join(outDir, '2-l2.png'), fullPage: true })

    await tap(page, 'layer2-template-btn', '看通用骨架')
    await waitTestId(page, 'layer2-template')
    const templateText = await page.getByTestId('layer2-template').innerText()
    check(
      '点「看通用骨架」后模板由 MathText 展开（服务端 templateShown）',
      templateText.includes('待构造') && (await katexCount(page, 'layer2-template')) > 0,
    )
    await page.screenshot({ path: path.join(outDir, '3-l2-template.png'), fullPage: true })

    await fillForm(
      page,
      '任取 $\\varepsilon>0$。取 $N=$ ＿（待构造）。则当 $n>N$ 时，$\\cdots<\\varepsilon$。真正要解决的是：把 $|a_n-3|$ 控制成只含 $n$ 的量。',
    )
    await waitEnabled(page, 'layer2-check')
    await tap(page, 'layer2-check', '核对')
    await page.waitForSelector('.pg-lines__add', { state: 'visible', timeout: 8000 })
    text = await bodyText(page)
    check('L2 点「核对」后进入 L3（出现「写下一行」）', text.includes('写下一行'))
    check('第 3 层才出现操作坞', (await testIdCount(page, 'dock-ink')) === 1)
    await page.screenshot({ path: path.join(outDir, '4-l3.png'), fullPage: true })
  }

  const scenarioSkip = async (page) => {
    // ---- 场景 2：跳层 L1 → L2 → L3（/layers/{L}/skip，不是文本提交）----
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    await tap(page, 'layer1-skip', '已掌握，跳过')
    await waitTestId(page, 'layer2-form')
    await waitGoneTestId(page, 'layer1-form')
    check(
      '跳层（L1 skip）后进入第 2 层，且第 1 层表单已卸载',
      (await bodyText(page)).includes('第 2 层') && (await testIdCount(page, 'layer1-form')) === 0,
    )
    await page.screenshot({ path: path.join(outDir, '5-l1-skip.png'), fullPage: true })

    await tap(page, 'layer2-skip', '跳过')
    await page.waitForSelector('.pg-lines__add', { state: 'visible', timeout: 8000 })
    check('跳层（L2 skip）后进入第 3 层', (await bodyText(page)).includes('写下一行'))
    await page.screenshot({ path: path.join(outDir, '6-l2-skip.png'), fullPage: true })
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => {
      pageErrors.push(err instanceof Error ? err.message : String(err))
    })

    for (const [name, scenario] of [
      ['层列表不出开发提示', scenarioLayerList],
      ['第 1 层核对没通过（手机）', scenarioCheckFeedback],
      ['填写并核对 L1→L2→L3', scenarioFill],
      ['跳层 L1→L2→L3', scenarioSkip],
    ]) {
      try {
        await scenario(page)
      } catch (e) {
        check('场景「' + name + '」未中断（点击/等待失败即 FAIL）', false, e instanceof Error ? e.message : String(e))
      }
    }

    check('页面无未捕获 JS 异常（pageerror）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    await ctx.close()

    const wide = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    try {
      await scenarioCheckFeedback(await wide.newPage())
    } catch (e) {
      check('场景「第 1 层核对没通过（桌面）」未中断', false, e instanceof Error ? e.message : String(e))
    }
    await wide.close()
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
