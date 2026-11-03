/**
 * 第 3 层端到端流程（issue #12 DoD）：mock 下加行后，批注出现在该行下方。
 *
 * 用法（在 apps/student 下）：
 *   npm run build:h5
 *   npm run e2e:flows:l3
 * 依赖：playwright-core + 本机 ms-playwright 的 chromium（可用 PG_CHROMIUM 指定）。
 * 说明：与 tests/screenshots.mjs 共用同一套「静态服务器 + chromium」逻辑；
 * 进路由前先 about:blank，强制 SPA 完整重新加载（同路径不同 hash 不会重载）。
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
    for (const dir of dirs) {
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const exe = path.join(base, dir, sub, 'chrome.exe')
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

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-l3] 缺少构建产物：' + distDir + '，请先运行 npm run build:h5')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[flows-l3] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe')
    process.exit(2)
  }
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir, 0)
  const port = server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    // 先 about:blank 再进目标 hash，强制 SPA 重新启动
    await page.goto('about:blank')
    await page.goto('http://127.0.0.1:' + port + '/#/pages/practice/index?mock=l3-active', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

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

    // 2) 空「这一行」时点加入证明应无效（前端只做这个空值禁用，02 §4.4）
    const submit = await pick(page, 'editor-submit', '加入证明')
    if (!submit) throw new Error('找不到「加入证明」按钮')
    await submit.click()
    await page.waitForTimeout(400)
    const afterEmptyClick = await lines.count()
    if (afterEmptyClick === initialLines) pass('「这一行」为空时不会加行（提交禁用）')
    else fail('空提交', '空行也被加入了：行数 ' + afterEmptyClick)

    // 3) 填写并加入证明
    const filledStatement = await fillTextarea(page, 'editor-statement', '$|a_n-3|=\\frac{5}{n+2}$', 0)
    const filledJustification = await fillTextarea(page, 'editor-justification', '通分', 1)
    if (filledStatement && filledJustification) pass('填写「这一行」与「依据」')
    else fail('填写输入框', 'statement=' + filledStatement + ' justification=' + filledJustification)

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
      if (noteText.includes('衔接上了')) pass('批注文案由服务端下发（…衔接上了）')
      else fail('批注文案', noteText.slice(0, 120))
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
  } catch (error) {
    fail('流程执行', String((error && error.stack) || error))
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, failed }, null, 2), 'utf8')
  console.log('[flows-l3] 共 ' + results.length + ' 项，失败 ' + failed + '；报告：' + path.relative(appDir, outDir))
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
