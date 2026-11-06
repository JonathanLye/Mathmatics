/**
 * #24 剩余（首页真实数据 + 弱网走完一题）e2e。
 *
 * 前置：npm run build:mock（默认构建即 mock；页面加 ?api=real 可在运行时切真实接口，供路由拦截）。
 * 覆盖：
 *  A. mock 首页渲染 todo/inProgress/done + scheduled/closed 禁用说明 + 讲评入口；点「继续」进入做题页；
 *  B. 弱网（路由首次 500）→ 客户端自动重试成功（首页仍渲染，不丢数据）；
 *  C. 弱网两次 500 → 页面错误态 +「重试」→ 成功（手动重试）；
 *  D. 真实模式下一题：POST /definition 首次 500 → 自动重试复用同一 Idempotency-Key、If-Match=stateVersion，
 *     重试成功后进入第 2 层（弱网下走完一次提交不丢数据）；
 *  E. pageerror 为空、390 无横向溢出。
 *
 * 产物：tests/.artifacts/flows-24/*.png + report.json（gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-24')

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

const results = []
let failed = 0
const pageErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

async function waitTestId(page, testId, timeout = 12000) {
  // 用 CSS selector 等待第一个匹配元素：App 里同类卡片有多个，getByTestId().waitFor 会触发 strict mode。
  await page.waitForSelector('[data-testid="' + testId + '"]', { state: 'visible', timeout })
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function tap(page, testId, label = testId) {
  const loc = page.getByTestId(testId)
  await loc.waitFor({ state: 'visible', timeout: 12000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 12000 })
  console.log('      · 已点击 ' + label)
}

async function gotoApp(page, base, hash) {
  await page.goto('about:blank')
  await page.goto(base + '/#/' + hash, { waitUntil: 'networkidle' })
}

function jsonResponse(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333'
const T0 = '2026-11-04T00:00:00.000Z'

/** 与 apps/student/src/mocks/attemptStates.ts 同形的真实模式 fixture（服务端会下发 state）。 */
function layerRows(current, states) {
  const titles = { L1: '记忆核验', L2: '证明骨架', L3: '构造与推导', L4: '自检', L5: '迁移题', L6: '总结' }
  return ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((id) => ({
    layer: id,
    title: titles[id],
    status: states[id] ?? 'locked',
    enabled: id !== 'L5',
    skippable: id === 'L1' || id === 'L2' || id === 'L4' || id === 'L5',
  }))
}

function attemptFixture(overrides = {}) {
  return {
    attemptId: '11111111-1111-4111-8111-111111111111',
    stateVersion: 7,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem: {
      problemId: 'epsN',
      version: 1,
      title: '数列极限 · ε-N',
      stem: '用 $\\varepsilon$-$N$ 定义证明 $\\displaystyle\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$。',
      chapter: '第二章 数列极限',
      keyCount: 4,
    },
    currentLayer: 'L1',
    layers: layerRows('L1', { L1: 'active' }),
    budget: { revealUsed: 0, revealMax: 2, keysOwn: 0, keysTotal: 4 },
    def: { task: '写出定义。', conceptId: 'seq-limit', submissions: 0, last: null, lessonSuggested: false },
    frame: {
      task: '写出证明骨架。',
      template: '取 $N=$ ＿（待构造）。',
      lessonId: 'frame-forall-exists',
      last: null,
      templateShown: false,
    },
    steps: { lines: [], canFinish: false },
    notes: [],
    help: { hintAvailable: true, nextLevel: 'H2', nextCost: 0.5, waitSec: 0, needAttempt: false, rapidLockUntil: null, exhausted: false, flagged: false, stuckOffer: false },
    integrity: { mode: 'practice', locked: false, warnings: 0, maxWarnings: null, notice: null, watermark: null },
    serverTime: T0,
    ...overrides,
  }
}

const L1_STATE = attemptFixture()
const L2_STATE = attemptFixture({
  stateVersion: 8,
  currentLayer: 'L2',
  layers: layerRows('L2', { L1: 'done', L2: 'active' }),
  def: { task: '写出定义。', conceptId: 'seq-limit', submissions: 1, last: '任取 ε>0，存在 N，当 n>N 时 |a_n-A|<ε。', lessonSuggested: false },
  serverTime: '2026-11-04T00:01:00.000Z',
})

