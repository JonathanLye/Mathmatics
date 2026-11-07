/**
 * 新 e2e 脚本共用的小工具：起静态服务、开浏览器、记结果、拦接口。
 * 前置：pnpm --filter @proof-gym/student build:mock；PG_CHROMIUM 指向 chromium。
 * mock 构建里页面加 ?api=real 可切真实接口，配合 page.route 模拟各种响应。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist', 'build', 'h5')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
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

export const ME = {
  userId: '99999999-9999-4999-8999-999999999999',
  role: 'student',
  anonCode: 'S-ANON9',
  displayName: '小明',
  classes: [{ id: 'c1', name: '高一（3）班' }],
  consentRequired: false,
  ageBand: '14to17',
  needsPassword: false,
  features: {},
}

export const SETTINGS = { nickname: '小明', dailyGoal: 3, defaultInput: 'hand', theme: 'system', sound: true, motion: true, haptics: true, onboarding: { seen: { welcome: true, tour: true } } }

export const PROGRESS = {
  xpTotal: 40,
  xpToday: 10,
  keysToday: 1,
  dailyGoal: 3,
  streak: { current: 1, best: 2, freezeAvailable: false, usedFreezeDays: [] },
  week: [],
  badges: [{ id: 'first_step', title: '第一步', desc: '第一次写出有进展的一步', earnedAt: '2026-11-02T08:00:00.000Z' }],
  daysLearned: 2,
}

/** 服务端下发的作答状态（和 mocks/attemptStates 同形），开始题目、重做的响应都用它。 */
export function attemptState(attemptId, overrides = {}) {
  const titles = { L1: '记忆核验', L2: '证明骨架', L3: '构造与推导', L4: '自检', L5: '迁移题', L6: '总结' }
  return {
    attemptId,
    stateVersion: 1,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem: { problemId: 'p', version: 1, title: '题目', stem: '证明它。', chapter: '第二章', keyCount: 4 },
    currentLayer: 'L1',
    layers: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((id) => ({ layer: id, title: titles[id], status: id === 'L1' ? 'active' : 'locked', enabled: id !== 'L5', skippable: id !== 'L3' && id !== 'L6' })),
    budget: { revealUsed: 0, revealMax: 2, keysOwn: 0, keysTotal: 4 },
    def: { task: '写出定义。', conceptId: 'c', submissions: 0, last: null, lessonSuggested: false },
    frame: { task: '写出证明骨架。', template: '', lessonId: 'f', last: null, templateShown: false },
    steps: { lines: [], canFinish: false },
    notes: [],
    help: { hintAvailable: true, nextLevel: 'H2', nextCost: 0.5, waitSec: 0, needAttempt: false, rapidLockUntil: null, exhausted: false, flagged: false, stuckOffer: false },
    integrity: { mode: 'practice', locked: false, warnings: 0, maxWarnings: null, notice: null, watermark: null },
    serverTime: '2026-11-04T00:00:00.000Z',
    ...overrides,
  }
}

export const jsonResponse = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
export const apiError = (status, code, message) => jsonResponse({ error: { code, message } }, status)

/**
 * 拦 /api/v1/**：handlers 是 { 'GET /student/path': (request, pathname) => response }，key 的路径按结尾匹配。
 * 返回 calls 数组（method、pathname、postData）；没匹配上的：/me、设置、进度给默认值，其余 404。
 */
export async function routeApi(page, handlers = {}) {
  const calls = []
  const defaults = {
    'GET /me': () => jsonResponse(ME),
    'GET /student/settings': () => jsonResponse(SETTINGS),
    'GET /student/progress': () => jsonResponse(PROGRESS),
  }
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const method = request.method()
    calls.push({ method, pathname, url: request.url(), postData: request.postData(), headers: request.headers() })
    const merged = { ...defaults, ...handlers }
    const key = Object.keys(merged).find((k) => {
      const [m, suffix] = k.split(' ')
      return m === method && pathname.endsWith(suffix)
    })
    if (key) return route.fulfill(merged[key](request, pathname))
    return route.fulfill(apiError(404, 'NOT_FOUND', 'no route'))
  })
  return calls
}

export async function startE2E(name) {
  if (!fs.existsSync(distDir)) {
    console.error('[' + name + '] 缺少构建产物，先运行 pnpm --filter @proof-gym/student build:mock')
    process.exit(2)
  }
  const exe = process.env.PG_CHROMIUM
  if (!exe || !fs.existsSync(exe)) {
    console.error('[' + name + '] 设置 PG_CHROMIUM 指向 chromium')
    process.exit(2)
  }
  const server = await serve(distDir)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const pageErrors = []
  let passed = 0
  let failed = 0

  const check = (label, ok, detail = '') => {
    if (ok) passed++
    else failed++
    console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? '  — ' + detail : ''))
  }

  /** 新开一个干净的页面（独立 localStorage）。 */
  const newPage = async ({ width = 390, height = 844, colorScheme = 'light', init } = {}) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 1024, deviceScaleFactor: 1, colorScheme })
    const page = await context.newPage()
    page.on('pageerror', (e) => pageErrors.push(e instanceof Error ? e.message : String(e)))
    if (init) await page.addInitScript(init.fn, init.arg)
    return { context, page }
  }

  const goto = async (page, route) => {
    await page.goto('about:blank')
    await page.goto(base + '/#' + route, { waitUntil: 'networkidle' })
  }

  /** 同一场景里的跑法：失败不打断后面的场景。 */
  const scenario = async (label, fn) => {
    console.log('--- ' + label + ' ---')
    try {
      await fn()
    } catch (e) {
      check('场景「' + label + '」跑完', false, e instanceof Error ? e.message.split('\n')[0] : String(e))
    }
  }

  const finish = async () => {
    check('页面没有未捕获的异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
    console.log('[' + name + '] ' + passed + '/' + (passed + failed) + ' 通过')
    process.exit(failed > 0 ? 1 : 0)
  }

  return { base, browser, check, newPage, goto, scenario, finish }
}

export const visible = (page, testId, timeout = 8000) => page.getByTestId(testId).first().waitFor({ state: 'visible', timeout })

export async function tap(page, testId) {
  const loc = page.getByTestId(testId).first()
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  await loc.click({ timeout: 8000 })
}

export const noOverflow = (page) =>
  page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement
    return root.scrollWidth <= window.innerWidth + 1
  })

export const bodyText = (page) => page.evaluate(() => document.body.innerText)

/** 真正能按到的大小（元素的外框，至少 44×44）。 */
export const boxOf = (locator) => locator.first().boundingBox()
export const atLeast44 = (box) => Boolean(box) && box.width >= 44 && box.height >= 44
