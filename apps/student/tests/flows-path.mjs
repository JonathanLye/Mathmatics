/**
 * 首页学习路径 e2e（pnpm e2e:flows:path）。
 * 覆盖：路径渲染和蜿蜒布局、当前节点继续、已完成回看和讲评、软锁确认、单元复习宝箱、换单元、单元讲义、
 * 刚完成的动画只放一次、老师布置、空/错状态、右栏、各宽度无横向滚动、按钮至少 44px、引导要用的三个锚点。
 */
import { apiError, atLeast44, attemptState, bodyText, boxOf, jsonResponse, noOverflow, routeApi, startE2E, tap, visible } from './e2eKit.mjs'

const { check, newPage, goto, scenario, finish } = await startE2E('flows-path')
const HOME = '/pages/home/index'
const REAL = HOME + '?api=real'
const node = (page, attrs) => page.locator('[data-testid="home-path-node"]' + attrs).first()

const item = (id, state, extra = {}) => ({
  problemId: id,
  title: '题目 ' + id,
  stemPreview: '证明 ' + id,
  difficulty: 'easy',
  state,
  currentLayer: state === 'active' ? 'L3' : null,
  layersDone: state === 'done' ? 6 : state === 'active' ? 2 : 0,
  layersTotal: 6,
  attemptId: state === 'todo' ? null : 'attempt-' + id,
  reviewPublished: false,
  autoImported: false,
  softLocked: false,
  lessonAvailable: false,
  ...extra,
})
const unit = { id: 'u1', chapterNo: 2, unitNo: 1, title: '极限定义', summary: '先放大再倒推。', total: 3, done: 1, state: 'active', locked: false }
const PATH = {
  course: { id: 'c', title: '数学分析' },
  units: [unit],
  current: { ...unit, items: [item('p1', 'done'), item('p2', 'todo'), item('p3', 'todo', { softLocked: true })], conceptIds: [], concepts: [] },
  teacherAssignments: [
    { assignmentId: 'a-open', title: '老师的题', chapter: '第二章', mode: 'practice', status: 'open', closeAt: '2030-01-02T00:00:00.000Z', attemptId: null, currentLayer: null, reviewPublished: false },
    { assignmentId: 'a-later', title: '还没开放的题', chapter: '第二章', mode: 'practice', status: 'scheduled', openAt: '2030-01-01T00:00:00.000Z', attemptId: null, currentLayer: null, reviewPublished: false },
  ],
  chapters: [{ chapterNo: 2, chapter: '第二章 数列极限', firstUnitId: 'u1', unitCount: 1, total: 3, done: 1 }],
}

await scenario('路径渲染', async () => {
  const { context, page } = await newPage()
  await goto(page, HOME)
  await visible(page, 'home-path')
  const nodes = page.getByTestId('home-path-node')
  check('有多个节点', (await nodes.count()) >= 3, String(await nodes.count()))
  check('只有一个当前节点', (await page.locator('[data-testid="home-path-node"][data-current="true"]').count()) === 1)
  const done = await page.locator('[data-testid="home-path-node"][data-state="done"]').count()
  check('走过的路段是金色，和完成数一样多', (await page.locator('.pg-pathmap__face--done path').count()) === done && done > 0)
  const xs = await nodes.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)))
  check('节点左右蜿蜒（横坐标不止一个）', new Set(xs).size >= 3, xs.join(','))
  check('小方站在路径上', (await page.getByTestId('home-mascot').count()) === 1)

  const face = await boxOf(page.getByTestId('home-path-node'))
  const bubble = await boxOf(page.getByTestId('home-continue'))
  const chest = await boxOf(page.getByTestId('home-unit-review'))
  const picker = await boxOf(page.getByTestId('home-chapter-picker'))
  check('节点、继续、宝箱、选单元至少 44px', atLeast44(face) && atLeast44(bubble) && atLeast44(chest) && atLeast44(picker), JSON.stringify({ face, bubble, chest, picker }))

  check('引导锚点：节点', await page.getByTestId('home-path-node').first().isVisible())
  check('引导锚点：今日目标', await page.getByTestId('home-daily-goal').first().isVisible())
  check('引导锚点：我的', await page.getByTestId('nav-me').first().isVisible())
  check('手机上不显示右栏', (await page.getByTestId('progress-rail').count()) === 0)
  await context.close()
})

await scenario('继续当前题', async () => {
  const { context, page } = await newPage()
  await goto(page, HOME)
  await tap(page, 'home-continue')
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
  check('点继续进入做题页', page.url().includes('/pages/practice/index') && page.url().includes('from=path'), page.url())
  await context.close()
})

