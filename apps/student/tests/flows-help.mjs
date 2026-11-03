/**
 * 求助三意图端到端（issue #16 DoD：mock 下三种意图都能走通）。
 * 用法：先 npm run build:h5，再 npm run e2e:flows:help
 * 依赖：playwright-core + 本机 ms-playwright 的 chromium（可用 PG_CHROMIUM 指定），与 tests/screenshots.mjs 同一套。
 *
 * 覆盖：
 *  1) 打开求助抽屉 → 三种意图各走一次：stuck（出提示预览卡）、concept（抽屉里出「助教」概念卡）、check_line（行内出批注）；
 *  2) 预览卡「先不要」不改变透露量；「领取」把透露量 0.5 → 1 并下发提示；
 *  3) 自由输入一句也能走通；
 *  4) l3-exhausted：额度用完的四个软着陆出路 + 「卡住了」置灰 + 已标记求助老师；
 *  5) 桌面宽度下概念卡同时出现在页边，且无横向溢出。
 * 输出 PASS/FAIL 行；有失败时退出码 1。
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

// ---------- 断言小工具 ----------
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
  ok(String(haystack).includes(needle), name, '未找到「' + needle + '」，实际：' + String(haystack).replace(/\s+/g, ' ').slice(0, 220))
}
async function innerText(page, selector) {
  try {
    return await page.locator(selector).first().innerText({ timeout: 3000 })
  } catch {
    return ''
  }
}
async function waitBody(page, needle, timeout = 8000) {
  await page.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout })
}
async function waitGone(page, selector, timeout = 8000) {
  await page.locator(selector).first().waitFor({ state: 'detached', timeout })
}

async function openMock(page, baseURL, mock) {
  // 先 about:blank 再进目标 hash，强制 SPA 重新启动（同路径不同 hash 不会完整加载）
  await page.goto('about:blank')
  await page.goto(baseURL + '/#/pages/practice/index?mock=' + mock, { waitUntil: 'networkidle' })
  await waitBody(page, '构造与推导', 15000)
  await page.waitForTimeout(300)
}

async function openHelpDrawer(page) {
  await page.locator('.pg-dock__btn--help').click()
  await page.locator('.pg-help').waitFor({ state: 'visible', timeout: 5000 })
}

// 手机端主流程
async function mobileFlows(browser, baseURL) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)))
  try {
    await openMock(page, baseURL, 'l3-active')

    // 1) 打开抽屉
    await openHelpDrawer(page)
    includes('抽屉标题', await innerText(page, '.pg-help__title'), '你现在需要哪种帮助')
    includes('抽屉三个意图齐全', await innerText(page, '.pg-help'), '我卡住了')
    includes('抽屉概念意图', await innerText(page, '.pg-help'), '这个概念/符号我不懂')
    includes('抽屉行检查意图', await innerText(page, '.pg-help'), '帮我看看这一行')

    // 2) stuck → 提示预览卡
    const budgetBefore = await innerText(page, '.pg-budget__bar')
    await page.locator('.pg-help__intent--stuck').click()
    await page.locator('.pg-preview').waitFor({ state: 'visible', timeout: 8000 })
    const previewText = await innerText(page, '.pg-preview')
    includes('stuck 出现预览卡标题', previewText, '下一条：方向提示（H2）')
    includes('预览卡告知代价', previewText, '这条会计入透露 0.5')
    includes('预览卡显示已用与剩余', previewText, '剩余 1')
    includes('预览卡有领取', previewText, '领取')
    includes('预览卡有先不要', previewText, '先不要')
    await waitGone(page, '.pg-help')
    ok(true, 'stuck 后抽屉收起、预览卡接管')

    // 3) 先不要：透露量不变
    await page.locator('.pg-preview__decline').click()
    await waitGone(page, '.pg-preview')
    const budgetAfterDecline = await innerText(page, '.pg-budget__bar')
    ok(budgetAfterDecline === budgetBefore, '先不要：透露量不变', beforeSafe(budgetBefore) + ' -> ' + beforeSafe(budgetAfterDecline))

    // 4) stuck → 领取：透露量增加并下发提示
    await openHelpDrawer(page)
    await page.locator('.pg-help__intent--stuck').click()
    await page.locator('.pg-preview').waitFor({ state: 'visible', timeout: 8000 })
    await page.locator('.pg-preview__claim').click()
    await waitGone(page, '.pg-preview')
    await waitBody(page, '透露 1 / 2')
    includes('领取后预算条 透露 1 / 2', await innerText(page, '.pg-budget__bar'), '透露 1 / 2')
    await waitBody(page, '单独算出来')
    ok(true, '领取后提示写入行内（H2 批注出现）')

    // 5) concept → 抽屉里出「助教」概念卡
    await openHelpDrawer(page)
    await page.locator('.pg-help__intent--concept').click()
    await page.locator('.pg-help__note').waitFor({ state: 'visible', timeout: 8000 })
    const conceptText = await innerText(page, '.pg-help__note')
    includes('concept 抽屉内出现助教卡', conceptText, '助教')
    includes('concept 卡片内容到位', conceptText, '数列极限')
    ok(await page.locator('.pg-help').isVisible(), 'concept 时抽屉保持打开')
    await page.locator('.pg-help__close').click()
    await waitGone(page, '.pg-help')

    // 6) check_line → 行内批注
    await openHelpDrawer(page)
    await page.locator('.pg-help__intent--check_line').click()
    await waitGone(page, '.pg-help')
    await waitBody(page, '依据写的是哪条')
    ok(true, 'check_line 后行内出现批注')
    includes('check_line toast', await innerText(page, '.pg-toast'), '批注已放到这一行下方')

    // 7) 自由输入 → mock 按概念处理
    await openHelpDrawer(page)
    await page.locator('.pg-help__input input').fill('这一行在做什么')
    await page.locator('.pg-help__send').click()
    await page.locator('.pg-help__note').waitFor({ state: 'visible', timeout: 8000 })
    includes('自由输入后出助教卡', await innerText(page, '.pg-help__note'), '助教')
    await page.locator('.pg-help__close').click()
    await waitGone(page, '.pg-help')

    // 8) 额度用尽：软着陆 + 卡住了置灰 + 已标记
    await openMock(page, baseURL, 'l3-exhausted')
    await openHelpDrawer(page)
    await page.locator('.pg-help__soft--exhausted').waitFor({ state: 'visible', timeout: 5000 })
    includes('额度用完提示', await innerText(page, '.pg-help__soft--exhausted'), '透露额度已用完')
    const softCount = await page.locator('.pg-help__softbtn').count()
    ok(softCount === 4, '额度用完有四个软着陆出路', '实际 ' + softCount + ' 个')
    includes('已标记求助老师', await innerText(page, '.pg-help'), '已标记求助老师')
    const stuckClass = (await page.locator('.pg-help__intent--stuck').getAttribute('class')) || ''
    ok(stuckClass.includes('pg-help__intent--disabled'), '额度用完时「卡住了」置灰', stuckClass)
    await page.locator('.pg-help__softbtn').first().click()
    await waitGone(page, '.pg-help')
    await waitBody(page, '回到定义')
    includes('软着陆回到定义 toast', await innerText(page, '.pg-toast'), '回到定义')

    ok(pageErrors.length === 0, '页面无 JS 异常', pageErrors.join(' | ').slice(0, 300))
  } catch (e) {
    fail++
    console.log('FAIL 手机端求助流程异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : String(e)))
  } finally {
    await ctx.close()
  }
}

// 桌面宽度：概念卡在页边 + 无横向溢出
async function desktopFlows(browser, baseURL) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  try {
    await openMock(page, baseURL, 'l3-active')
    await page.locator('.pg-practice__asidehelp .pg-practice__btn').click()
    await page.locator('.pg-help').waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('.pg-help__intent--concept').click()
    await page.locator('.pg-help__note').waitFor({ state: 'visible', timeout: 8000 })
    includes('桌面抽屉内概念卡', await innerText(page, '.pg-help__note'), '助教')
    await page.locator('.pg-help__close').click()
    await waitGone(page, '.pg-help')
    await page.locator('.pg-practice__note--concept').first().waitFor({ state: 'visible', timeout: 5000 })
    includes('桌面页边概念卡', await innerText(page, '.pg-practice__note--concept'), '数列极限')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    ok(!overflow, '桌面无横向溢出')
  } catch (e) {
    fail++
    console.log('FAIL 桌面求助流程异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : String(e)))
  } finally {
    await ctx.close()
  }
}

function beforeSafe(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[help] 缺少构建产物：' + distDir + '，先运行 npm run build:h5')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) {
    console.error('[help] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe')
    process.exit(2)
  }
  const server = await serve(distDir, 0)
  const baseURL = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  try {
    await mobileFlows(browser, baseURL)
    await desktopFlows(browser, baseURL)
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }
  console.log('[help] PASS ' + pass + ' · FAIL ' + fail)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
