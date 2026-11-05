/**
 * 第 3 层端到端流程（issue #12 DoD）：mock 下加行后，批注出现在该行下方。
 *
 * 用法（在 apps/student 下）：
 *   npm run build:mock
 *   npm run e2e:flows:l3
 * 依赖：playwright-core + 本机 ms-playwright 的 chromium（可用 PG_CHROMIUM 指定；
 *       这里同时探测 Windows / Linux / macOS 的默认缓存路径，方便在 CI/容器里跑）。
 * 说明：与 tests/screenshots.mjs 共用同一套「静态服务器 + chromium」逻辑；
 * 进路由前先 about:blank，强制 SPA 完整重新加载（同路径不同 hash 不会重载）。
 *
 * PR #90 复审第 5 条：空提交断言要真的检查 disabled / aria-disabled（不能只比行数）；
 * 并补 1280 宽「行内只标记、正文只在页边」的去重断言（复审第 4 条）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-l3')

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

/** 跨平台 chromium 探测：Windows / Linux / macOS 的 ms-playwright 默认缓存。 */
function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'), // Windows
    path.join(os.homedir(), '.cache', 'ms-playwright'), // Linux
    process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'ms-playwright') : null,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
  ].filter(Boolean)
  const subPaths = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
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

function pass(name, detail = '') {
  results.push({ ok: true, name, detail })
  console.log('PASS ' + name + (detail ? ' — ' + detail : ''))
}

function fail(name, detail = '') {
  failed += 1
  results.push({ ok: false, name, detail })
  console.error('FAIL ' + name + (detail ? ' — ' + detail : ''))
}

/** 优先 data-testid，其次按可见文本兜底；返回 Locator 或 null。 */
async function pick(page, testId, text) {
  const byTestId = page.locator('[data-testid="' + testId + '"]')
  if ((await byTestId.count()) > 0) return byTestId.first()
  if (text) {
    const byText = page.getByText(text).first()
    if ((await byText.count()) > 0) return byText
  }
  return null
}

/** uni-app 的 <textarea> 在 H5 会包一层 uni-textarea：data-testid 内外两级都兜住。 */
async function fillTextarea(page, testId, value, fallbackIndex) {
  const wrap = page.locator('[data-testid="' + testId + '"]').first()
  if ((await wrap.count()) > 0) {
    const inner = wrap.locator('textarea').first()
    if ((await inner.count()) > 0) {
      await inner.fill(value)
      return true
    }
    const tag = await wrap.evaluate((el) => el.tagName.toLowerCase())
    if (tag === 'textarea') {
      await wrap.fill(value)
      return true
    }
  }
  const all = page.locator('textarea')
  if ((await all.count()) > fallbackIndex) {
    await all.nth(fallbackIndex).fill(value)
    return true
  }
  return false
}

/**
 * 是否处于禁用态：uni-app 的 <button> 在 H5 是 <uni-button>，Vue 把 :disabled 渲染成
 * disabled 属性（"true"）或 aria-disabled；同时保留 DOM 兜底避免版本差异漏判。
 */