await scenario('已完成：回看和讲评', async () => {
  const { context, page } = await newPage()
  await goto(page, HOME)
  await visible(page, 'home-path')
  await node(page, '[data-state="done"]').click()
  await visible(page, 'node-sheet')
  check('节点弹层有题目和步骤', (await page.getByTestId('node-sheet-title').isVisible()) && (await page.getByTestId('node-sheet-steps').isVisible()))
  check('弹层的遮罩盖住标签栏', await page.evaluate(() => {
    const tab = document.querySelector('.pg-tabbar').getBoundingClientRect()
    const hit = document.elementFromPoint(tab.left + tab.width / 2, tab.top + tab.height / 2)
    return Boolean(hit?.closest('.pg-overlay'))
  }))
  await tap(page, 'node-sheet-review')
  await visible(page, 'proof-detail-page')
  await visible(page, 'proof-detail-reference')
  check('看讲评打开详情，显示接口给的讲评', (await page.getByTestId('proof-detail-reference').first().innerText()).length > 0 && page.url().includes('section=review'))
  await context.close()
})

await scenario('软锁：确认才跳过去', async () => {
  const { context, page } = await newPage()
  await goto(page, HOME)
  await visible(page, 'home-path')
  await node(page, '[data-visual="locked"]').click()
  await visible(page, 'node-sheet-locked')
  await tap(page, 'node-sheet-stay')
  await page.getByTestId('node-sheet').waitFor({ state: 'hidden', timeout: 5000 })
  check('回到当前这道：弹层关闭，留在路径', page.url().includes('/pages/home/index'))
  await node(page, '[data-visual="locked"]').click()
  await tap(page, 'node-sheet-jump')
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
  check('跳到这一道：进入做题页', page.url().includes('/pages/practice/index'))
  await context.close()
})

await scenario('单元复习、讲义、换单元', async () => {
  const { context, page } = await newPage()
  await goto(page, HOME)
  await visible(page, 'home-path')
  await tap(page, 'home-unit-notes')
  await visible(page, 'unit-notes-sheet')
  check('单元讲义有概要', await page.getByTestId('unit-notes-summary').isVisible())
  await page.keyboard.press('Escape')
  await page.getByTestId('unit-notes-sheet').waitFor({ state: 'hidden', timeout: 5000 })

  await tap(page, 'home-chapter-picker')
  await visible(page, 'home-chapter-sheet')
  const locked = page.locator('[data-testid="home-unit-row"][data-locked="true"]').first()
  await locked.click()
  await visible(page, 'home-unit-confirm')
  await tap(page, 'home-unit-confirm-stay')
  await page.getByTestId('home-unit-confirm').waitFor({ state: 'hidden', timeout: 5000 })
  check('没解锁的单元先确认，留在这里还能接着选', await page.getByTestId('home-chapter-sheet').isVisible())
  await page.keyboard.press('Escape')
  await page.getByTestId('home-chapter-sheet').waitFor({ state: 'hidden', timeout: 5000 })

  const before = await page.getByTestId('home-unit-banner').innerText()
  await tap(page, 'home-prev-unit')
  await page.waitForFunction((text) => document.querySelector('[data-testid="home-unit-banner"]')?.innerText !== text, before, { timeout: 8000 })
  check('换到上一单元，横幅换了', (await page.getByTestId('home-unit-banner').innerText()) !== before)
  check('做完的单元：宝箱打开，全部节点金色', (await page.locator('[data-testid="home-path-node"]:not([data-state="done"])').count()) === 0 && (await page.locator('.pg-chest--done').count()) === 1)
  await tap(page, 'home-next-unit')
  await page.waitForFunction((text) => document.querySelector('[data-testid="home-unit-banner"]')?.innerText === text, before, { timeout: 8000 })

  await tap(page, 'home-unit-review')
  await visible(page, 'mistakes-page')
  await visible(page, 'mistake-item')
  check('宝箱进错题，只看这一章', (await page.getByTestId('mistakes-filter').innerText()).includes('第二章'))
  const chapters = await page.getByTestId('mistake-item').evaluateAll((els) => els.map((el) => el.innerText))
  check('筛选后都是这一章的', chapters.length > 0 && chapters.every((text) => text.includes('第二章')), String(chapters.length))
  await context.close()
})

