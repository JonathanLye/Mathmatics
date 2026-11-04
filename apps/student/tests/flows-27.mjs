/**
 * #27 诚信与事件 SDK + IndexedDB 草稿 + 离线提示 e2e。
 *
 * 前置：npm run build:mock（?mock= 只在 VITE_ENABLE_MOCK=1 构建里生效）。
 * 覆盖：
 *  A. L1 输入 → IndexedDB 防抖保存 → reload → 草稿恢复提示 + 内容恢复 → 提交成功后草稿清除；
 *  B. visibilitychange(hidden) → 时间快进 30s → visible：mock 事件接收器里 10 秒内出现
 *     integ.visibility{state:visible,awayMs≈30000}（教师看板 A 侧证据，服务端/教师端消费见 #101/#102）；
 *  C. 断网 → 离线提示条出现；恢复 → 提示「网络已恢复」后消失；pageerror 为空、390 无横向溢出。
 * 产物：tests/.artifacts/flows-27/*.png + report.json（gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-27')

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

async function waitTestId(page, testId, timeout = 10000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
}

async function testIdCount(page, testId) {
  return page.getByTestId(testId).count()
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText)
}

async function tap(page, testId, label = testId) {
  const loc = page.getByTestId(testId)
  await loc.waitFor({ state: 'visible', timeout: 10000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 10000 })
  console.log('      · 已点击 ' + label)
}

async function openMock(page, base, mock) {
  await page.goto('about:blank')
  await page.goto(base + '/#/pages/practice/index?mock=' + mock, { waitUntil: 'networkidle' })
  // L1/L2 有 textarea；L3 有「写下一行」按钮（行编辑器打开后才有 textarea）
  await page.waitForSelector('textarea, .pg-lines__add', { state: 'visible', timeout: 15000 })
}

/** 读 IndexedDB 里 SDK/草稿写入的键值（H5 持久化证据）。 */
async function readIdb(page) {
  return page.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('proof-gym', 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv')
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const db = await open()
    try {
      const tx = db.transaction('kv', 'readonly')
      const store = tx.objectStore('kv')
      const [keys, values] = await Promise.all([
        new Promise((resolve, reject) => {
          const r = store.getAllKeys()
          r.onsuccess = () => resolve(r.result.map(String))
          r.onerror = () => reject(r.error)
        }),
        new Promise((resolve, reject) => {
          const r = store.getAll()
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        }),
      ])
      return { keys, values }
    } finally {
      db.close()
    }
  })
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[flows-27] 缺少构建产物：' + distDir + '，先运行 npm run build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[flows-27] 找不到 chromium，可设置 PG_CHROMIUM 指向 chrome.exe'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir)
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (err) => pageErrors.push(err instanceof Error ? err.message : String(err)))

  // 时间快进垫片：真实 timers 不动，只移动 Date.now（模拟离开 30s，不真等 30s）
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date)
    let offset = 0
    Date.now = () => realNow() + offset
    window.__PG_ADVANCE__ = (ms) => { offset += ms }
  })

  const scenarioDraft = async () => {
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    check('打开 mock=l1-active 渲染 L1 输入区', (await testIdCount(page, 'layer1-form')) === 1)

    const draftText = '任取 $\\varepsilon>0$，存在 $N$，当 $n>N$ 时 $|a_n-A|<\\varepsilon$（草稿测试）。'
    await page.getByRole('textbox').fill(draftText)
    await page.waitForTimeout(800) // 500ms 防抖 + IndexedDB 写入

    const afterInput = await readIdb(page)
    const savedDrafts = afterInput.keys
      .map((key, index) => ({ key, value: afterInput.values[index] }))
      .filter((item) => item.key.startsWith('draft:'))
    check('输入 500ms 防抖后写入 IndexedDB（draft:<attemptId>:def）', savedDrafts.length === 1 && savedDrafts[0].key.endsWith(':def'), JSON.stringify(afterInput.keys))
    check('草稿只存 text/updatedAt，不含 token/PII', savedDrafts[0] && Object.keys(savedDrafts[0].value || {}).sort().join(',') === 'text,updatedAt')

    await page.screenshot({ path: path.join(outDir, '1-draft-saved.png'), fullPage: true })
    await page.reload({ waitUntil: 'networkidle' })
    await waitTestId(page, 'layer1-form')
    await waitTestId(page, 'draft-restored')
    check('reload 后显示「已恢复上次未提交的草稿」提示', (await bodyText(page)).includes('已恢复上次未提交的草稿'))
    const restored = await page.getByRole('textbox').inputValue()
    check('reload 后输入内容从 IndexedDB 恢复', restored.trim() === draftText.trim(), restored.slice(0, 40))
    await page.screenshot({ path: path.join(outDir, '2-draft-restored.png'), fullPage: true })

    await tap(page, 'layer1-check', '核对（提交成功清除草稿）')
    await waitTestId(page, 'layer2-form')
    await page.waitForTimeout(300)
    const afterSubmit = await readIdb(page)
    check('提交成功后清除该 attempt 的草稿', afterSubmit.keys.filter((key) => key.startsWith('draft:')).length === 0, JSON.stringify(afterSubmit.keys))
  }

  const scenarioVisibility = async () => {
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')

    // 隐藏：SDK 立即上报 hidden（beacon 模式进 mock 接收器）
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForFunction(() => {
      const api = window.__PG_EVENTS__
      return Boolean(api && api.events().some((event) => event.type === 'integ.visibility' && event.payload.state === 'hidden'))
    }, { timeout: 10000 })

    // 模拟离开 30 秒后回来
    await page.evaluate(() => window.__PG_ADVANCE__(30000))
    const returnedAt = Date.now()
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await page.waitForFunction(() => {
      const api = window.__PG_EVENTS__
      if (!api) return false
      return api.events().some(
        (event) => event.type === 'integ.visibility' && event.payload.state === 'visible' && Number(event.payload.awayMs) > 0,
      )
    }, { timeout: 12000 })
    const elapsed = Date.now() - returnedAt

    const info = await page.evaluate(() => {
      const api = window.__PG_EVENTS__
      const events = api ? api.events() : []
      const visible = events.filter((event) => event.type === 'integ.visibility' && event.payload.state === 'visible').pop()
      const batches = api ? api.batches.map((batch) => ({ via: batch.via, types: batch.events.map((event) => event.type) })) : []
      return { visible, events, batches }
    })
    const awayMs = Number(info.visible?.payload?.awayMs)
    check('hide→show 上报 integ.visibility{state:visible,awayMs≈30000}', Math.abs(awayMs - 30000) <= 300, 'awayMs=' + awayMs)
    check('visible 事件在 10 秒内发出（教师看板 10s 内可消费）', elapsed <= 10000, 'elapsed=' + elapsed + 'ms')
    check('visible 事件是合法 ClientEvent（uuid/sessionId/deviceId/clientSeq/attemptId）', Boolean(
      info.visible &&
        /^[0-9a-f-]{36}$/.test(info.visible.id) &&
        info.visible.sessionId &&
        info.visible.deviceId &&
        info.visible.clientSeq > 0 &&
        info.visible.attemptId,
    ), JSON.stringify(info.visible && { id: info.visible.id, clientSeq: info.visible.clientSeq, attemptId: info.visible.attemptId, layer: info.visible.layer }))
    check('hidden 事件也进入批次（切出即发，不等 5s）', info.batches.some((batch) => batch.via === 'beacon' && batch.types.includes('integ.visibility')))
    console.log('      · 最近批次：' + JSON.stringify(info.batches.slice(-2)))
    await page.screenshot({ path: path.join(outDir, '3-visibility.png'), fullPage: true })
  }

  const scenarioOffline = async () => {
    await openMock(page, base, 'l1-active')
    await waitTestId(page, 'layer1-form')
    check('在线时无离线提示条', (await testIdCount(page, 'offline-bar')) === 0)

    await context.setOffline(true)
    try {
      await waitTestId(page, 'offline-bar', 3000)
    } catch {
      // Playwright setOffline 在网络层模拟；若 Chromium 未派发 offline 事件，补一次事件验证同一监听路径
      await page.evaluate(() => window.dispatchEvent(new Event('offline')))
      await waitTestId(page, 'offline-bar', 3000)
    }
    const offlineText = await page.getByTestId('offline-bar').innerText()
    check('断网后出现离线提示条（提示已保存本机 + 重试）', offlineText.includes('网络断开') && offlineText.includes('已保存在本机'), offlineText)
    check('离线提示条不覆盖 44px 操作区（不悬浮在 BottomDock 上）', await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="offline-bar"]')
      const dock = document.querySelector('.pg-practice__dockwrap')
      if (!bar || !dock) return true
      return bar.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 1
    }))
    await page.screenshot({ path: path.join(outDir, '4-offline.png'), fullPage: true })

    await context.setOffline(false)
    try {
      await page.waitForFunction(() => {
        const bar = document.querySelector('[data-testid="offline-bar"]')
        return !bar || bar.innerText.includes('网络已恢复')
      }, { timeout: 3000 })
    } catch {
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await page.waitForFunction(() => {
        const bar = document.querySelector('[data-testid="offline-bar"]')
        return !bar || bar.innerText.includes('网络已恢复')
      }, { timeout: 3000 })
    }
    check('恢复网络后提示「网络已恢复，正在同步…」（3 秒后消失）', (await bodyText(page)).includes('网络已恢复') || (await testIdCount(page, 'offline-bar')) === 0)
    await page.waitForTimeout(3300)
    check('恢复提示 3 秒后自动消失（不遮挡作答区）', (await testIdCount(page, 'offline-bar')) === 0)
  }

  const scenarioDraftL3 = async () => {
    await openMock(page, base, 'l3-active')
    await page.waitForSelector('.pg-lines__add', { state: 'visible', timeout: 10000 })
    await page.locator('.pg-lines__add').click()
    await waitTestId(page, 'editor-sheet')

    const statement = '第 3 行：$|a_n-3|=\\frac{5}{n+2}$（L3 草稿测试）'
    const justification = '通分整理'
    await page.getByTestId('editor-statement').locator('textarea').fill(statement)
    await page.getByTestId('editor-justification').locator('textarea').fill(justification)
    await page.waitForTimeout(800)

    const savedKeys = (await readIdb(page)).keys.filter((key) => key.startsWith('draft:'))
    check('L3 行编辑器输入防抖写入 IndexedDB（结论/依据两条）', savedKeys.some((key) => key.endsWith(':line_statement')) && savedKeys.some((key) => key.endsWith(':line_justification')), JSON.stringify(savedKeys))

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.pg-lines__add', { state: 'visible', timeout: 10000 })
    await waitTestId(page, 'draft-restored')
    check('L3 reload 后提示恢复草稿', (await bodyText(page)).includes('已恢复上次未提交的草稿'))
    await page.locator('.pg-lines__add').click()
    await waitTestId(page, 'editor-sheet')
    const restoredStatement = await page.getByTestId('editor-statement').locator('textarea').inputValue()
    const restoredJustification = await page.getByTestId('editor-justification').locator('textarea').inputValue()
    check('L3 reload 后结论/依据都恢复', restoredStatement.trim() === statement.trim() && restoredJustification.trim() === justification.trim(), restoredStatement.slice(0, 30))
    await page.screenshot({ path: path.join(outDir, '5-draft-l3-restored.png'), fullPage: true })

    await tap(page, 'editor-submit', '加入证明（提交成功后清草稿）')
    await page.waitForSelector('.pg-lines__row', { state: 'visible', timeout: 10000 })
    await page.waitForTimeout(300)
    const afterSubmitKeys = (await readIdb(page)).keys.filter((key) => key.startsWith('draft:'))
    check('L3 提交成功后清除行草稿', afterSubmitKeys.length === 0, JSON.stringify(afterSubmitKeys))
  }

  const scenarioOverflow = async () => {
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement
      return { scrollWidth: root.scrollWidth, innerWidth: window.innerWidth }
    })
    check('390 宽无横向溢出', overflow.scrollWidth <= overflow.innerWidth + 1, JSON.stringify(overflow))
  }

  try {
    for (const [name, scenario] of [
      ['IndexedDB 草稿（保存/恢复/提交清除）', scenarioDraft],
      ['L3 行草稿（防抖/恢复/提交清除）', scenarioDraftL3],
      ['visibility 30s → integ.visibility（10s 内上报）', scenarioVisibility],
      ['离线提示条（断网/恢复）', scenarioOffline],
    ]) {
      try {
        await scenario()
      } catch (e) {
        check('场景「' + name + '」未中断', false, e instanceof Error ? e.message : String(e))
      }
    }
    await scenarioOverflow()
    check('页面无未捕获 JS 异常（pageerror）', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    await context.close()
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: results, pageErrors }, null, 2), 'utf8')
  console.log('[flows-27] ' + (results.length - failed) + '/' + results.length + ' 通过；截图与报告：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
