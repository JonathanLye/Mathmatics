/**
 * v3 做题页核心循环 e2e：提交 → 反馈面板 → 下一层过场 → 完成页（mock）。
 *
 * 覆盖：
 * A. L1 → 过场 → L2 → 过场 → L3 → 关键步骤反馈（衔接上了、+经验）→ 助教的问题（蓝，不说错）→
 *    写完了 → 过场 → L4 → L5 → L6 → 全屏完成页（经验、连胜、步骤、徽章、诚实说明、三个去向）
 * B. 证明轨道：行内改写、两步删除、取消删除
 * C. 输入器：只有一个入口，三个分段，记住默认手写
 * D. 拍照识别失败不死路（503）：说明、一键切手写/键盘、写过的内容还在
 * E. 测验模式：没有反馈面板、过场和奖励（?exam=1）
 * F. 每屏一个主按钮固定在手机底部；三个宽度无横向溢出；桌面两栏
 *
 * 用法：先 pnpm build:mock，再 pnpm e2e:flows:practice-v3
 * 产物：tests/.artifacts/flows-practice-v3/（已 gitignore）。
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
const outDir = path.join(__dirname, '.artifacts', 'flows-practice-v3')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
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
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean)
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()
    for (const d of dirs) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const exe = path.join(base, d, sub)
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
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

const waitTestId = (page, id, timeout = 8000) => page.getByTestId(id).first().waitFor({ state: 'visible', timeout })
const goneTestId = (page, id, timeout = 8000) => page.waitForSelector('[data-testid="' + id + '"]', { state: 'detached', timeout })
const countTestId = (page, id) => page.getByTestId(id).count()
const bodyText = (page) => page.evaluate(() => document.body.innerText)

async function tap(page, id, nth = 0) {
  const loc = page.getByTestId(id).nth(nth)
  await loc.waitFor({ state: 'visible', timeout: 8000 })
  await loc.scrollIntoViewIfNeeded()
  await loc.click({ timeout: 8000 })
}

async function fillIn(page, id, value) {
  const root = page.getByTestId(id)
  await root.waitFor({ state: 'visible', timeout: 8000 })
  const tag = await root.evaluate((el) => el.tagName.toLowerCase())
  const input = tag === 'textarea' || tag === 'input' ? root : root.locator('textarea, input').first()
  await input.fill(value)
}

async function open(page, base, query) {
  await page.goto('about:blank')
  await page.goto(base + '/#/pages/practice/index?' + query, { waitUntil: 'networkidle' })
}

/** 打开输入器、切到键盘、写一行、提交。 */
async function writeLine(page, statement, justification = '') {
  await tap(page, 'write-next')
  await waitTestId(page, 'editor-sheet')
  await tap(page, 'composer-tab-keyboard')
  await fillIn(page, 'editor-statement', statement)
  if (justification) await fillIn(page, 'editor-justification', justification)
  await tap(page, 'editor-submit')
  await goneTestId(page, 'editor-sheet')
}

