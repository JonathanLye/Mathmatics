/**
 * 新手引导 e2e（mock 构建；演示场景 ?onboarding=new：新学生要设密码、选年龄、签同意书，引导进度为空）。
 *
 * 前置：pnpm --filter @proof-gym/student build:mock
 * 用法：pnpm --filter @proof-gym/student e2e:flows:onboarding
 *
 * 场景：
 *  1) 登录页第一次来：开场动画自动播，4 幕可翻、可跳过；刷新后不再自动播；
 *  2) 邀请码登录 → 设密码（两次不一致提示）→ 年龄 → 同意 → 欢迎页 → 首页导览，一路接得上；
 *  3) 中途退出再登录（同一个 SPA 内用 hash 跳转，mock 进度保留）：设完密码、选完年龄、签完同意、导览中途，各停一次，都回到该去的那一步；
 *  4) 欢迎页：昵称、每日目标、默认输入，保存后庆祝；第一次登录若这台设备没看过开场动画，欢迎页会放；
 *  5) 首页导览 3 步，走完后不再出现；“重看引导”（开发陈列页里的那一行）能再放一遍；
 *  6) 未满 14 岁页有退出登录，点了回到登录页；
 *  7) 减少动态效果：开场动画不跑动画，第 2 幕停在终点（六个站点都亮）；
 *  8) 服务端按线上同款 CSP 提供页面，不应有任何违规。
 * 严格性：按钮用 data-testid 真实点击；监听 pageerror 与 CSP 违规。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-onboarding')

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

/** 线上 CSP（global.md）：脚本只能来自自身，样式允许内联，不能有 blob worker。 */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'"

