/**
 * #151（#141 P2-1 A 侧）行批注前端渲染 e2e。
 *
 * 覆盖 DoD：
 *  1) 提交行 → /help check_line 返回 note → 对应行下方出现批注卡片（署名/时间/正文/关闭/aria）；
 *  2) 多条批注按 lineId 分组：另一行不串；关闭一条只影响该条；
 *  3) state.notes 存在时同步渲染（mock=l3-active 自带两条行内批注），刷新后仍显示 —— 即 B #141 落库后的恢复路径；
 *  4) 无 note 的行不渲染批注；check_line 后 toast 保留；
 *  5) ≥600px 页边批注卡片也有时间/关闭，关闭后页边条目减少。
 *
 * 说明：#141 真接口当前只返回 res.note、不写 state.notes，A 端用「本次会话 overlay」渲染；
 * 刷新后会话 overlay 会丢（B 落库 state.notes/annotation 事件后由第 3 条路径恢复）——本脚本用最后一段显式记录该已知限制。
 *
 * 用法（在 apps/student 下）：
 *   npm run build:mock
 *   npm run e2e:flows:note
 * 依赖：playwright-core + 本机 ms-playwright 的 chromium（可用 PG_CHROMIUM 指定）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-note')

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
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'ms-playwright') : null,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
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

let passed = 0
let failed = 0
function ok(cond, name, detail = '') {
  if (cond) {
    passed += 1
    console.log('PASS ' + name)
  } else {
    failed += 1
    console.error('FAIL ' + name + (detail ? ' — ' + detail : ''))
  }
}
function includes(name, haystack, needle) {
  ok(String(haystack).includes(needle), name, '未找到「' + needle + '」，实际：' + String(haystack).replace(/\s+/g, ' ').slice(0, 220))
}
async function innerText(page, selector) {
  try {
    return await page.locator(selector).first().innerText({ timeout: 3000 })
  } catch {
    return ''
  }
}
async function waitBody(page, needle, timeout = 10000) {
  await page.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout })
}
async function waitGone(page, selector, timeout = 10000) {
  await page.locator(selector).first().waitFor({ state: 'detached', timeout })
}
async function waitVisible(page, selector, timeout = 10000) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout })
}

/** 先 about:blank 再进目标 hash，强制 SPA 完整重新加载（同路径不同 hash 不会重载）。 */
async function openMock(page, baseURL, mock) {
  await page.goto('about:blank')
  await page.goto(baseURL + '/#/pages/practice/index?mock=' + mock, { waitUntil: 'networkidle' })
  await waitBody(page, '数列极限', 15000)
  await page.waitForTimeout(300)
}

async function openPractice(browser, url, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await openMock(page, url, 'l3-active')
  return { context, page, pageErrors }
}

async function openHelpDrawer(page) {
  await page.locator('.pg-dock__btn--help').click()
  await page.locator('.pg-help').waitFor({ state: 'visible', timeout: 5000 })
}

/** 用行编辑器加一行（flows-l3 的同一套 data-testid 兜底）。 */
async function addLineViaEditor(page, statement, justification) {
  const before = await page.locator('[data-testid="proof-line"]').count()
  await page.locator('[data-testid="write-next"]').click()
  await page.waitForTimeout(300)
  const sheet = page.locator('[data-testid="editor-sheet"]').first()
  if ((await sheet.count()) === 0) return { added: false, reason: 'editor-sheet missing' }
  const fill = async (testId, value) => {
    const wrap = page.locator('[data-testid="' + testId + '"]').first()
    if ((await wrap.count()) === 0) return false
    const inner = wrap.locator('textarea').first()
    if ((await inner.count()) > 0) { await inner.fill(value); return true }
    await wrap.fill(value)
    return true
  }
  const filledStatement = await fill('editor-statement', statement)
  const filledJustification = await fill('editor-justification', justification)
  await page.locator('[data-testid="editor-submit"]').click()
  await page.waitForTimeout(900)
  const after = await page.locator('[data-testid="proof-line"]').count()
  return { added: after === before + 1, filledStatement, filledJustification, before, after }
}

