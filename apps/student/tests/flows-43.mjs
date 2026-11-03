/**
 * #43 教师镜像预览页 e2e：/s/mirror?attempt&token → SSE → 只读渲染。
 *
 * 覆盖：
 *  A. token 非法：友好错误页，不发起 SSE，不渲染学生数据；
 *  B. SSE：event: state 帧渲染只读页面（题面/层/定义/骨架/行/批注），无任何输入/按钮，token 不进可见文本；
 *     首条流结束后自动重连（指数退避）并渲染第 2 帧（stateVersion 递增）；
 *  C. 路径式 URL（C 的 mirror-token.url）：静态服务器 SPA fallback + main.ts 重定向到 #/pages/mirror/index；
 *  D. 401/403/流不可用：连续失败后页面提示「令牌可能已过期或无权访问」；
 *  E. pageerror 为空、390 无横向溢出。
 *
 * N2（跨源 EventSource 重连 Last-Event-ID 是否会触发 CORS 预检）：
 * - 本页的重连策略是「error 后 close 再新建 EventSource」，构造器不能设置 header，所以本页自身
 *   不会发送 Last-Event-ID（代价是重连后服务端重发完整 state，镜像仍收敛到最新状态）；
 * - 浏览器 EventSource 自带的自动重连才会带 Last-Event-ID。Chromium 下该 header 属于
 *   CORS-safelisted request header（Fetch 规范为 EventSource 特判），不会触发 OPTIONS 预检；
 *   若某些浏览器/代理仍预检，C 需要为 stream 路由补 OPTIONS + Access-Control-Allow-Headers: Last-Event-ID。
 *   （用本地两端口实验在本机 Chromium 验证：重连 GET 带 Last-Event-ID，未出现 OPTIONS；见汇报。）
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
const outDir = path.join(__dirname, '.artifacts', 'flows-43')

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

/** 静态服务器：SPA fallback（/s/mirror 路径返回 index.html，交给 main.ts 重定向到 hash 路由）。 */
function serve(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(root, urlPath)
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    const isSpaPath = urlPath === '/s/mirror' || urlPath.startsWith('/s/mirror/')
    if (isSpaPath) file = path.join(root, 'index.html')
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
  await page.waitForSelector('[data-testid="' + testId + '"]', { state: 'visible', timeout })
}