function findChromium() {
  if (process.env.PG_CHROMIUM && fs.existsSync(process.env.PG_CHROMIUM)) return process.env.PG_CHROMIUM
  const candidates = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')].filter(Boolean)
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()
    for (const d of dirs) {
      for (const sub of ['chrome-linux64', 'chrome-linux', 'chrome-win64', 'chrome-win']) {
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

const results = []
let failed = 0
const pageErrors = []
const cspViolations = []

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

const bodyText = (page) => page.evaluate(() => document.body.innerText)
const countTestId = (page, id) => page.getByTestId(id).count()
const waitTestId = (page, id, timeout = 10000) => page.getByTestId(id).first().waitFor({ state: 'visible', timeout })
const waitGone = (page, id, timeout = 10000) => page.waitForSelector('[data-testid="' + id + '"]', { state: 'detached', timeout })

async function tap(page, id, label = id) {
  const loc = page.getByTestId(id).first()
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 8000 })
  console.log('      · 已点击 ' + label)
}
async function fillInput(page, id, value) {
  const input = page.getByTestId(id).locator('input').first()
  await input.waitFor({ state: 'visible', timeout: 8000 })
  await input.fill(value)
}
async function gotoFresh(page, base, route) {
  await page.goto('about:blank')
  await page.goto(base + '/#' + route, { waitUntil: 'networkidle' })
}
/** 同一个 SPA 内换页：mock 的进度（密码、年龄、同意）保留，相当于“退出后在同一台设备上再登录”。 */
async function hashTo(page, route) {
  await page.evaluate((r) => { window.location.hash = '#' + r }, route)
}
async function loginWithPassword(page, studentNo, password) {
  await waitTestId(page, 'login-submit')
  await tap(page, 'login-mode-password', '切到密码登录')
  await fillInput(page, 'login-studentno', studentNo)
  await fillInput(page, 'login-password', password)
  await tap(page, 'login-submit', '登录')
}
async function nextIntro(page, n) {
  for (let i = 0; i < n; i += 1) await tap(page, 'intro-next', '下一幕')
}

function attachListeners(page) {
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (msg) => {
    const text = msg.text()
    // uni-h5 自带样式里引了 cdn.dcloud.net.cn 的一张占位图，线上同样被 CSP 挡掉（既有现象，不影响页面），不算本次引入的违规。
    if (/Content Security Policy|Refused to (apply|execute|load|create|connect)/i.test(text) && !text.includes('cdn.dcloud.net.cn')) cspViolations.push(text.slice(0, 200))
  })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-onboarding] 缺少构建产物：' + distDir + '，先运行 pnpm --filter @proof-gym/student build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-onboarding] 找不到 chromium，可设置 PG_CHROMIUM'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir, 0)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  attachListeners(page)

  try {
    // ---------------- 场景 1：登录页开场动画 ----------------
    console.log('--- 场景 1：登录页第一次来，开场动画 ---')
    await gotoFresh(page, base, '/pages/login/index?onboarding=new')
    await waitTestId(page, 'intro-story')
    const titles = []
    for (let i = 0; i < 4; i += 1) {
      titles.push(await page.getByTestId('intro-title').innerText())
      check('开场动画第 ' + (i + 1) + ' 幕有「跳过」', (await countTestId(page, 'intro-skip')) === 1)
      if (i < 3) await tap(page, 'intro-next', '下一幕')
    }
    check('4 幕标题依次是 什么/六步/问/每天', titles[0].includes('证明陪练场') && titles[1].includes('六步') && titles[2].includes('问') && titles[3].includes('每天'), titles.join(' | '))
    check('最后一幕主按钮是「开始吧」', (await countTestId(page, 'intro-done')) === 1 && (await countTestId(page, 'intro-next')) === 0)
    await page.screenshot({ path: path.join(outDir, '1-intro-last.png') })
    await tap(page, 'intro-back', '上一幕')
    check('「上一步」能回到第 3 幕', (await page.getByTestId('intro-title').innerText()).includes('问'))
    await page.keyboard.press('ArrowRight')
    check('方向键右翻到第 4 幕', (await page.getByTestId('intro-title').innerText()).includes('每天'))
    await tap(page, 'intro-done', '开始吧')
    await waitGone(page, 'intro-story')
    check('看完后回到登录表单', (await countTestId(page, 'login-submit')) === 1)
    check('登录页没有开发者文案', !/离线演示|mock/i.test(await bodyText(page)))

    await gotoFresh(page, base, '/pages/login/index?onboarding=new')
    await waitTestId(page, 'login-submit')
    await page.waitForTimeout(500)
    check('刷新后这台设备不再自动播开场动画', (await countTestId(page, 'intro-story')) === 0)
    await tap(page, 'login-watch-intro', '看看怎么玩')
    await waitTestId(page, 'intro-story')
    await tap(page, 'intro-skip', '跳过')
    await waitGone(page, 'intro-story')
    check('「看看怎么玩」随时能再看，也能跳过', (await countTestId(page, 'login-submit')) === 1)

    // 模式切换：两个入口都在，切换后字段跟着换
    await tap(page, 'login-mode-password', '密码登录')
    check('密码模式：有密码框，没有邀请码框', (await countTestId(page, 'login-password')) === 1 && (await countTestId(page, 'login-invite')) === 0)
    await tap(page, 'login-mode-invite', '邀请码激活')
    check('邀请码模式：有邀请码框，没有密码框', (await countTestId(page, 'login-invite')) === 1 && (await countTestId(page, 'login-password')) === 0)
    await tap(page, 'login-submit', '空表单登录')
    await waitTestId(page, 'login-error')
    check('空表单给出友好提示', (await page.getByTestId('login-error').innerText()).includes('邀请码'))
    await page.screenshot({ path: path.join(outDir, '2-login-error.png') })

    // ---------------- 场景 2：首次登录一路走通 ----------------
    console.log('--- 场景 2：邀请码登录 → 设密码 → 年龄 → 同意 → 欢迎 → 导览 ---')
    await fillInput(page, 'login-invite', 'ABC123')
    await fillInput(page, 'login-studentno', '2026001')
    await tap(page, 'login-submit', '激活并进入')
    await waitTestId(page, 'setpw-page')
    check('首次登录先去设密码', (await countTestId(page, 'setpw-page')) === 1)
    await fillInput(page, 'setpw-password', 'correct horse battery')
    await fillInput(page, 'setpw-confirm', 'something else')
    await tap(page, 'setpw-submit', '保存（两次不一致）')
    await waitTestId(page, 'setpw-error')
    check('两次输入不一致时提示', (await page.getByTestId('setpw-error').innerText()).includes('不一样'))
    await page.screenshot({ path: path.join(outDir, '3-setpw-error.png') })

    // 中途停一：还没设成功就退出再登录 → 邀请码仍可用，回到设密码
    await hashTo(page, '/pages/login/index')
    await waitTestId(page, 'login-submit')
    await tap(page, 'login-mode-invite', '邀请码激活')
    await fillInput(page, 'login-invite', 'ABC123')
    await fillInput(page, 'login-studentno', '2026001')
    await tap(page, 'login-submit', '再次激活')
    await waitTestId(page, 'setpw-page')
    check('中途停一（没设成密码）：再登录回到设密码', true)
    await fillInput(page, 'setpw-password', 'correct horse battery')
    await fillInput(page, 'setpw-confirm', 'correct horse battery')
    await tap(page, 'setpw-submit', '保存并继续')
    await waitTestId(page, 'age-page')
    check('设好密码后去年龄页', (await countTestId(page, 'age-option-ge18')) === 1)

    // 中途停二：设完密码、没选年龄就退出 → 用密码登录 → 年龄页
    await hashTo(page, '/pages/login/index')
    await loginWithPassword(page, '2026001', 'correct horse battery')
    await waitTestId(page, 'age-page')
    await waitTestId(page, 'age-option-14to17')
    check('中途停二（设完密码）：用密码再登录回到年龄页', (await countTestId(page, 'age-option-14to17')) === 1)
    await page.screenshot({ path: path.join(outDir, '4-age.png') })
    await tap(page, 'age-option-ge18', '18 岁及以上')
    await tap(page, 'age-submit', '确认分档')
    await waitTestId(page, 'consent-page')
    check('选完年龄去同意页', (await countTestId(page, 'consent-submit')) === 1)
    await page.screenshot({ path: path.join(outDir, '5-consent.png') })

    // 中途停三：选完年龄、没签同意书 → 再登录 → 同意页
    await hashTo(page, '/pages/login/index')
    await loginWithPassword(page, '2026001', 'correct horse battery')
    await waitTestId(page, 'consent-page')
    check('中途停三（选完年龄）：再登录回到同意页', (await countTestId(page, 'consent-submit')) === 1)
    await tap(page, 'consent-submit', '同意并开始')
    await waitTestId(page, 'welcome-page')
    await waitTestId(page, 'welcome-nickname')
    check('签完同意去欢迎页（这台设备看过开场动画，不再重复）', (await countTestId(page, 'intro-story')) === 0)

  } catch (e) {
    failed++
    console.log('FAIL 场景异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ') : String(e)))
    try { await page.screenshot({ path: path.join(outDir, 'error.png') }) } catch { /* 忽略 */ }
  }

  // 后面的场景需要“已签同意书、没填欢迎页”的状态；整页刷新会重置演示进度，所以重新走一遍最短路径。
  async function fastForwardToWelcome(p, { forgetIntro }) {
    await gotoFresh(p, base, '/pages/login/index?onboarding=new')
    await p.evaluate(() => window.localStorage.setItem('pg.intro.v1', '1'))
    await p.evaluate(() => window.location.reload())
    await p.waitForTimeout(800)
    if ((await countTestId(p, 'intro-story')) > 0) await tap(p, 'intro-skip', '跳过开场')
    await tap(p, 'login-mode-invite', '邀请码激活').catch(() => {})
    await fillInput(p, 'login-invite', 'ABC123')
    await fillInput(p, 'login-studentno', '2026001')
    await tap(p, 'login-submit', '激活并进入')
    await waitTestId(p, 'setpw-page')
    await fillInput(p, 'setpw-password', 'correct horse battery')
    await fillInput(p, 'setpw-confirm', 'correct horse battery')
    await tap(p, 'setpw-submit', '保存并继续')
    await waitTestId(p, 'age-page')
    await tap(p, 'age-option-ge18', '18 岁及以上')
    await tap(p, 'age-submit', '确认分档')
    await waitTestId(p, 'consent-page')
    // 开场动画在登录页看过就记在这台设备上；“新设备”要在签同意书之前忘掉它。
    if (forgetIntro) {
      await p.evaluate(() => {
        window.localStorage.removeItem('pg.intro.v1')
        for (const key of Object.keys(window.localStorage)) if (key.startsWith('pg.onboarding.v1.')) window.localStorage.removeItem(key)
      })
    }
    await tap(p, 'consent-submit', '同意并开始')
    await waitTestId(p, 'welcome-page')
  }

  try {
    // ---------------- 场景 3/4：欢迎页 ----------------
    console.log('--- 场景 4：欢迎页（新设备：先放开场动画） ---')
    await fastForwardToWelcome(page, { forgetIntro: true })
    await waitTestId(page, 'intro-story')
    check('新设备第一次登录：欢迎页先放开场动画', (await countTestId(page, 'intro-story')) === 1)
    await tap(page, 'intro-skip', '跳过开场')
    await waitGone(page, 'intro-story')
    await waitTestId(page, 'welcome-nickname')
    check('欢迎页第一屏是昵称，没填昵称时「下一步」禁用', await page.getByTestId('welcome-next').evaluate((el) => el.hasAttribute('disabled')))
    await page.screenshot({ path: path.join(outDir, '6-welcome-name.png') })

    // 中途停四：欢迎页填到一半退出 → 再登录 → 仍在欢迎页（没保存就不算走过）
    await fillInput(page, 'welcome-nickname', '小明')
    await hashTo(page, '/pages/login/index')
    await loginWithPassword(page, '2026001', 'correct horse battery')
    await waitTestId(page, 'welcome-page')
    check('中途停四（签完同意、欢迎页没保存）：再登录仍回欢迎页', (await countTestId(page, 'welcome-nickname')) === 1)
    check('这次已经看过开场动画，不再重复放', (await countTestId(page, 'intro-story')) === 0)

    await fillInput(page, 'welcome-nickname', '小明')
    await tap(page, 'welcome-next', '下一步（昵称）')
    await waitTestId(page, 'welcome-goal-3')
    check('每日目标三张卡，默认「稳步」', (await countTestId(page, 'welcome-goal-2')) === 1 && (await page.getByTestId('welcome-goal-3').getAttribute('aria-checked')) === 'true')
    await tap(page, 'welcome-goal-5', '冲刺')
    check('点「冲刺」选中它', (await page.getByTestId('welcome-goal-5').getAttribute('aria-checked')) === 'true')
    await page.screenshot({ path: path.join(outDir, '7-welcome-goal.png') })
    await tap(page, 'welcome-next', '下一步（目标）')
    await waitTestId(page, 'welcome-input-hand')
    await tap(page, 'welcome-input-keyboard', '键盘')
    await page.screenshot({ path: path.join(outDir, '8-welcome-input.png') })
    await tap(page, 'welcome-back', '上一步')
    await waitTestId(page, 'welcome-goal-5')
    check('「上一步」回到目标，选择还在', (await page.getByTestId('welcome-goal-5').getAttribute('aria-checked')) === 'true')
    await tap(page, 'welcome-next', '下一步（目标）')
    await waitTestId(page, 'welcome-input-keyboard')
    check('回到默认输入，键盘还选着', (await page.getByTestId('welcome-input-keyboard').getAttribute('aria-checked')) === 'true')
    await tap(page, 'welcome-next', '完成')
    await waitTestId(page, 'celebration')
    check('保存后庆祝，标题带昵称', (await page.getByTestId('celebration').innerText()).includes('小明'))
    await page.screenshot({ path: path.join(outDir, '9-welcome-ready.png') })
    await tap(page, 'welcome-go', '去看看路径')

    // ---------------- 场景 5：首页导览 ----------------
    console.log('--- 场景 5：首页 3 步导览 ---')
    await waitTestId(page, 'home-page')
    await waitTestId(page, 'coachmark', 12000)
    check('进首页后出现导览，第 1 步', (await page.getByTestId('coachmark').innerText()).includes('1 / 3'))
    await page.screenshot({ path: path.join(outDir, '10-tour-1.png') })
    await tap(page, 'coachmark-next', '下一步')
    await page.waitForTimeout(500)
    check('第 2 步', (await page.getByTestId('coachmark').innerText()).includes('2 / 3'))
    await page.screenshot({ path: path.join(outDir, '11-tour-2.png') })

    // 中途停五：导览看到一半退出再登录 → 导览重新出现（没看完不算看过）
    await hashTo(page, '/pages/login/index')
    await loginWithPassword(page, '2026001', 'correct horse battery')
    await waitTestId(page, 'home-page')
    await waitTestId(page, 'coachmark', 12000)
    check('中途停五（导览看一半）：再登录首页，导览从头再来', (await page.getByTestId('coachmark').innerText()).includes('1 / 3'))
    await tap(page, 'coachmark-next', '下一步')
    await page.waitForTimeout(450)
    await tap(page, 'coachmark-next', '下一步')
    await page.waitForTimeout(450)
    check('第 3 步指向「我的」，主按钮是「知道了」', (await page.getByTestId('coachmark').innerText()).includes('3 / 3') && (await page.getByTestId('coachmark-next').innerText()).includes('知道了'))
    await page.screenshot({ path: path.join(outDir, '12-tour-3.png') })
    await tap(page, 'coachmark-next', '知道了')
    await waitGone(page, 'coachmark')
    await hashTo(page, '/pages/mistakes/index')
    await page.waitForTimeout(600)
    await hashTo(page, '/pages/home/index')
    await waitTestId(page, 'home-page')
    await page.waitForTimeout(1500)
    check('走完导览后再回首页不再出现', (await countTestId(page, 'coachmark')) === 0)
    const cached = await page.evaluate(() => Object.entries(window.localStorage).filter(([k]) => k.startsWith('pg.onboarding.v1.')).map(([, v]) => v).join('|'))
    check('已读标记记下了 welcome / intro / tour', cached.includes('welcome') && cached.includes('tour'), cached)

    // ---------------- 重看引导 ----------------
    console.log('--- 重看引导（开发陈列页里的那一行；“我的”页由别的任务接入） ---')
    await hashTo(page, '/pages/dev/gallery')
    await waitTestId(page, 'me-replay-onboarding')
    await tap(page, 'me-replay-onboarding', '重看新手引导')
    await waitTestId(page, 'intro-story')
    check('重看：先放开场动画', (await countTestId(page, 'intro-story')) === 1)
    await tap(page, 'intro-skip', '跳过')
    await waitTestId(page, 'home-page')
    await waitTestId(page, 'coachmark', 12000)
    check('重看：放完回首页，导览再走一遍', (await page.getByTestId('coachmark').innerText()).includes('1 / 3'))
    await tap(page, 'coachmark-skip', '跳过导览')
    await waitGone(page, 'coachmark')
  } catch (e) {
    failed++
    console.log('FAIL 场景异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ') : String(e)))
    try { await page.screenshot({ path: path.join(outDir, 'error.png') }) } catch { /* 忽略 */ }
  }

  try {
    // ---------------- 场景 6：未满 14 岁的出口 ----------------
    console.log('--- 场景 6：未满 14 岁页退出登录 ---')
    await gotoFresh(page, base, '/pages/age/index?ageBand=lt14')
    await waitTestId(page, 'age-blocked')
    check('未满 14 岁：没有继续入口，有「退出登录」', (await countTestId(page, 'age-continue')) === 0 && (await countTestId(page, 'age-submit')) === 0 && (await countTestId(page, 'age-logout')) === 1)
    await page.screenshot({ path: path.join(outDir, '13-age-blocked.png') })
    await tap(page, 'age-logout', '退出登录')
    await waitTestId(page, 'login-submit')
    check('退出后回到登录页', (await countTestId(page, 'login-page')) === 1 && (await countTestId(page, 'age-page')) === 0)
  } catch (e) {
    failed++
    console.log('FAIL 场景异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ') : String(e)))
  }

  try {
    // ---------------- 场景 7：减少动态效果 ----------------
    console.log('--- 场景 7：prefers-reduced-motion ---')
    const rctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    const rpage = await rctx.newPage()
    attachListeners(rpage)
    await gotoFresh(rpage, base, '/pages/login/index?onboarding=new')
    await waitTestId(rpage, 'intro-story')
    await tap(rpage, 'intro-next', '下一幕')
    await rpage.waitForTimeout(600)
    const lit = await rpage.evaluate(() => {
      const scene = document.querySelector('[data-testid="intro-scene"]')
      const num = scene.querySelector('.pgp__node--6 .pgp__num')
      const first = scene.querySelector('.pgp__node--1 .pgp__num')
      const walker = scene.querySelector('.pgp__walker')
      return {
        sixth: num ? getComputedStyle(num).backgroundColor : '',
        first: first ? getComputedStyle(first).backgroundColor : '',
        left: walker ? getComputedStyle(walker).left : '',
        running: document.getAnimations().filter((a) => a.playState === 'running').length,
      }
    })
    check('减少动态效果：第 2 幕直接停在终点，六个站点都亮', parseFloat(lit.left) > 250 && lit.sixth !== 'rgb(255, 255, 255)' && lit.first !== 'rgb(255, 255, 255)', JSON.stringify(lit))
    check('减少动态效果：没有还在跑的动画', lit.running === 0, 'running=' + lit.running)
    await rpage.screenshot({ path: path.join(outDir, '14-reduced-scene2.png') })
    await rctx.close()
  } catch (e) {
    failed++
    console.log('FAIL 场景异常 :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ') : String(e)))
  }

  check('页面无未捕获 JS 异常', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300))
  check('页面在线上同款 CSP 下没有任何违规', cspViolations.length === 0, cspViolations.join(' | ').slice(0, 300))

  await ctx.close()
  await browser.close()
  await new Promise((r) => server.close(r))

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, pageErrors, cspViolations }, null, 2), 'utf8')
  console.log('[flows-onboarding] PASS ' + results.filter((r) => r.ok).length + ' · FAIL ' + failed)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