await scenario('刚完成的动画只放一次', async () => {
  const { context, page } = await newPage()
  await goto(page, HOME)
  await visible(page, 'home-path')
  check('第一次来不播（之前的都算看过）', (await page.locator('.pg-node--just').count()) === 0)
  // 退回到“上次还没看到最后一道”的状态。
  await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem('pg.path.seen.v1'))
    for (const key of Object.keys(map)) map[key] = map[key].slice(0, -1)
    localStorage.setItem('pg.path.seen.v1', JSON.stringify(map))
  })
  await goto(page, HOME)
  await visible(page, 'home-path')
  check('刚完成：盖章动画', (await page.locator('.pg-node--just').count()) === 1)
  check('刚完成：金色路段画过去', (await page.locator('.pg-pathmap__draw').count()) >= 1)
  check('小方先站在刚完成的节点，气泡稍后出来', (await page.getByTestId('home-continue').count()) === 0)
  await visible(page, 'home-continue')
  check('动画结束：继续按钮出来', await page.getByTestId('home-continue').isVisible())
  await goto(page, HOME)
  await visible(page, 'home-continue')
  check('再回来不重播', (await page.locator('.pg-node--just').count()) === 0)
  await context.close()
})

await scenario('真实接口：开始题目和老师布置', async () => {
  const { context, page } = await newPage()
  const calls = await routeApi(page, {
    'GET /student/path': () => jsonResponse(PATH),
    'POST /student/path/items/p2/start': () => jsonResponse({ state: attemptState('attempt-p2') }),
  })
  await goto(page, REAL)
  await visible(page, 'home-path')
  check('当前节点是第一道没做的', (await node(page, '[data-current="true"]').getAttribute('data-problem-id')) === 'p2')
  check('软锁节点显示锁', (await node(page, '[data-problem-id="p3"]').getAttribute('data-visual')) === 'locked')
  check('老师布置置顶，有截止时间', (await page.getByTestId('home-teacher-due').first().innerText()).includes('截止'))
  check('没开放的布置不能点', await page.getByTestId('home-teacher-start-1').evaluate((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'))
  await tap(page, 'home-continue')
  await page.waitForFunction(() => location.href.includes('/pages/practice/index'), null, { timeout: 8000 })
  check('开始走路径接口', calls.some((c) => c.method === 'POST' && c.pathname.endsWith('/student/path/items/p2/start')))
  check('带作答 ID 进做题页', page.url().includes('attemptId=attempt-p2') && page.url().includes('from=path'), page.url())
  await context.close()
})

await scenario('真实接口：开始失败留在弹层', async () => {
  const { context, page } = await newPage()
  await routeApi(page, {
    'GET /student/path': () => jsonResponse(PATH),
    'POST /student/path/items/p2/start': () => apiError(409, 'CONFLICT', '这道题暂时不能开始'),
  })
  await goto(page, REAL)
  await visible(page, 'home-path')
  await node(page, '[data-current="true"]').click()
  await tap(page, 'node-sheet-action')
  await visible(page, 'node-sheet-error')
  check('失败原因写在弹层里，不跳走', (await page.getByTestId('node-sheet-error').innerText()).includes('不能开始') && page.url().includes('/pages/home/index'))
  await context.close()
})

await scenario('空状态和错误', async () => {
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/path': () => jsonResponse({ course: null, units: [], current: null, teacherAssignments: [], chapters: [] }) })
    await goto(page, REAL)
    await visible(page, 'home-empty')
    check('没有课程：说明一下，给去练习区的入口', (await bodyText(page)).includes('路径还在铺设'))
    await tap(page, 'home-empty-action')
    await visible(page, 'practice-zone-page')
    await context.close()
  }
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/path': () => jsonResponse({ ...PATH, current: { ...PATH.current, items: [] } }) })
    await goto(page, REAL)
    await visible(page, 'home-empty-unit')
    check('单元没题：有说明', (await bodyText(page)).includes('这个单元还没有题'))
    await context.close()
  }
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/progress': () => apiError(500, 'INTERNAL', '服务暂时不可用'), 'GET /student/path': () => jsonResponse(PATH) })
    await goto(page, REAL)
    await visible(page, 'home-path')
    check('进度失败只显示占位，路径照常', (await page.getByTestId('home-streak').innerText()).includes('—'))
    await context.close()
  }
})

await scenario('右栏和宽度', async () => {
  for (const width of [320, 390, 768, 1280]) {
    const { context, page } = await newPage({ width, height: width < 1024 ? 900 : 800 })
    await goto(page, HOME)
    await visible(page, 'home-path')
    await page.waitForTimeout(400)
    check(width + ' 宽无横向滚动', await noOverflow(page))
    check(width + ' 宽引导锚点都看得见', (await page.getByTestId('home-daily-goal').first().isVisible()) && (await page.getByTestId('nav-me').first().isVisible()))
    if (width === 1280) {
      await visible(page, 'progress-rail')
      await visible(page, 'rail-week')
      check('桌面右栏：今日目标在右栏里', (await page.locator('[data-testid="progress-rail"] [data-testid="home-daily-goal"]').count()) === 1)
      await tap(page, 'rail-next-badge')
      await visible(page, 'badges-page')
      check('下一枚徽章点进徽章页', page.url().includes('/pages/me/badges'))
    }
    await context.close()
  }
})

await finish()