async function disabledInfo(locator) {
  return locator.evaluate((el) => {
    const rawDisabled = el.getAttribute('disabled')
    const signals = []
    if (el.getAttribute('aria-disabled') === 'true') signals.push('aria-disabled')
    if (rawDisabled !== null && rawDisabled !== 'false') signals.push('disabled=' + rawDisabled)
    if (typeof el.disabled === 'boolean' && el.disabled) signals.push('property disabled')
    return { disabled: signals.length > 0, signals, outer: el.outerHTML.slice(0, 400) }
  })
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function openPractice(browser, url, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.goto('about:blank')
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return { context, page, pageErrors }
}

/**
 * PR #90 复审第 4 条：1280 宽时同一条批注不能「行内 + 页边」各渲染全文；
 * 行内应只剩颜色标记（data-testid=line-note-marker），正文在页边（.pg-practice__note）。
 */
async function checkWideDedupe(browser, url) {
  const { context, page, pageErrors } = await openPractice(browser, url, { width: 1280, height: 800 })
  try {
    const lineNoteCount = await page.locator('[data-testid="line-note"]').count()
    const markerCount = await page.locator('[data-testid="line-note-marker"]').count()
    const asideCount = await page.locator('.pg-practice__note').count()
    if (lineNoteCount === 0) pass('1280 宽行内不再渲染批注正文', 'line-note=0')
    else fail('1280 宽批注去重', '行内仍有 ' + lineNoteCount + ' 条批注全文')
    if (markerCount > 0) pass('1280 宽行内保留颜色标记', 'marker=' + markerCount)
    else fail('1280 宽行内标记', '没有 line-note-marker')
    if (asideCount > 0) pass('1280 宽批注正文在页边', '.pg-practice__note=' + asideCount)
    else fail('1280 宽页边批注', '页边没有批注条目')
    if (markerCount === asideCount) pass('1280 宽行内标记数与页边条目数一致')
    else fail('1280 宽标记/页边数量', 'marker=' + markerCount + ' aside=' + asideCount)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow <= 1) pass('1280 宽无横向溢出', 'scrollWidth-clientWidth=' + overflow)
    else fail('1280 宽横向溢出', overflow + 'px')

    if (pageErrors.length === 0) pass('1280 宽无 pageerror')
    else fail('1280 宽运行时错误', pageErrors.join(' | '))

    await page.screenshot({ path: path.join(outDir, 'l3-wide.png'), fullPage: true })
  } catch (error) {
    fail('宽屏去重检查执行', String((error && error.stack) || error))
  } finally {
    await context.close()
  }
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-l3] 缺少构建产物：' + distDir + '，请先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[flows-l3] 找不到 chromium：可设 PG_CHROMIUM 指向 chrome 可执行文件（Windows/Linux/macOS 路径均可）')
    process.exit(2)
  }
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir, 0)
  const port = server.address().port
  const url = 'http://127.0.0.1:' + port + '/#/pages/practice/index?mock=l3-active'
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  try {
    const { context, page, pageErrors } = await openPractice(browser, url, { width: 390, height: 844 })

    const text0 = await bodyText(page)
    if (text0.includes('构造与推导')) pass('进入第 3 层（mock=l3-active）')
    else fail('进入第 3 层', '页面没有「构造与推导」：' + text0.slice(0, 200))

    const lines = page.locator('[data-testid="proof-line"]')
    const initialLines = await lines.count()
    if (initialLines === 2) pass('初始证明行 = 2')
    else fail('初始证明行', '期望 2，实际 ' + initialLines)

    const firstLineNotes = initialLines > 0 ? await lines.nth(0).locator('[data-testid="line-note"]').count() : 0
    if (firstLineNotes === 1) pass('既有批注挂在该行下方（第 1 行 1 条）')
    else fail('既有批注挂载', '第 1 行下方批注数 = ' + firstLineNotes)

    // PR #90 复审第 3 条：annotation 一律 --margin，不再按文案（「衔接上了」）染绿色。
    if (firstLineNotes === 1) {
      const linkedNote = lines.nth(0).locator('[data-testid="line-note"]').first()
      const noteInfo = await linkedNote.evaluate((el) => ({
        text: el.innerText,
        className: String(el.className),
        borderColor: getComputedStyle(el).borderLeftColor,
      }))
      const tokenColors = await page.evaluate(() => ({
        margin: getComputedStyle(document.documentElement).getPropertyValue('--margin').trim(),
        ok: getComputedStyle(document.documentElement).getPropertyValue('--ok').trim(),
      }))
      const toRgb = (value) => {
        let raw = String(value || '').replace('#', '')
        if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('')
        const num = parseInt(raw, 16)
        return 'rgb(' + ((num >> 16) & 255) + ', ' + ((num >> 8) & 255) + ', ' + (num & 255) + ')'
      }
      if (noteInfo.text.includes('衔接上了')) pass('批注文案仍是服务端原文（用于断言染色）')
      else fail('批注文案', noteInfo.text.slice(0, 80))
      if (!noteInfo.className.includes('linked')) pass('annotation 不再按文案加 linked 类')
      else fail('文案染色', '仍在用文案决定类名：' + noteInfo.className)
      if (noteInfo.borderColor === toRgb(tokenColors.margin)) pass('annotation 边线 = --margin（红笔提问）', noteInfo.borderColor)
      else fail('annotation 边线颜色', '期望 --margin=' + toRgb(tokenColors.margin) + '，实际 ' + noteInfo.borderColor)
      if (noteInfo.borderColor !== toRgb(tokenColors.ok)) pass('annotation 没有因为「衔接上了」变成 --ok 绿色')
      else fail('文案染色', '「衔接上了」被错误染成 --ok 绿色')
    }

    // 1) 「写下一行」→ 行编辑器
    const writeNext = await pick(page, 'write-next', '写下一行')
    if (!writeNext) throw new Error('找不到「写下一行」入口')
    await writeNext.click()
    await page.waitForTimeout(300)

    const sheet = await pick(page, 'editor-sheet', '加入证明')
    if (sheet && (await sheet.isVisible())) pass('点「写下一行」打开行编辑器')
    else throw new Error('行编辑器没有出现')

    const sheetText = await sheet.innerText()
    if (sheetText.includes('第 3 行')) pass('编辑器标题 = 第 3 行')
    else fail('编辑器行号', '期望「第 3 行」，实际：' + sheetText.slice(0, 120))
    await page.screenshot({ path: path.join(outDir, 'l3-editor.png'), fullPage: true })

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow <= 1) pass('390 宽打开行编辑器无横向溢出', 'scrollWidth-clientWidth=' + overflow)
    else fail('横向溢出', '行编辑器在 390 宽溢出 ' + overflow + 'px')

    // 2) 空「这一行」时「加入证明」必须真的禁用（disabled / aria-disabled），且点击不会加行。
    const submit = await pick(page, 'editor-submit', '加入证明')
    if (!submit) throw new Error('找不到「加入证明」按钮')
    const emptyState = await disabledInfo(submit)
    if (emptyState.disabled) pass('「这一行」为空时「加入证明」禁用', emptyState.signals.join('+'))
    else fail('空提交禁用态', '既没有 disabled 也没有 aria-disabled：' + emptyState.outer)
    await submit.click()
    await page.waitForTimeout(400)
    const afterEmptyClick = await lines.count()
    if (afterEmptyClick === initialLines) pass('空提交点击不会加行（行数不变）')
    else fail('空提交', '空行也被加入了：行数 ' + afterEmptyClick)

    // 3) 填写并加入证明；填入「这一行」后禁用应解除（依据可空）。
    const filledStatement = await fillTextarea(page, 'editor-statement', '$|a_n-3|=\\frac{5}{n+2}$', 0)
    const filledJustification = await fillTextarea(page, 'editor-justification', '通分', 1)
    if (filledStatement && filledJustification) pass('填写「这一行」与「依据」')
    else fail('填写输入框', 'statement=' + filledStatement + ' justification=' + filledJustification)

    const filledState = await disabledInfo(submit)
    if (!filledState.disabled) pass('填入「这一行」后「加入证明」解除禁用')
    else fail('填入后仍禁用', filledState.signals.join('+') || filledState.outer)

    await submit.click()
    await page.waitForTimeout(800)

    const afterLines = await lines.count()
    if (afterLines === initialLines + 1) pass('加入证明后行数 ' + initialLines + ' → ' + afterLines)
    else fail('加行', '期望 ' + (initialLines + 1) + '，实际 ' + afterLines)

    // 4) DoD：批注出现在新行下方（DOM 上就是新行元素的子节点）
    const newLine = lines.nth(afterLines - 1)
    const newLineNo = await newLine.getAttribute('data-line-no')
    if (newLineNo === '3') pass('新行行号 = 3（列表末尾）')
    else fail('新行行号', '期望 3，实际 ' + newLineNo)

    const newLineText = await newLine.innerText()
    if (newLineText.includes('依据') && newLineText.includes('通分')) pass('新行渲染了依据')
    else fail('新行依据', newLineText.slice(0, 160))

    const newNotes = newLine.locator('[data-testid="line-note"]')
    const newNoteCount = await newNotes.count()
    if (newNoteCount >= 1) pass('新行下方出现批注节点（DoD）', '共 ' + newNoteCount + ' 条')
    else fail('新行下方批注', 'DoD 未达成：新行内没有批注节点')

    if (newNoteCount >= 1) {
      const noteText = await newNotes.first().innerText()
      const noteKind = await newNotes.first().getAttribute('data-note-kind')
      if (noteText.includes('衔接上了')) pass('批注文案由服务端下发（…衔接上了）')
      else fail('批注文案', noteText.slice(0, 120))
      if (noteKind === 'annotation') pass('批注类型来自服务端 note.kind', noteKind)
      else fail('批注类型', '期望 annotation，实际 ' + noteKind)
    }

    // 5) 取消不会加行
    await writeNext.click()
    await page.waitForTimeout(300)
    const cancel = await pick(page, 'editor-cancel', '取消')
    if (cancel) {
      await cancel.click()
      await page.waitForTimeout(300)
    }
    const afterCancel = await lines.count()
    if (afterCancel === afterLines) pass('取消不会加行')
    else fail('取消', '行数变化 ' + afterLines + ' → ' + afterCancel)

    if (pageErrors.length === 0) pass('无 pageerror')
    else fail('运行时错误', pageErrors.join(' | '))

    await page.screenshot({ path: path.join(outDir, 'l3-after-add.png'), fullPage: true })
    await context.close()
  } catch (error) {
    fail('流程执行', String((error && error.stack) || error))
  }

  // PR #90 复审第 4 条：平板/桌面批注去重
  await checkWideDedupe(browser, url)

  await browser.close()
  await new Promise((resolve) => server.close(resolve))

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, failed }, null, 2), 'utf8')
  console.log('[flows-l3] 共 ' + results.length + ' 项，失败 ' + failed + '；报告：' + path.relative(appDir, outDir))
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
