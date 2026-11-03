/**
 * 识别确认面板端到端（issue #15 DoD：mock 识别结果能确认、能改、能放弃重写）。
 * 用法：先 npm run build:h5，再 npm run e2e:flows:recog
 * 依赖：playwright-core + 本机 ms-playwright chromium（PG_CHROMIUM 可指定），与 tests/screenshots.mjs 同一套。
 *
 * 覆盖：
 *  拍照 → 识别确认面板出现（两路结果 + 服务端 agree/diff 驱动的不一致提示与高亮 + 选左/选右）
 *  → 选右/选左切换（横幅不变，证明前端不重算一致性）→ 重新识别
 *  → 改一下（MathTextEditor + 证明键盘，点 ε 改一处）
 *  → 确认加入 → 页面「识别结果（已确认）」草稿出现且文本包含改动
 *  → 再拍照 → 放弃重写 → 面板关闭且草稿不变；
 * 输出 PASS/FAIL；有失败时退出码 1。
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

let pass = 0
let fail = 0
function ok(cond, name, detail = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (detail ? ' :: ' + detail : ''))
  }
}
function includes(name, haystack, needle) {
  ok(String(haystack).includes(needle), name, '未找到「' + needle + '」，实际：' + String(haystack).replace(/\s+/g, ' ').slice(0, 240))
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

async function openPractice(page, baseURL) {
  // 先 about:blank 再进目标 hash，强制 SPA 重新启动（同路径不同 hash 不会完整加载）
  await page.goto('about:blank')
  await page.goto(baseURL + '/#/pages/practice/index?mock=l3-active', { waitUntil: 'networkidle' })
  await waitBody(page, '构造与推导', 15000)
  await page.waitForTimeout(300)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[recog] 缺少构建产物：' + distDir + '，先运行 npm run build:h5')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[recog] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe')
    process.exit(2)
  }
  const server = await serve(distDir, 0)
  const baseURL = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)))
  try {
    await openPractice(page, baseURL)

    // 1) 拍照 → 识别确认面板
    await page.locator('.pg-dock__btn--photo').click()
    await waitVisible(page, '.ui-recog')
    includes('面板标题', await innerText(page, '.ui-recog__title'), '识别结果 · 请核对')
    includes('两路不一致提示（来自服务端 agree）', await innerText(page, '.ui-recog__summary'), '两路识别不一致')
    // mock 的 Recognition 形状：agree=false、diff 只给 1 段；横幅/高亮数量必须与服务端字段一致
    const recogPanel = page.locator('.ui-recog').first()
    ok((await recogPanel.getAttribute('data-agree')) === 'false', '横幅读服务端 agree（data-agree=false）')
    ok((await recogPanel.getAttribute('data-conflicts')) === '1', '高亮数量 = 服务端 diff 数量（1 处）')
    ok((await recogPanel.getAttribute('data-simple')) === 'false', 'agree=false 不走「直接显示 + 单按钮」分支')
    ok((await page.locator('.ui-recog__conflict').count()) === 1, '高亮块 = 服务端 diff 的 1 处（前端不自行切分）')
    includes('左路（主识别）可见', await innerText(page, '.ui-recog__route--left'), '左 · 主识别')
    includes('右路（交叉识别）可见', await innerText(page, '.ui-recog__route--right'), '右 · 交叉识别')
    includes('右路文本由服务端 diff.alt 还原', await innerText(page, '.ui-recog__route--right'), 'z')
    includes('高亮块文案', await innerText(page, '.ui-recog__conflict'), '这一处两种识别不一致')
    includes('有选左按钮', await innerText(page, '.ui-recog__fragment--left'), '左')
    includes('有选右按钮', await innerText(page, '.ui-recog__fragment--right'), '右')
    includes('确认加入按钮', await innerText(page, '.ui-recog__confirm'), '确认加入')
    includes('放弃重写按钮', await innerText(page, '.ui-recog__discard'), '放弃重写')

    // 2) 选右 / 选左切换
    await page.locator('.ui-recog__fragment--right').first().click()
    let leftClass = (await page.locator('.ui-recog__fragment--left').first().getAttribute('class')) || ''
    let rightClass = (await page.locator('.ui-recog__fragment--right').first().getAttribute('class')) || ''
    ok(!leftClass.includes('ui-recog__fragment--active') && rightClass.includes('ui-recog__fragment--active'), '选右后高亮切到右路')
    // 选左/选右只影响「采用哪一路」；一致与否仍以服务端 agree 为准，横幅不变
    includes('切换选择后横幅仍读服务端 agree', await innerText(page, '.ui-recog__summary'), '两路识别不一致')
    await page.locator('.ui-recog__fragment--left').first().click()
    leftClass = (await page.locator('.ui-recog__fragment--left').first().getAttribute('class')) || ''
    rightClass = (await page.locator('.ui-recog__fragment--right').first().getAttribute('class')) || ''
    ok(leftClass.includes('ui-recog__fragment--active') && !rightClass.includes('ui-recog__fragment--active'), '再选左后高亮切回左路')

    // 3) 重新识别：面板先关（识别中），再带着结果回来
    await page.locator('.ui-recog__rewrite').click()
    await waitGone(page, '.ui-recog')
    await waitVisible(page, '.ui-recog')
    includes('重新识别后面板回来', await innerText(page, '.ui-recog__title'), '识别结果 · 请核对')

    // 4) 改一下：MathTextEditor + 证明键盘，用键盘改一处
    await page.locator('.ui-recog__editbtn').click()
    await waitVisible(page, '.ui-mte')
    await waitVisible(page, '.ui-pk')
    const textarea = page.locator('.ui-mte__input textarea').first()
    await textarea.waitFor({ state: 'visible', timeout: 8000 })
    const beforeText = await textarea.inputValue()
    await page.locator('[data-key-id="common.r0.k2"]').click() // 常用层的 ε
    await page.waitForTimeout(300)
    const afterText = await textarea.inputValue()
    ok(afterText !== beforeText, '证明键盘输入改变了编辑文本', 'before=' + beforeText.slice(0, 80))
    includes('改动包含 ε（\\varepsilon）', afterText, '\\varepsilon')

    // 5) 确认加入 → 结果进入页面草稿
    await page.locator('.ui-recog__confirm').click()
    await waitGone(page, '.ui-recog')
    await waitVisible(page, '.pg-practice__draft')
    const draftText = (await page.locator('.pg-practice__draft').getAttribute('data-draft-text')) || ''
    ok(draftText.length > 0, '草稿包含确认文本', draftText.slice(0, 120))
    includes('草稿文本包含键盘改动', draftText, '\\varepsilon')
    includes('草稿卡标题', await innerText(page, '.pg-practice__drafttitle'), '识别结果（已确认）')
    includes('确认 toast', await innerText(page, '.pg-toast'), '识别结果已放入草稿')

    // 6) 草稿回填行编辑器（沿用 EditorSheet 既有契约：initial-statement）
    await page.locator('.pg-practice__draftbtn--continue').click()
    await waitVisible(page, '.pg-editor')
    await page.getByTestId('editor-cancel').click()
    await waitGone(page, '.pg-editor')
    ok(true, '草稿可回填到行编辑器（EditorSheet 既有契约）')

    // 7) 再拍照 → 放弃重写：面板关闭，草稿不变
    await page.locator('.pg-dock__btn--photo').click()
    await waitVisible(page, '.ui-recog')
    await page.locator('.ui-recog__discard').click()
    await waitGone(page, '.ui-recog')
    const draftAfterDiscard = (await page.locator('.pg-practice__draft').getAttribute('data-draft-text')) || ''
    ok(draftAfterDiscard === draftText, '放弃重写后草稿保持不变', draftAfterDiscard.slice(0, 80))
    includes('放弃重写 toast', await innerText(page, '.pg-toast'), '已放弃这次识别')

    ok(pageErrors.length === 0, '页面无 JS 异常', pageErrors.join(' | ').slice(0, 300))
  } catch (e) {
    fail++
    console.log('FAIL 识别确认流程异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ') : String(e)))
  } finally {
    await ctx.close()
    await browser.close()
    await new Promise((r) => server.close(r))
  }
  console.log('[recog] PASS ' + pass + ' · FAIL ' + fail)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