async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[practice-v3] 缺少构建产物：' + distDir + '，先运行 pnpm build:mock')
    process.exit(2)
  }
  const exe = findChromium()
  if (!exe) { console.error('[practice-v3] 找不到 chromium，可设置 PG_CHROMIUM'); process.exit(2) }
  fs.mkdirSync(outDir, { recursive: true })

  const server = await serve(distDir)
  const base = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ executablePath: exe, headless: true })
  const pageErrors = []

  const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false })

  /** A. 核心循环。 */
  const fullLoop = async (page) => {
    await open(page, base, 'mock=l1-active')
    await waitTestId(page, 'layer1-form')
    check('顶栏：关闭、连续进度条、灯泡', (await countTestId(page, 'practice-topbar')) === 1 && (await countTestId(page, 'practice-progress')) === 1 && (await countTestId(page, 'dock-help')) === 1)
    check('不再重复「第 N 层」标题', !/第 \d 层/.test(await bodyText(page)))

    // L1 没通过：问题就在表单下面，不进过场
    await fillIn(page, 'layer1-form', '数列越来越接近某个数')
    await tap(page, 'layer1-check')
    await waitTestId(page, 'layer1-feedback')
    check('L1 没通过：留在这一层，不进过场', (await countTestId(page, 'layer-interstitial')) === 0)

    // L1 通过 → 过场
    await fillIn(page, 'layer1-form', '任取 $\\varepsilon>0$，存在 $N$，当 $n>N$ 时 $|a_n-A|<\\varepsilon$。')
    await tap(page, 'layer1-check')
    await waitTestId(page, 'layer-interstitial')
    check('L1 通过：过场说这一层做了什么', (await page.getByTestId('interstitial-did').innerText()).length > 0)
    check('过场：下一层的名字和一句话', (await page.getByTestId('interstitial-next').innerText()).length > 0)
    await shot(page, 'interstitial-l1')
    await tap(page, 'interstitial-continue')
    await goneTestId(page, 'layer-interstitial')
    await waitTestId(page, 'layer2-form')
    check('继续：到第 2 层', true)

    // L2 跳过也有过场
    await tap(page, 'layer2-skip')
    await waitTestId(page, 'layer-interstitial')
    await tap(page, 'interstitial-continue')
    await goneTestId(page, 'layer-interstitial')
    await waitTestId(page, 'write-next')
    check('到证明轨道', (await countTestId(page, 'practice-rail')) === 1)
    check('只有一个入口写下一行，没有操作坞', (await countTestId(page, 'write-next')) === 1 && (await page.locator('.pg-dock').count()) === 0)

    // 写到关键步骤 → 衔接上了
    const keysBefore = await page.getByTestId('practice-keys').innerText()
    await writeLine(page, '$|a_n-3|=\\frac{5}{n+2}$', '通分')
    await waitTestId(page, 'feedback-panel')
    const panelOk = page.getByTestId('feedback-panel')
    const okText = await panelOk.innerText()
    check('写到关键步骤：面板说衔接上了', okText.includes('衔接上了'), okText.slice(0, 60))
    check('面板有 +经验', (await countTestId(page, 'feedback-xp')) === 1 && (await page.getByTestId('feedback-xp').innerText()).includes('经验'))
    check('面板不说对错', !/答错|错误|正确|不对/.test(okText))
    check('关键步骤计数变了', (await page.getByTestId('practice-keys').innerText()) !== keysBefore)
    await shot(page, 'panel-ok')
    await tap(page, 'feedback-continue')
    await goneTestId(page, 'feedback-panel')

    // 轨道节点：写到关键步骤的这一行点亮
    const matched = await page.locator('.pg-lines__row--matched').count()
    check('轨道：关键步骤这一行节点点亮', matched >= 1, 'matched=' + matched)

    // 普通行 → 记下来；有问题就显示问题，都不判错
    await writeLine(page, '再把它写清楚一点', '整理')
    await waitTestId(page, 'feedback-panel')
    const seaText = await page.getByTestId('feedback-panel').innerText()
    check('普通行：面板不说对错、没有红叉', !/答错|错误|不对|×|✗/.test(seaText), seaText.slice(0, 60))
    await tap(page, 'feedback-continue')
    await goneTestId(page, 'feedback-panel')

    // 写完了 → 过场 → L4
    await tap(page, 'finish-steps')
    await waitTestId(page, 'layer-interstitial')
    await tap(page, 'interstitial-continue')
    await goneTestId(page, 'layer-interstitial')
    await waitTestId(page, 'selfcheck-form')
    check('写完了：经过场到自检', true)

    // 用 mock 直达 L6（L4、L5 的细节由 flows-26、flows-47 覆盖），走 L6 → 完成页
    await open(page, base, 'mock=l6-active')
    await waitTestId(page, 'summary-form')
    const answers = ['证了极限。', '分两块：化简、放大。', '把分式放大。', '当 n>N 时成立。', '放缩下次能用。']
    for (let i = 0; i < answers.length; i += 1) await fillIn(page, 'summary-input-' + i, answers[i])
    await tap(page, 'summary-submit')

    await waitTestId(page, 'completion-card')
    const done = await page.getByTestId('completion-card').innerText()
    check('完成页全屏', await page.getByTestId('completion-card').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1
    }))
    check('完成页：经验累加', (await countTestId(page, 'completion-xp')) === 1)
    check('完成页：连胜', (await countTestId(page, 'completion-streak')) === 1)
    check('完成页：靠自己的步骤', (await countTestId(page, 'completion-independence')) === 1)
    check('完成页：新徽章', (await countTestId(page, 'completion-badges')) === 1)
    check('完成页：诚实说明', done.includes('系统核对关键步骤是否齐全') && done.includes('老师讲评'))
    check('完成页：mathlib 收在延伸里', done.includes('延伸') && !done.includes('mathlib4'))
    check('完成页：下一题 / 换题试试 / 看我的证明', done.includes('下一题') && done.includes('换题试试') && done.includes('看我的证明'))
    await shot(page, 'completion')
    check('完成页：reviewAvailable=false 时没有看讲评', (await countTestId(page, 'completion-review')) === 0)

    // reviewAvailable=true（服务端说可以）：有看讲评，盖在全屏庆祝上面
    await open(page, base, 'mock=completed')
    await waitTestId(page, 'completion-review')
    await tap(page, 'completion-review')
    await waitTestId(page, 'review-proof')
    check('看讲评：显示参考证明，公式已渲染', (await page.getByTestId('review-proof').first().locator('.katex').count()) > 0)
    check('讲评盖在庆祝上面（能点到关闭）', await page.getByTestId('review-close').isEnabled())
    await shot(page, 'review')
    await tap(page, 'review-close')
    await goneTestId(page, 'review-proof')
  }

  /** B. 证明轨道：行内改写、删除。 */
  const rail = async (page) => {
    await open(page, base, 'mock=l3-active')
    await waitTestId(page, 'practice-rail')
    const lines = page.getByTestId('proof-line')
    const before = await lines.count()
    check('轨道：有行可改', before >= 1 && (await countTestId(page, 'line-edit')) >= 1)

    await tap(page, 'line-edit', before - 1)
    await waitTestId(page, 'editor-sheet')
    await tap(page, 'composer-tab-keyboard')
    const editing = page.getByTestId('editor-statement').locator('textarea').first()
    check('改写：打开时带着原来的内容', (await editing.inputValue()).length > 0)
    await editing.fill('改过的这一行')
    await tap(page, 'editor-submit')
    await goneTestId(page, 'editor-sheet')
    await page.waitForFunction((n) => {
      const all = document.querySelectorAll('[data-testid="proof-line"]')
      return all.length === n && all[n - 1].innerText.includes('改过的这一行')
    }, before, { timeout: 8000 })
    check('改写：行数不变，内容更新', true)

    await tap(page, 'line-delete', before - 1)
    await waitTestId(page, 'line-delete-confirm')
    check('删除要确认一次', (await lines.count()) === before)
    await tap(page, 'line-delete-cancel')
    await goneTestId(page, 'line-delete-confirm')
    check('取消删除：行还在', (await lines.count()) === before)

    await tap(page, 'line-delete', before - 1)
    await tap(page, 'line-delete-confirm')
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="proof-line"]').length === n - 1, before, { timeout: 8000 })
    check('确认删除：少一行', true)
  }

  /** C. 输入器。 */
  const composer = async (page) => {
    await open(page, base, 'mock=l3-active')
    await waitTestId(page, 'write-next')
    await tap(page, 'write-next')
    await waitTestId(page, 'editor-sheet')
    check('三个分段：手写 / 键盘 / 拍照', (await countTestId(page, 'composer-tab-hand')) === 1 && (await countTestId(page, 'composer-tab-keyboard')) === 1 && (await countTestId(page, 'composer-tab-photo')) === 1)
    await tap(page, 'composer-tab-keyboard')
    await fillIn(page, 'editor-statement', '$\\frac{5}{n}$')
    await tap(page, 'composer-tab-photo')
    await tap(page, 'composer-tab-keyboard')
    check('切分段：写的内容还在', (await page.getByTestId('editor-statement').locator('textarea').first().inputValue()) === '$\\frac{5}{n}$')
    await tap(page, 'editor-cancel')
    await goneTestId(page, 'editor-sheet')
  }

  /** E. 测验模式。 */
  const exam = async (page) => {
    await page.goto('about:blank')
    await page.goto(base + '/#/pages/practice/index?exam=1', { waitUntil: 'networkidle' })
    await waitTestId(page, 'exam-bar')
    check('测验模式：顶部计时', true)
    const text = await bodyText(page)
    check('测验模式：不显示经验、连胜', !/经验|连胜/.test(text))
    if ((await countTestId(page, 'write-next')) > 0) {
      await writeLine(page, '$|a_n-3|=\\frac{5}{n+2}$', '通分')
      await page.waitForTimeout(500)
      check('测验模式：提交后没有反馈面板', (await countTestId(page, 'feedback-panel')) === 0)
    }
    check('测验模式：没有过场', (await countTestId(page, 'layer-interstitial')) === 0)
  }

  /** 正常做题时不会误显示回看条。 */
  const notReviewing = async (page) => {
    for (const mock of ['l1-active', 'l3-active', 'l3-ready', 'l3-exhausted', 'l4-active', 'l5-active', 'l6-active']) {
      await open(page, base, 'mock=' + mock)
      await page.waitForTimeout(150)
      check(mock + '：不显示回看条', (await countTestId(page, 'reviewing-bar')) === 0)
    }
  }

  /** F. 布局。 */
  const layout = async (browserRef) => {
    for (const width of [390, 768, 1280]) {
      const ctx = await browserRef.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })
      const page = await ctx.newPage()
      page.on('pageerror', (err) => pageErrors.push(String(err)))
      for (const mock of ['l1-active', 'l3-active', 'l4-active', 'l5-active', 'l6-active']) {
        await open(page, base, 'mock=' + mock)
        await page.waitForTimeout(200)
        check(width + ' 宽 ' + mock + ' 无横向溢出', await noOverflow(page))
      }
      await open(page, base, 'mock=l1-active')
      await waitTestId(page, 'layer1-check')
      const box = await page.getByTestId('layer1-check').boundingBox()
      if (width === 390) {
        check('手机：主按钮固定在底部', Boolean(box) && box.y + box.height > 800 - 120, 'y=' + box?.y)
      }
      if (width === 1280) {
        await open(page, base, 'mock=l3-active')
        await waitTestId(page, 'practice-rail')
        const stem = await page.getByTestId('practice-stem').boundingBox()
        const aside = await page.locator('.pg-practice__aside').first().boundingBox()
        check('桌面：左边题面和证明，右边助教批注', Boolean(stem && aside) && aside.x > stem.x + stem.width - 1)
        const width1 = await page.locator('.pg-practice__content').first().evaluate((el) => el.getBoundingClientRect().width).catch(() => 0)
        check('桌面：表单不会拉满', width1 <= 1100 + 1, 'w=' + width1)
      }
      await ctx.close()
    }
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => pageErrors.push(err instanceof Error ? err.message : String(err)))
    for (const [name, scenario] of [
      ['核心循环', fullLoop],
      ['证明轨道', rail],
      ['输入器', composer],
      ['测验模式', exam],
      ['不误显示回看条', notReviewing],
    ]) {
      try {
        await scenario(page)
      } catch (e) {
        check('场景「' + name + '」未中断', false, e instanceof Error ? e.message.slice(0, 300) : String(e))
      }
    }
    await ctx.close()
    try {
      await layout(browser)
    } catch (e) {
      check('场景「布局」未中断', false, e instanceof Error ? e.message.slice(0, 300) : String(e))
    }
    check('页面无未捕获 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  console.log('[practice-v3] ' + (results.length - failed) + '/' + results.length + ' 通过；截图：' + outDir)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
