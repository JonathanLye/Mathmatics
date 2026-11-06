/**
 * #28 A 侧：设备/浏览器矩阵走查（6 组合，Playwright 模拟；issue 评论用）。
 *
 * 6 个 profile（12 §6.3）：
 *  ① Android 中端机 + 微信内置（Chromium 移动档 + WeChat UA 模拟，非真机）
 *  ② Android + Chrome（Chromium 移动档模拟 Android Chrome）
 *  ③ iPhone + Safari（Chromium iPhone 档 + iOS Safari UA 模拟，非真机）
 *  ④ iPhone + 微信（同上 + 微信 iOS UA 模拟，非真机）
 *  ⑤ iPad + 触控笔（768×1024 + hasTouch；触控笔/真机由 C 验证）
 *  ⑥ 笔记本 Chrome/Edge（1280×800 桌面档）
 *
 * 每个 profile 走：首页 → 开始/继续 → L1 定义 → L2 骨架 → L3 行编辑/提交 →
 * 求助（stuck 预览卡）→ 刷新恢复草稿 → 离线提示 → #27 事件上报可用性。
 * 断言：pageerror 为空、无横向溢出、关键控件可见可点、触摸档主操作 ≥44px。
 *
 * 产物：tests/.artifacts/matrix-28/（截图按 DoD 不入库）+ results.json；控制台打印汇总表。
 * 用法：npm run build:mock && npm run e2e:matrix:28
 * 子集：MATRIX_PROFILES=android-chrome,ipad-chrome npm run e2e:matrix:28
 * 严格模式：默认发现 FAIL 退出码 1（MATRIX_ALLOW_FAIL=1 可强制 0，供信息性采集）。
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
const outDir = path.join(__dirname, '.artifacts', 'matrix-28')

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

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  androidWeChat:
    'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40.2420(0x28002833) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphoneWeChat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002833) NetType/WIFI Language/zh_CN',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}

const PROFILES = [
  {
    id: 'android-wechat',
    name: '① Android 中端机 + 微信内置',
    simulated: true,
    device: 'Pixel 6 档（390×844, DPR2, touch）',
    gap: '微信内置浏览器的真实内核/返回手势需 C 真机验证',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA.androidWeChat },
  },
  {
    id: 'android-chrome',
    name: '② Android + Chrome',
    simulated: true,
    device: 'Pixel 6 档（390×844, DPR2, touch）',
    gap: '无（Chromium 即 Android Chrome 内核；真机性能/输入法不在矩阵内）',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA.androidChrome },
  },
  {
    id: 'iphone-safari',
    name: '③ iPhone + Safari',
    simulated: true,
    device: 'iPhone 13 档（390×844, DPR3, touch, iOS Safari UA）',
    gap: 'WebKit/Safari 真实渲染与 iOS 手势需真机；本矩阵仅 UA/视口模拟',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: UA.iphoneSafari },
  },
  {
    id: 'iphone-wechat',
    name: '④ iPhone + 微信',
    simulated: true,
    device: 'iPhone 13 档（390×844, DPR3, touch, 微信 iOS UA）',
    gap: '微信内置 + iOS WebView 需 C 真机验证',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: UA.iphoneWeChat },
  },
  {
    id: 'ipad-pencil',
    name: '⑤ iPad + 触控笔',
    simulated: true,
    device: 'iPad 10.9 档（768×1024, DPR2, hasTouch）',
    gap: 'Apple Pencil 的 pointerType/压感/手掌防误触无法用 Chromium 模拟，需 C 真机',
    context: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA.ipadSafari },
  },
  {
    id: 'laptop-chrome',
    name: '⑥ 笔记本 Chrome/Edge',
    simulated: true,
    device: '桌面 1280×800（无 touch）',
    gap: 'Windows 高 DPI/浏览器缩放与 Edge 特有行为未单独覆盖（同 Chromium 内核）',
    context: { viewport: { width: 1280, height: 800 } },
  },
]

const DEFINITION = '任取 $\\varepsilon>0$，存在 $N$，当 $n>N$ 时 $|a_n-A|<\\varepsilon$。'
const FRAME = '任取 $\\varepsilon>0$。取 $N=$ ＿（待构造）。则当 $n>N$ 时，左边 $<\\varepsilon$。'
const LINE_STATEMENT = '第 3 行：$|a_n-3|=\\frac{5}{n+2}$'
const LINE_JUSTIFICATION = '通分整理'
const DRAFT_TEXT = '未提交的定义草稿（矩阵走查）'

function checkFactory(profileResults) {
  return (name, ok, detail = '') => {
    profileResults.checks.push({ name, ok: Boolean(ok), detail })
    if (!ok) profileResults.failed += 1
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''))
  }
}

async function waitTestId(page, testId, timeout = 12000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function waitEnabled(page, testId, timeout = 8000) {
  await page.waitForFunction((id) => {
    const el = document.querySelector('[data-testid="' + id + '"]')
    return Boolean(el) && !el.hasAttribute('disabled')
  }, testId, { timeout })
}

async function tap(page, testId, label = testId) {
  const loc = page.getByTestId(testId).first()
  await loc.waitFor({ state: 'visible', timeout: 10000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 10000 })
  console.log('      · 已点击 ' + label)
}

async function fillTestId(page, testId, value) {
  const loc = page.getByTestId(testId).first()
  await loc.waitFor({ state: 'visible', timeout: 10000 })
  const inner = loc.locator('textarea, input')
  const target = (await inner.count()) > 0 ? inner.first() : loc
  await target.fill(value)
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

async function controlHeight(page, testId) {
  const loc = page.getByTestId(testId).first()
  const box = await loc.boundingBox()
  return box ? Math.round(box.height * 10) / 10 : 0
}

async function gotoHash(page, base, hash) {
  await page.goto('about:blank')
  await page.goto(base + '/#/' + hash, { waitUntil: 'networkidle' })
}

async function runProfile(browser, base, profile) {
  const startedAt = Date.now()
  const result = {
    id: profile.id,
    name: profile.name,
    simulated: profile.simulated,
    device: profile.device,
    gap: profile.gap,
    context: profile.context,
    checks: [],
    failed: 0,
    pageErrors: [],
    durationMs: 0,
    status: 'fail',
  }
  const check = checkFactory(result)
  const pageErrors = result.pageErrors
  const context = await browser.newContext(profile.context)
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.message : String(error)))
  const touchProfile = Boolean(profile.context.hasTouch)
  try {
    // ---------- 1. 首页 → 开始/继续 ----------
    await gotoHash(page, base, 'pages/home/index')
    await waitTestId(page, 'home-page')
    check('首页渲染（home-page）', (await countTestId(page, 'home-page')) === 1)
    check('首页无横向溢出', !(await hasOverflow(page)))
    await page.screenshot({ path: path.join(outDir, profile.id + '-1-home.png'), fullPage: true })

    let entered = false
    if ((await countTestId(page, 'home-continue-0')) > 0) {
      await tap(page, 'home-continue-0', '继续（进行中）')
      entered = true
    } else {
      const start = page.locator('[data-testid^="home-todo-start-"]').first()
      if ((await start.count()) > 0) { await start.scrollIntoViewIfNeeded(); await start.click(); entered = true }
    }
    check('首页有可点「继续/开始」入口', entered)
    await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
    check('首页 → 做题页跳转成功', true)
    check('做题页无横向溢出', !(await hasOverflow(page)))

    // ---------- 2. L1 定义 ----------
    await gotoHash(page, base, 'pages/practice/index?mock=l1-active')
    await waitTestId(page, 'layer1-form')
    const l1Height = await controlHeight(page, 'layer1-check')
    if (touchProfile) check('L1「核对」触摸目标 ≥44px', l1Height >= 44, l1Height + 'px')
    await fillTestId(page, 'layer1-input', DEFINITION)
    await waitEnabled(page, 'layer1-check')
    await page.screenshot({ path: path.join(outDir, profile.id + '-2-l1.png'), fullPage: true })
    await tap(page, 'layer1-check', '核对（L1 定义）')
    await waitTestId(page, 'layer-interstitial')
    await tap(page, 'interstitial-continue', '过场·继续')
    await waitTestId(page, 'layer2-form')
    check('L1 提交后进入 L2', true)

    // ---------- 3. L2 骨架 ----------
    const l2Height = await controlHeight(page, 'layer2-check')
    if (touchProfile) check('L2「核对」触摸目标 ≥44px', l2Height >= 44, l2Height + 'px')
    await fillTestId(page, 'layer2-input', FRAME)
    await waitEnabled(page, 'layer2-check')
    await tap(page, 'layer2-check', '核对（L2 骨架）')
    await waitTestId(page, 'layer-interstitial')
    await tap(page, 'interstitial-continue', '过场·继续')
    await waitTestId(page, 'write-next')
    check('L2 提交后进入 L3（写下一行）', true)
    check('L3 无横向溢出', !(await hasOverflow(page)))

    // ---------- 4. L3 行编辑/提交 ----------
    await tap(page, 'write-next', '写下一行')
    await waitTestId(page, 'editor-sheet')
    const submitHeight = await controlHeight(page, 'editor-submit')
    if (touchProfile) check('行编辑器「加入证明」触摸目标 ≥44px', submitHeight >= 44, submitHeight + 'px')
    // 输入器默认手写（来自设置），这里要打字，先切到键盘。
    await tap(page, 'composer-tab-keyboard', '键盘')
    await fillTestId(page, 'editor-statement', LINE_STATEMENT)
    await fillTestId(page, 'editor-justification', LINE_JUSTIFICATION)
    await tap(page, 'editor-submit', '加入证明（L3 行）')
    await page.waitForSelector('[data-testid="proof-line"]', { state: 'visible', timeout: 12000 })
    check('L3 行提交成功并出现在行列表', (await countTestId(page, 'proof-line')) >= 1)
    // 提交后的反馈面板盖在下面：点继续收起。
    await waitTestId(page, 'feedback-panel')
    await tap(page, 'feedback-continue', '反馈面板·继续')
    await page.screenshot({ path: path.join(outDir, profile.id + '-3-l3.png'), fullPage: true })

    // ---------- 5. 求助（三种意图之一：stuck → 预览卡） ----------
    // 顶栏的求助灯泡（所有宽度都有）；退路是页边栏的「求助」（uni-app 的 <button> 在 H5 是 uni-button，无 role=button）。
    const dockHelp = page.locator('[data-testid="dock-help"]')
    if ((await dockHelp.count()) > 0) {
      await dockHelp.first().scrollIntoViewIfNeeded()
      await dockHelp.first().click()
    } else {
      const asideHelp = page.locator('.pg-practice__asidehelp .pg-practice__btn, .pg-practice__asidehelp uni-button').first()
      await asideHelp.waitFor({ state: 'visible', timeout: 8000 })
      await asideHelp.scrollIntoViewIfNeeded()
      await asideHelp.click()
    }
    await page.waitForSelector('.pg-help', { state: 'visible', timeout: 8000 })
    check('求助抽屉打开', true)
    // 选「这个概念/符号我不懂」：三种意图之一；反馈可能是抽屉内概念卡，也可能升级为预览卡（都算响应）。
    await page.locator('.pg-help__intent--concept').click()
    await page.waitForFunction(
      () => Boolean(document.querySelector('.pg-help__note') || document.querySelector('.pg-preview')),
      { timeout: 10000 },
    )
    const helpResponse = await page.evaluate(() => {
      const note = document.querySelector('.pg-help__note')
      const preview = document.querySelector('.pg-preview')
      return { note: Boolean(note), preview: Boolean(preview), text: (note ?? preview)?.textContent ?? '' }
    })
    check('求助一种意图（概念解释）→ 收到反馈卡', (helpResponse.note || helpResponse.preview) && helpResponse.text.trim().length > 0)
    if (helpResponse.preview) {
      await page.locator('.pg-preview__decline').click()
      await page.waitForSelector('.pg-preview', { state: 'detached', timeout: 8000 })
      check('求助反馈可关闭（不强制领取）', true)
    } else {
      await page.locator('.pg-help__close').click()
      await page.waitForSelector('.pg-help', { state: 'detached', timeout: 8000 })
      check('求助反馈可关闭（抽屉关闭）', true)
    }

    // ---------- 6. 刷新恢复草稿（#27） ----------
    await gotoHash(page, base, 'pages/practice/index?mock=l1-active')
    await waitTestId(page, 'layer1-form')
    await fillTestId(page, 'layer1-input', DRAFT_TEXT)
    await page.waitForTimeout(900) // 500ms 防抖 + IndexedDB 写入
    await page.reload({ waitUntil: 'networkidle' })
    await waitTestId(page, 'draft-restored', 12000)
    check('刷新后显示「已恢复上次未提交的草稿」', (await bodyText(page)).includes('已恢复上次未提交的草稿'))
    const restoredValue = await page.getByTestId('layer1-input').locator('textarea').first().inputValue()
    check('刷新后草稿内容恢复', restoredValue.includes(DRAFT_TEXT))
    await tap(page, 'draft-restored-dismiss', '知道了（关闭恢复提示）')
    await page.screenshot({ path: path.join(outDir, profile.id + '-4-draft.png'), fullPage: true })

    // ---------- 7. 离线提示（#27；不依赖 #27 OfflineBar 之外的新代码） ----------
    await context.setOffline(true)
    try {
      await waitTestId(page, 'offline-bar', 4000)
    } catch {
      // Playwright setOffline 在网络层模拟；若 Chromium 未派发 offline 事件，补一次事件走同一监听路径
      await page.evaluate(() => window.dispatchEvent(new Event('offline')))
      await waitTestId(page, 'offline-bar', 4000)
    }
    check('断网后离线提示条出现', (await bodyText(page)).includes('网络断开'))
    await page.screenshot({ path: path.join(outDir, profile.id + '-5-offline.png'), fullPage: true })
    await context.setOffline(false)
    try {
      await page.waitForFunction(() => {
        const bar = document.querySelector('[data-testid="offline-bar"]')
        return !bar || (bar.textContent || '').includes('网络已恢复')
      }, { timeout: 5000 })
    } catch {
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await page.waitForFunction(() => {
        const bar = document.querySelector('[data-testid="offline-bar"]')
        return !bar || (bar.textContent || '').includes('网络已恢复')
      }, { timeout: 5000 })
    }
    check('恢复网络后提示恢复/自动消失', true)

    // ---------- 8. #27 事件上报可用性（不重复 flows-27，只抽查 SDK 有事件且无异常） ----------
    const events = await page.evaluate(async () => {
      const api = window.__PG_EVENTS__
      if (!api) return null
      if (typeof api.flush === 'function') await api.flush('manual')
      await new Promise((resolve) => setTimeout(resolve, 250))
      return api.events().map((event) => event.type)
    })
    if (events === null) {
      check('#27 事件 SDK 调试接口存在（__PG_EVENTS__）', false, '未找到 __PG_EVENTS__（mock 构建才暴露）')
    } else {
      check('#27 事件 SDK 有上报事件且字段可读', events.length > 0 && events.every((type) => typeof type === 'string'), JSON.stringify(events.slice(0, 5)))
    }

    // ---------- 9. 最终断言 ----------
    check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    check('当前页面无横向溢出', !(await hasOverflow(page)))
  } catch (error) {
    check('矩阵流程未中断', false, error instanceof Error ? error.name + ': ' + error.message : String(error))
  } finally {
    await context.close()
    result.durationMs = Date.now() - startedAt
    result.status = result.failed === 0 ? 'pass' : 'fail'
  }
  return result
}

function selectedProfiles() {
  const raw = process.env.MATRIX_PROFILES
  if (!raw) return PROFILES
  const ids = raw.split(',').map((item) => item.trim()).filter(Boolean)
  const selected = PROFILES.filter((profile) => ids.includes(profile.id))
  if (selected.length === 0) {
    console.warn('[matrix-28] MATRIX_PROFILES 未匹配任何 profile；可选：' + PROFILES.map((profile) => profile.id).join(','))
    return PROFILES
  }
  return selected
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[matrix-28] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[matrix-28] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const profiles = selectedProfiles()
  const results = []
  try {
    for (const profile of profiles) {
      console.log('\n=== ' + profile.name + ' [' + profile.id + '] ===')
      const result = await runProfile(browser, base, profile)
      results.push(result)
    }
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  const totalChecks = results.reduce((sum, result) => sum + result.checks.length, 0)
  const failedChecks = results.reduce((sum, result) => sum + result.failed, 0)
  const summary = results.map((result) => ({
    profile: result.name,
    id: result.id,
    simulated: result.simulated,
    status: result.status,
    passed: result.checks.length - result.failed,
    total: result.checks.length,
    failedChecks: result.checks.filter((check) => !check.ok).map((check) => check.name),
    durationMs: result.durationMs,
    device: result.device,
    gap: result.gap,
    pageErrors: result.pageErrors,
  }))
  const report = {
    issue: 28,
    generatedAt: new Date().toISOString(),
    base,
    chromium: exe,
    profiles: results,
    summary,
    totals: { profiles: results.length, passedProfiles: results.filter((result) => result.status === 'pass').length, checks: totalChecks, failedChecks },
    note: 'Chromium 模拟走查；微信内置/Safari WebKit/Apple Pencil 真机部分由 C 负责验证（见每行 gap）。',
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== 矩阵汇总（#28 A 侧 · Chromium 模拟）===')
  const header = '组合'.padEnd(22) + '状态    ' + '通过项      ' + '耗时'
  console.log(header)
  console.log('-'.repeat(72))
  for (const row of summary) {
    console.log(
      row.profile.padEnd(22) +
        (row.status === 'pass' ? 'PASS  ' : 'FAIL  ') +
        String(row.passed + '/' + row.total).padEnd(12) +
        (row.durationMs / 1000).toFixed(1) + 's' +
        (row.failedChecks.length ? '  失败：' + row.failedChecks.join('; ') : ''),
    )
  }
  console.log('-'.repeat(72))
  console.log('总计：' + report.totals.passedProfiles + '/' + report.totals.profiles + ' profile 通过，' + (totalChecks - failedChecks) + '/' + totalChecks + ' 项检查通过')
  console.log('结果文件：' + path.join(outDir, 'results.json'))
  console.log('真机缺口：微信内置浏览器（Android/iOS）、Safari WebKit、iPad + Apple Pencil 由 C 真机验证；本矩阵仅为 Chromium 模拟。')

  if (failedChecks > 0 && process.env.MATRIX_ALLOW_FAIL !== '1') process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