/** 读某一行内全部批注的文案。 */
async function noteTexts(lineLocator) {
  const notes = lineLocator.locator('[data-testid="line-note"]')
  const count = await notes.count()
  const out = []
  for (let i = 0; i < count; i += 1) out.push(await notes.nth(i).innerText())
  return out
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-note] 缺少构建产物：' + distDir + '，请先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[flows-note] 找不到 chromium：可设 PG_CHROMIUM 指向 chrome 可执行文件')
    process.exit(2)
  }
  fs.mkdirSync(outDir, { recursive: true })
  const server = await serve(distDir, 0)
  const port = server.address().port
  const baseURL = 'http://127.0.0.1:' + port
  const url = baseURL + '/#/pages/practice/index?mock=l3-active'
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  try {
    const { context, page, pageErrors } = await openPractice(browser, url, { width: 390, height: 844 })
    try {
      includes('进入第 3 层（mock=l3-active）', await page.evaluate(() => document.body.innerText), '写证明')

      const lines = page.locator('[data-testid="proof-line"]')
      const initialLines = await lines.count()
      ok(initialLines === 2, '初始证明行 = 2', '实际 ' + initialLines)

      // ---- A. state.notes 同步渲染（刷新/重连后由服务端下发；#141 落库后的恢复路径） ----
      const line1 = lines.nth(0)
      const line2 = lines.nth(1)
      const line1Text = await line1.innerText()
      const line1NoteTexts = await noteTexts(line1)
      const line2NoteTexts = await noteTexts(line2)
      ok(line1NoteTexts.length === 1, '初始：第 1 行有 1 条既有批注（state.notes）', JSON.stringify(line1NoteTexts))
      includes('第 1 行批注文案来自服务端', line1NoteTexts.join(' '), '衔接上了')
      ok(line2NoteTexts.length === 1, '初始：第 2 行有 1 条既有批注（state.notes）', JSON.stringify(line2NoteTexts))
      includes('第 2 行批注文案来自服务端', line2NoteTexts.join(' '), '依据没写')

      const firstNote = line1.locator('[data-testid="line-note"]').first()
      const role = await firstNote.getAttribute('role')
      const aria = await firstNote.getAttribute('aria-label')
      ok(role === 'note', '批注卡片 role=note', String(role))
      ok(Boolean(aria && aria.includes('衔接上了')), '批注卡片 aria-label 含署名/正文（读屏可读）', String(aria))
      const timeText = await firstNote.locator('[data-testid="line-note-time"]').first().innerText()
      ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(timeText.trim()), '批注显示时间 MM-DD HH:mm', JSON.stringify(timeText))
      const dismissCount = await line1.locator('[data-testid="line-note-dismiss"]').count()
      ok(dismissCount === 1, '批注可关闭（关闭按钮存在）', 'dismiss=' + dismissCount)

      // ---- B. 无 note 不渲染：check_line 之前，任何行都不该出现行检查批注 ----
      ok(!line1Text.includes('依据写的是哪条'), '无 note 的行不渲染行检查批注（第 1 行）', line1Text.slice(0, 120))

      // ---- C. check_line → 最新行（第 2 行）下方出现批注，不串到第 1 行 ----
      await openHelpDrawer(page)
      await page.locator('.pg-help__intent--check_line').click()
      await waitGone(page, '.pg-help')
      await waitBody(page, '依据写的是哪条')
      includes('check_line toast 保留', await innerText(page, '.pg-toast'), '批注已放到这一行下方')

      const line2After = await noteTexts(line2)
      const line1After = await noteTexts(line1)
      ok(line2After.length === 2, 'check_line 批注挂到最新行（第 2 行 1 → 2 条）', JSON.stringify(line2After))
      ok(line2After.some((t) => t.includes('依据写的是哪条')), '第 2 行出现行检查批注正文')
      ok(line1After.length === 1 && !line1After.some((t) => t.includes('依据写的是哪条')), '另一行不串：第 1 行没有行检查批注')

      const checkLineNote = line2.locator('[data-testid="line-note"]').filter({ hasText: '依据写的是哪条' }).first()
      const noteLineId = await checkLineNote.getAttribute('data-note-line-id')
      const line2Id = await line2.getAttribute('data-line-id')
      ok(noteLineId === line2Id, '批注挂在对应 lineId 的行元素内', JSON.stringify({ noteLineId, line2Id }))
      ok((await checkLineNote.getAttribute('data-note-kind')) === 'annotation', '行检查批注 kind=annotation')

      // ---- D. 再写一行 → 第二次 check_line 挂到第 3 行；三条批注按 lineId 分组 ----
      const added = await addLineViaEditor(page, '$\\frac{5}{n+2}<\\frac{5}{n}$', '放大')
      ok(added.added, '行编辑器加入第 3 行', JSON.stringify(added))
      const line3 = lines.nth(2)
      const line3AddedNotes = await noteTexts(line3)
      ok(line3AddedNotes.length >= 1, '新行下方有 mock 加行批注（state.notes）', JSON.stringify(line3AddedNotes))

      await openHelpDrawer(page)
      await page.locator('.pg-help__intent--check_line').click()
      await waitGone(page, '.pg-help')
      await waitBody(page, '依据写的是哪条')
      await page.waitForTimeout(300)
      const line3Notes = await noteTexts(line3)
      const line2NotesAfter = await noteTexts(line2)
      const line1NotesAfter = await noteTexts(line1)
      ok(line3Notes.some((t) => t.includes('依据写的是哪条')), '第二次 check_line 挂到第 3 行')
      ok(line3Notes.length === line3AddedNotes.length + 1, '第 3 行批注数 +1（多行分组不串）', JSON.stringify(line3Notes))
      ok(line2NotesAfter.length === 2, '第 2 行的 check_line 批注仍在（多条按行分组）', JSON.stringify(line2NotesAfter))
      ok(line1NotesAfter.length === 1, '第 1 行批注数不受影响', JSON.stringify(line1NotesAfter))

      // ---- E. 关闭：只关闭第 2 行那条 check_line 批注，其它行不受影响 ----
      const line2CheckLineNote = line2
        .locator('[data-testid="line-note"]')
        .filter({ hasText: '依据写的是哪条' })
        .first()
      await line2CheckLineNote.locator('[data-testid="line-note-dismiss"]').click()
      await page.waitForTimeout(400)
      const line2Closed = await noteTexts(line2)
      ok(line2Closed.length === 1 && !line2Closed.some((t) => t.includes('依据写的是哪条')), '关闭后第 2 行的行检查批注消失', JSON.stringify(line2Closed))
      ok((await noteTexts(line1)).length === 1, '关闭一条不影响第 1 行批注')
      ok((await noteTexts(line3)).length === line3Notes.length, '关闭一条不影响第 3 行批注（另一行不串）')

      // ---- F. 刷新：state.notes 仍渲染（B #141 落库后的恢复路径）；会话 overlay 会丢（已知限制） ----
      await openMock(page, baseURL, 'l3-active')
      await page.waitForTimeout(400)
      const refreshedLines = page.locator('[data-testid="proof-line"]')
      ok((await refreshedLines.count()) === 2, '刷新后回到 mock 初始 state（2 行）')
      ok((await noteTexts(refreshedLines.nth(0))).length === 1, '刷新后 state.notes 的批注仍显示（第 1 行）')
      ok((await noteTexts(refreshedLines.nth(1))).length === 1, '刷新后 state.notes 的批注仍显示（第 2 行）')
      const refreshedBody = await page.evaluate(() => document.body.innerText)
      ok(!refreshedBody.includes('依据写的是哪条'), '刷新后会话内 check_line 批注不保留（B #141 落库 state.notes 后才会恢复 —— 已在 PR 注明依赖）')

      // ---- G. 运行时无错误 + 无横向溢出 + 截图 ----
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      ok(overflow <= 1, '390 宽无横向溢出', 'scrollWidth-clientWidth=' + overflow)
      ok(pageErrors.length === 0, '无 pageerror', pageErrors.join(' | '))
      await page.screenshot({ path: path.join(outDir, 'note-mobile.png'), fullPage: true })
    } finally {
      await context.close()
    }

    // ---- H. ≥600px：页边批注卡片也有时间/关闭，关闭后页边条目减少 ----
    const { context: wideContext, page: widePage, pageErrors: wideErrors } = await openPractice(browser, url, { width: 1280, height: 800 })
    try {
      const asideNotes = widePage.locator('.pg-practice__note')
      const asideCount = await asideNotes.count()
      ok(asideCount === 2, '1280 宽页边渲染 state.notes（2 条）', 'aside=' + asideCount)
      const asideTime = await widePage.locator('[data-testid="aside-note-time"]').count()
      ok(asideTime === 2, '页边批注显示时间', 'time=' + asideTime)
      const asideDismiss = await widePage.locator('[data-testid="aside-note-dismiss"]').count()
      ok(asideDismiss === 2, '页边批注可关闭', 'dismiss=' + asideDismiss)
      await widePage.locator('[data-testid="aside-note-dismiss"]').first().click()
      await widePage.waitForTimeout(300)
      const asideAfter = await asideNotes.count()
      ok(asideAfter === asideCount - 1, '关闭一条后页边批注减少', 'aside ' + asideCount + ' → ' + asideAfter)
      ok(wideErrors.length === 0, '1280 宽无 pageerror', wideErrors.join(' | '))
      await widePage.screenshot({ path: path.join(outDir, 'note-wide.png'), fullPage: true })
    } finally {
      await wideContext.close()
    }
  } finally {
    await browser.close()
    server.close()
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error('[flows-note] 流程异常：' + ((error && error.stack) || error))
  process.exit(1)
})