const HOME_STATE = {
  inProgress: [
    {
      assignmentId: ASSIGNMENT_ID,
      title: '数列极限 · ε-N',
      chapter: '第二章 数列极限',
      mode: 'practice',
      status: 'open',
      attemptId: ATTEMPT_ID,
      attemptStatus: 'active',
      currentLayer: 'L3',
      reviewPublished: false,
    },
  ],
  todo: [
    { assignmentId: '44444444-4444-4444-8444-444444444444', title: '交错级数 · 收敛性', chapter: '第三章 级数', mode: 'practice', status: 'open', reviewPublished: false },
    { assignmentId: '55555555-5555-4555-8555-555555555555', title: '函数极限 · ε-δ', chapter: '第二章 数列极限', mode: 'practice', status: 'scheduled', openAt: '2026-11-05T01:00:00.000Z', reviewPublished: false },
    { assignmentId: '66666666-6666-4666-8666-666666666666', title: '单调有界 · 数列', chapter: '第二章 数列极限', mode: 'test', status: 'closed', reviewPublished: false },
  ],
  done: [
    { assignmentId: '77777777-7777-4777-8777-777777777777', title: '数列极限 · ε-N（练习）', chapter: '第二章 数列极限', mode: 'practice', status: 'closed', attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', attemptStatus: 'completed', currentLayer: 'L6', reviewPublished: true },
    { assignmentId: '88888888-8888-4888-8888-888888888888', title: '无穷小比较 · 练习', chapter: '第二章 数列极限', mode: 'practice', status: 'open', attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', attemptStatus: 'completed', currentLayer: 'L6', reviewPublished: false },
  ],
  week: { keysOwn: 2, keysTotal: 4, problemsDone: 1 },
  notebook: { cards: 2, toRedo: 1 },
}

const ME = {
  userId: '99999999-9999-4999-8999-999999999999',
  role: 'student',
  anonCode: 'S-E2E24',
  displayName: 'E2E 同学',
  classes: [],
  consentRequired: false,
  features: {},
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-24] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-24] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })

  async function newPage() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (err) => pageErrors.push(err instanceof Error ? err.message : String(err)))
    return { context, page }
  }

  const scenarioMockHome = async () => {
    const { context, page } = await newPage()
    try {
      await gotoApp(page, base, 'pages/home/index')
      await waitTestId(page, 'home-page')
      check('mock 首页渲染 todo/inProgress/done 三段', (await countTestId(page, 'home-inprogress-card')) === 1 && (await countTestId(page, 'home-todo-card')) === 3 && (await countTestId(page, 'home-done-card')) === 2)
      const text = await bodyText(page)
      check('scheduled / closed 待完成项禁用并说明原因', text.includes('未开始') && text.includes('已关闭') && text.includes('已关闭，不能再作答'))
      const disabledFlags = await page.evaluate(() => {
        const scheduled = document.querySelector('[data-testid="home-todo-disabled-1"]')
        const closed = document.querySelector('[data-testid="home-todo-disabled-2"]')
        return { scheduled: Boolean(scheduled?.hasAttribute('disabled')), closed: Boolean(closed?.hasAttribute('disabled')) }
      })
      check('scheduled / closed 项按钮 disabled', disabledFlags.scheduled && disabledFlags.closed, JSON.stringify(disabledFlags))
      check('reviewPublished=true 显示「讲评已发布」与入口，另一份不显示', (await countTestId(page, 'home-done-review-0')) === 1 && (await countTestId(page, 'home-done-review-1')) === 0)
      await page.screenshot({ path: path.join(outDir, '1-home-mock.png'), fullPage: true })

      await tap(page, 'home-done-review-0', '看讲评')
      await waitTestId(page, 'home-notice')
      check('点「看讲评」给出讲评入口提示（#102 提供讲评页）', (await page.getByTestId('home-notice').innerText()).includes('讲评已发布'))

      await tap(page, 'home-continue-0', '继续进行中的题')
      await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
      check('点「继续」进入做题页', (await page.locator('.pg-practice').count()) === 1)
      check('390 宽首页/做题页无横向溢出', await page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement
        return root.scrollWidth <= window.innerWidth + 1
      }))
      await page.screenshot({ path: path.join(outDir, '2-practice-from-home.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioHomeAutoRetry = async () => {
    const { context, page } = await newPage()
    let homeAttempts = 0
    try {
      await page.route('**/api/v1/**', (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname.endsWith('/student/home')) {
          homeAttempts += 1
          if (homeAttempts === 1) return route.fulfill(jsonResponse({ error: { code: 'INTERNAL', message: '服务暂时不可用' } }, 500))
          return route.fulfill(jsonResponse(HOME_STATE))
        }
        if (pathname.endsWith('/me')) return route.fulfill(jsonResponse(ME))
        return route.fulfill(jsonResponse({ error: { code: 'NOT_FOUND', message: 'no route' } }, 404))
      })
      await gotoApp(page, base, 'pages/home/index?api=real')
      await waitTestId(page, 'home-page')
      await waitTestId(page, 'home-todo-card')
      check('弱网首页：首次 500 后自动重试并渲染数据', homeAttempts === 2, 'home 请求次数=' + homeAttempts)
      check('弱网自动重试后无错误态', (await countTestId(page, 'home-error')) === 0)
      check('真实数据问候语来自 GET /me', (await page.getByTestId('home-greeting').innerText()).includes('E2E 同学'))
      await page.screenshot({ path: path.join(outDir, '3-home-weaknet-auto.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioHomeManualRetry = async () => {
    const { context, page } = await newPage()
    let homeAttempts = 0
    try {
      await page.route('**/api/v1/**', (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname.endsWith('/student/home')) {
          homeAttempts += 1
          if (homeAttempts <= 2) return route.fulfill(jsonResponse({ error: { code: 'INTERNAL', message: '服务暂时不可用' } }, 500))
          return route.fulfill(jsonResponse(HOME_STATE))
        }
        if (pathname.endsWith('/me')) return route.fulfill(jsonResponse(ME))
        return route.fulfill(jsonResponse({ error: { code: 'NOT_FOUND', message: 'no route' } }, 404))
      })
      await gotoApp(page, base, 'pages/home/index?api=real')
      await waitTestId(page, 'home-error')
      check('两次 500 后显示错误态（不静默回退假数据）', (await page.getByTestId('home-error').innerText()).includes('首页加载失败'))
      await page.screenshot({ path: path.join(outDir, '4-home-error.png'), fullPage: true })

      await tap(page, 'home-retry', '重试')
      await waitTestId(page, 'home-todo-card')
      check('手动重试后成功渲染（请求数=' + homeAttempts + '）', homeAttempts === 3 && (await countTestId(page, 'home-error')) === 0)
      await page.screenshot({ path: path.join(outDir, '5-home-manual-retry.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioWeakNetWriteRetry = async () => {
    // 新 #96 base 已含 #11 正式 L1 表单：输入定义 → POST /attempts/{id}/definition，
    // 强制首次 500 → 客户端自动重试（同一 Idempotency-Key / If-Match）→ 应用最新 state 进入第 2 层。
    const { context, page } = await newPage()
    const writeHeaders = []
    let definitionAttempts = 0
    try {
      await page.route('**/api/v1/**', (route) => {
        const request = route.request()
        const pathname = new URL(request.url()).pathname
        if (pathname.endsWith('/student/assignments/' + ASSIGNMENT_ID + '/attempt')) {
          return route.fulfill(jsonResponse({ state: L1_STATE }))
        }
        if (pathname.endsWith('/attempts/' + L1_STATE.attemptId + '/definition')) {
          definitionAttempts += 1
          writeHeaders.push(request.headers())
          if (definitionAttempts === 1) return route.fulfill(jsonResponse({ error: { code: 'INTERNAL', message: '服务暂时不可用' } }, 500))
          return route.fulfill(jsonResponse({ state: L2_STATE }))
        }
        if (pathname.endsWith('/me')) return route.fulfill(jsonResponse(ME))
        return route.fulfill(jsonResponse({ error: { code: 'NOT_FOUND', message: 'no route' } }, 404))
      })

      await gotoApp(page, base, 'pages/practice/index?assignmentId=' + ASSIGNMENT_ID + '&api=real')
      await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
      await waitTestId(page, 'layer1-form')
      check('真实模式用 ?assignmentId= 开始作答（POST /attempt 返回 L1 state）', (await bodyText(page)).includes('回忆定义'))
      await page.getByTestId('layer1-input').locator('textarea').fill('任取 ε>0，存在 N，当 n>N 时 |a_n-A|<ε。')
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="layer1-check"]')
        return Boolean(el) && !el.hasAttribute('disabled')
      }, { timeout: 8000 })
      await page.screenshot({ path: path.join(outDir, '6-weaknet-l1.png'), fullPage: true })

      await tap(page, 'layer1-check', '核对（提交定义，首次 500）')
      await waitTestId(page, 'layer-interstitial', 15000)
      await tap(page, 'interstitial-continue', '过场·继续')
      await waitTestId(page, 'layer2-form', 15000)
      check('弱网写请求：首次 500 自动重试成功，页面进入第 2 层（进度不丢）', (await bodyText(page)).includes('搭骨架'))
      check('重试幂等：2 次写请求使用同一 Idempotency-Key', definitionAttempts === 2 && Boolean(writeHeaders[0]?.['idempotency-key']) && writeHeaders[0]?.['idempotency-key'] === writeHeaders[1]?.['idempotency-key'], JSON.stringify(writeHeaders.map((h) => h['idempotency-key'])))
      check('If-Match = 当前 stateVersion（7），重试时未丢版本', writeHeaders[0]?.['if-match'] === '7' && writeHeaders[1]?.['if-match'] === '7', JSON.stringify(writeHeaders.map((h) => h['if-match'])))
      check('390 宽弱网做题页无横向溢出', await page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement
        return root.scrollWidth <= window.innerWidth + 1
      }))
      await page.screenshot({ path: path.join(outDir, '7-weaknet-l2.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioPracticeLoadError = async () => {
    // 真实模式打开做题页：先骨架；加载失败是错误屏（重试 / 回首页），不停在演示数据上。
    const { context, page } = await newPage()
    let attemptRequests = 0
    try {
      await page.route('**/api/v1/**', (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname.endsWith('/attempts/' + L1_STATE.attemptId)) {
          attemptRequests += 1
          if (attemptRequests === 1) return route.fulfill(jsonResponse({ error: { code: 'NOT_FOUND', message: '找不到这次作答' } }, 404))
          return route.fulfill(jsonResponse({ state: L1_STATE }))
        }
        if (pathname.endsWith('/me')) return route.fulfill(jsonResponse(ME))
        return route.fulfill(jsonResponse({ error: { code: 'NOT_FOUND', message: 'no route' } }, 404))
      })
      await gotoApp(page, base, 'pages/practice/index?attemptId=' + L1_STATE.attemptId + '&api=real')
      await waitTestId(page, 'practice-load-error')
      const text = await bodyText(page)
      check('加载失败显示错误屏和服务端文案', text.includes('这道题没打开') && text.includes('找不到这次作答'))
      check('错误屏没有演示数据', !text.includes('数列极限') && (await countTestId(page, 'layer1-form')) === 0)
      await page.screenshot({ path: path.join(outDir, '8-practice-load-error.png'), fullPage: true })
      await tap(page, 'practice-load-retry', '再试一次')
      await waitTestId(page, 'layer1-form')
      check('「再试一次」用同一份参数加载成功', attemptRequests === 2 && (await countTestId(page, 'practice-load-error')) === 0)

      await gotoApp(page, base, 'pages/practice/index?api=real')
      await waitTestId(page, 'practice-load-error')
      check('真实模式没有作答 id：错误屏，不渲染演示数据', (await bodyText(page)).includes('没有找到要做的题') && (await countTestId(page, 'layer1-form')) === 0)
      await tap(page, 'practice-load-home', '回首页')
      await page.waitForFunction(() => window.location.hash.includes('pages/home/index'), undefined, { timeout: 8000 })
      check('错误屏「回首页」能回到首页', true)
    } finally {
      await context.close()
    }
  }

  try {
    for (const [name, scenario] of [
      ['mock 首页（三段/禁用/讲评/进入做题）', scenarioMockHome],
      ['弱网首页：自动重试', scenarioHomeAutoRetry],
      ['弱网首页：手动重试', scenarioHomeManualRetry],
      ['弱网写请求自动重试（L1 定义提交→L2，首次 500 后成功）', scenarioWeakNetWriteRetry],
      ['打开做题页失败：错误屏、重试、回首页', scenarioPracticeLoadError],
    ]) {
      try {
        await scenario()
      } catch (e) {
        check('场景「' + name + '」未中断', false, e instanceof Error ? e.message : String(e))
      }
    }
    check('页面无未捕获 JS 异常（pageerror）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-24] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})