async function countTestId(page, testId) {
  return page.getByTestId(testId).count()
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'mirror_token_abcdef123456'

function layerRows(current, states) {
  const titles = { L1: '记忆核验', L2: '证明骨架', L3: '构造与推导', L4: '自检', L5: '迁移题', L6: '总结' }
  return ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((id) => ({
    layer: id,
    title: titles[id],
    status: states[id] ?? 'locked',
    enabled: id !== 'L5',
    skippable: ['L1', 'L2', 'L4', 'L5'].includes(id),
  }))
}

function makeState(version, patch = {}) {
  return {
    attemptId: ATTEMPT,
    stateVersion: version,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem: {
      problemId: 'epsN',
      version: 1,
      title: '数列极限 · ε-N（镜像）',
      stem: '用 $\\varepsilon$-$N$ 定义证明 $\\displaystyle\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$。',
      chapter: '第二章 数列极限',
      keyCount: 4,
    },
    currentLayer: 'L3',
    layers: layerRows('L3', { L1: 'done', L2: 'done', L3: 'active' }),
    budget: { revealUsed: 0.5, revealMax: 2, keysOwn: 1, keysTotal: 4 },
    def: { task: '写出定义。', conceptId: 'seq-limit', submissions: 1, last: '任取 $\\varepsilon>0$，存在 $N$。', lessonSuggested: false },
    frame: { task: '写出骨架。', template: '取 $N=$＿。', last: '先放大，再取 N。', templateShown: true },
    steps: {
      lines: [
        { lineId: 'line-1', n: 1, statement: '$|a_n-3|=\\frac{5}{n+2}$', justification: '通分', provenance: 'ink', keys: [], inkId: null },
        { lineId: 'line-2', n: 2, statement: '$\\frac{5}{n+2}<\\frac{5}{n}$', justification: '放大', provenance: 'keyboard', keys: [], inkId: null },
      ],
      canFinish: false,
    },
    notes: [
      { noteId: 'note-1', kind: 'annotation', who: '批注', text: '这一行的依据是哪条？', lineId: 'line-1', level: null, cost: null, lessonConceptId: null, at: '2026-11-04T00:00:00.000Z' },
      { noteId: 'note-2', kind: 'hint', who: 'H1', text: '先把式子写成只含 n 的量。', lineId: null, level: 'H1', cost: 0, lessonConceptId: null, at: '2026-11-04T00:01:00.000Z' },
    ],
    help: { hintAvailable: true, exhausted: false, flagged: false },
    integrity: { mode: 'practice', locked: false, warnings: 0 },
    serverTime: '2026-11-04T00:02:00.000Z',
    ...patch,
  }
}

const STATE_V7 = makeState(7)
const STATE_V8 = makeState(8, { def: { task: '写出定义。', conceptId: 'seq-limit', submissions: 1, last: '更新后的定义（v8）。', lessonSuggested: false } })

function sseBody(state, id) {
  return 'id: ' + id + '\nevent: state\ndata: ' + JSON.stringify(state) + '\n\nevent: ping\ndata: {}\n\n'
}

async function collectStatuses(page, durationMs) {
  const seen = new Set()
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mirror-status"]')
      return el ? el.textContent ?? '' : ''
    })
    if (text) seen.add(text.trim())
    await page.waitForTimeout(80)
  }
  return seen
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-43] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-43] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
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

  const scenarioInvalidToken = async () => {
    const { context, page } = await newPage()
    let streamRequests = 0
    try {
      await page.route('**/api/v1/teacher/attempts/**/stream*', (route) => {
        streamRequests += 1
        return route.fulfill({ status: 500, body: 'should not be called' })
      })
      await page.goto('about:blank')
      await page.goto(base + '/#/pages/mirror/index?attempt=' + ATTEMPT + '&token=short', { waitUntil: 'networkidle' })
      await waitTestId(page, 'mirror-error')
      const text = await bodyText(page)
      check('缺少/非法 token → 友好错误页（不渲染数据）', text.includes('无法打开镜像预览') && text.includes('链接无效或已过期'))
      check('非法 token 不发起 SSE 连接', streamRequests === 0, 'streamRequests=' + streamRequests)
      check('错误页没有学生数据（不出现题面/证明行）', !text.includes('数列极限') && !text.includes('通分'))
      check('错误页仍然只有「只读」标识、无输入按钮', text.includes('教师镜像预览 · 只读') && (await page.locator('[data-testid="mirror-page"] button, [data-testid="mirror-page"] input, [data-testid="mirror-page"] textarea').count()) === 0)
      await page.screenshot({ path: path.join(outDir, '1-invalid-token.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioLiveMirror = async () => {
    const { context, page } = await newPage()
    let streamRequests = 0
    const streamHeaders = []
    try {
      await page.route('**/api/v1/teacher/attempts/**/stream*', (route) => {
        streamRequests += 1
        streamHeaders.push(route.request().headers())
        const state = streamRequests === 1 ? STATE_V7 : STATE_V8
        return route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
          body: sseBody(state, String(state.stateVersion)),
        })
      })

      await page.goto('about:blank')
      await page.goto(base + '/#/pages/mirror/index?attempt=' + ATTEMPT + '&token=' + encodeURIComponent(TOKEN), { waitUntil: 'networkidle' })
      await waitTestId(page, 'mirror-title')
      const text = await bodyText(page)
      check('SSE state 帧渲染只读镜像（题面/层/定义/骨架）', text.includes('数列极限 · ε-N（镜像）') && text.includes('第 3 层') && text.includes('任取'))
      check('证明行 + 行内批注由学生端组件渲染', (await countTestId(page, 'proof-line')) === 2 && text.includes('通分') && text.includes('这一行的依据是哪条'))
      check('顶部有「教师镜像预览 · 只读」标识', (await page.getByTestId('mirror-banner').innerText()).includes('教师镜像预览 · 只读'))
      const controlCount = await page.locator('[data-testid="mirror-page"] input, [data-testid="mirror-page"] textarea, [data-testid="mirror-page"] select, [data-testid="mirror-page"] button').count()
      check('镜像页没有任何输入/提交/按钮（只读）', controlCount === 0, 'controls=' + controlCount)
      check('不渲染「写下一行」/mock 切换等交互入口', (await countTestId(page, 'write-next')) === 0 && (await countTestId(page, 'mock-switcher')) === 0)
      check('token 不出现在可见文本里', !text.includes(TOKEN))
      check('页面内说明回放由教师端提供', text.includes('回放由教师端提供'))
      check('390 宽镜像页无横向溢出', await page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement
        return root.scrollWidth <= window.innerWidth + 1
      }))
      await page.screenshot({ path: path.join(outDir, '2-mirror-state-v7.png'), fullPage: true })

      // 首条流结束 → error → 指数退避重连；第 2 帧 v8 应覆盖 v7。
      await page.waitForFunction(() => document.body.innerText.includes('更新后的定义（v8）'), { timeout: 15000 })
      check('断线后自动重连并渲染更新的 stateVersion', streamRequests >= 2 && (await bodyText(page)).includes('更新后的定义（v8）'), 'streamRequests=' + streamRequests)
      const statusSeen = await collectStatuses(page, 800)
      check('连接状态指示出现（连接中/已连接/重连中）', statusSeen.size > 0, JSON.stringify([...statusSeen]))
      check('重连请求由本页新建 EventSource 发起（不带 Last-Event-ID，服务端重发完整 state）', streamHeaders.slice(1).every((headers) => !headers['last-event-id']), JSON.stringify(streamHeaders.map((h) => h['last-event-id'] ?? null)))
      await page.screenshot({ path: path.join(outDir, '3-mirror-reconnected.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioMirrorPathRedirect = async () => {
    const { context, page } = await newPage()
    try {
      await page.route('**/api/v1/teacher/attempts/**/stream*', (route) =>
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          body: sseBody(STATE_V8, '8'),
        }),
      )
      await page.goto('about:blank')
      await page.goto(base + '/s/mirror?attempt=' + ATTEMPT + '&token=' + encodeURIComponent(TOKEN), { waitUntil: 'networkidle' })
      await waitTestId(page, 'mirror-title')
      const url = page.url()
      check('/s/mirror 路径被重定向到 hash 路由并保留 attempt/token', url.includes('#/pages/mirror/index') && url.includes('attempt=' + ATTEMPT))
      check('路径式入口同样渲染只读镜像', (await bodyText(page)).includes('更新后的定义（v8）'))
      await page.screenshot({ path: path.join(outDir, '4-mirror-from-path.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  const scenarioStreamUnauthorized = async () => {
    const { context, page } = await newPage()
    let streamRequests = 0
    try {
      await page.route('**/api/v1/teacher/attempts/**/stream*', (route) => {
        streamRequests += 1
        return route.fulfill({
          status: 401,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '镜像令牌无效或已过期' } }),
        })
      })
      await page.goto('about:blank')
      await page.goto(base + '/#/pages/mirror/index?attempt=' + ATTEMPT + '&token=' + encodeURIComponent(TOKEN), { waitUntil: 'networkidle' })
      await waitTestId(page, 'mirror-auth-hint', 12000)
      const text = await bodyText(page)
      check('SSE 401/不可用：提示令牌可能过期或无权限', text.includes('令牌可能已过期或无权访问'), 'streamRequests=' + streamRequests)
      check('未授权时仍只显示只读占位/提示，不渲染任何学生数据', !text.includes('数列极限') && (await countTestId(page, 'mirror-title')) === 0)
      await page.screenshot({ path: path.join(outDir, '5-mirror-auth-hint.png'), fullPage: true })
    } finally {
      await context.close()
    }
  }

  try {
    for (const [name, scenario] of [
      ['token 非法错误页', scenarioInvalidToken],
      ['SSE 只读镜像 + 断线重连', scenarioLiveMirror],
      ['路径式 /s/mirror 重定向', scenarioMirrorPathRedirect],
      ['SSE 401 提示过期/无权限', scenarioStreamUnauthorized],
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
  console.log('[flows-43] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
