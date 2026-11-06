/**
 * 练习区 e2e（pnpm e2e:flows:zone）：筛选、搜索、随机、打开、解题思路的查看门槛（mock）；空/错状态（真实接口拦截）。
 */
import { apiError, bodyText, jsonResponse, noOverflow, routeApi, startE2E, tap, visible } from './e2eKit.mjs'

const { check, newPage, goto, scenario, finish } = await startE2E('flows-zone')
const ZONE = '/pages/practice-zone/index'
const cards = (page) => page.getByTestId('zone-card')
const attrs = (page, name) => cards(page).evaluateAll((els, attr) => els.map((el) => el.getAttribute(attr)), name)

/** 等列表换成这次筛选的结果。 */
async function waitAll(page, attr, value) {
  await page.waitForFunction(
    ([a, v]) => {
      const list = Array.from(document.querySelectorAll('[data-testid="zone-card"]'))
      return list.length > 0 && list.every((el) => el.getAttribute(a) === v)
    },
    [attr, value],
    { timeout: 8000 },
  )
}

await scenario('筛选和搜索', async () => {
  const { context, page } = await newPage()
  await goto(page, ZONE)
  await visible(page, 'zone-list')
  check('默认显示题目和总数', (await page.getByTestId('zone-count').innerText()).includes('30'))
  check('第一页 20 道，有加载更多', (await cards(page).count()) === 20 && (await page.getByTestId('zone-load-more').isVisible()))
  await tap(page, 'zone-load-more')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="zone-card"]').length === 30, null, { timeout: 8000 })
  check('加载更多追加到 30 道', (await cards(page).count()) === 30)

  await tap(page, 'zone-difficulty-hard')
  await waitAll(page, 'data-difficulty', 'hard')
  check('难度筛选：全是挑战', (await attrs(page, 'data-difficulty')).every((v) => v === 'hard'))
  await tap(page, 'zone-status-done')
  await page.waitForTimeout(500)
  const statuses = await attrs(page, 'data-status')
  check('难度 + 状态同时生效', statuses.every((v) => v === 'done'), statuses.join(','))
  await tap(page, 'zone-reset')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="zone-card"]').length === 20, null, { timeout: 8000 })
  check('清除筛选回到全部', (await page.getByTestId('zone-reset').count()) === 0)

  await tap(page, 'zone-chapter')
  await visible(page, 'zone-chapter-sheet')
  const option = page.locator('[data-testid="zone-chapter-option"]').nth(1)
  const chapter = await option.getAttribute('data-chapter')
  await option.click()
  await page.getByTestId('zone-chapter-sheet').waitFor({ state: 'hidden', timeout: 5000 })
  await page.waitForTimeout(500)
  const texts = await cards(page).evaluateAll((els) => els.map((el) => el.innerText))
  check('章节筛选：都是这一章', texts.length > 0 && texts.every((t) => t.includes(chapter)), chapter)
  await page.reload({ waitUntil: 'networkidle' })
  await visible(page, 'zone-list')
  check('刷新后筛选还在', (await page.getByTestId('zone-chapter').innerText()).includes(chapter.slice(0, 3)))
  await tap(page, 'zone-reset')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="zone-card"]').length === 20, null, { timeout: 8000 })

  const input = page.getByTestId('zone-search').locator('input')
  await input.fill('莱布尼茨')
  await page.waitForFunction(() => {
    const list = Array.from(document.querySelectorAll('[data-testid="zone-card"]'))
    return list.length > 0 && list.length < 20
  }, null, { timeout: 8000 })
  const hits = await cards(page).evaluateAll((els) => els.map((el) => el.innerText))
  check('搜索：结果都带关键词', hits.every((t) => t.includes('莱布尼茨')), String(hits.length))
  await input.fill('没有这样的题目xyz')
  await visible(page, 'zone-empty')
  check('搜不到：说明一下，给清除入口', (await bodyText(page)).includes('这里没有符合条件的题'))
  await tap(page, 'zone-empty-clear')
  await visible(page, 'zone-list')
  check('清除后输入框也空了', (await input.inputValue()) === '')
  await context.close()
})

await scenario('随机和打开', async () => {
  const { context, page } = await newPage()
  await goto(page, ZONE)
  await visible(page, 'zone-list')
  await tap(page, 'zone-difficulty-hard')
  await waitAll(page, 'data-difficulty', 'hard')
  await tap(page, 'zone-random')
  await visible(page, 'zone-sheet')
  check('随机一道打开弹层，有换一道', (await page.getByTestId('zone-sheet-title').isVisible()) && (await page.getByTestId('zone-sheet-reroll').isVisible()))
  check('随机尊重筛选（挑战）', (await page.getByTestId('zone-sheet').innerText()).includes('挑战'))
  await tap(page, 'zone-sheet-reroll')
  await page.waitForTimeout(400)
  check('换一道后弹层还在', await page.getByTestId('zone-sheet').isVisible())
  await tap(page, 'zone-sheet-action')
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
  check('开始后进入做题页', page.url().includes('/pages/practice/index') && page.url().includes('from=zone'), page.url())
  await context.close()
})

await scenario('已做完：回看去详情', async () => {
  const { context, page } = await newPage()
  await goto(page, ZONE)
  await visible(page, 'zone-list')
  await page.locator('[data-testid="zone-card"][data-status="done"]').first().click()
  await visible(page, 'zone-sheet')
  await tap(page, 'zone-sheet-action')
  await visible(page, 'proof-detail-page')
  check('做完的题打开证明详情', page.url().includes('/pages/proof-detail/index'))
  await context.close()
})

await scenario('解题思路的门槛', async () => {
  const { context, page } = await newPage()
  await goto(page, ZONE)
  await visible(page, 'zone-list')

  // 没开始：只说先开始
  await page.locator('[data-testid="zone-card"][data-status="todo"]').first().click()
  await visible(page, 'zone-sheet')
  await tap(page, 'zone-sheet-solution')
  await visible(page, 'solution-locked')
  check('没开始不能看', (await page.getByTestId('solution-approach').count()) === 0 && (await page.getByTestId('solution-full').count()) === 0)
  await page.keyboard.press('Escape')
  await page.getByTestId('solution-sheet').waitFor({ state: 'hidden', timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.getByTestId('zone-sheet').waitFor({ state: 'hidden', timeout: 5000 })

  // 进行中：先提醒，再思路，再确认才给完整证明
  await page.locator('[data-testid="zone-card"][data-status="active"]').first().click()
  await visible(page, 'zone-sheet')
  await tap(page, 'zone-sheet-solution')
  await visible(page, 'solution-offer')
  check('进行中：先看到代价说明，内容不在页面上', (await page.getByTestId('solution-offer').innerText()).includes('经验') && (await page.getByTestId('solution-approach').count()) === 0)
  await tap(page, 'solution-reveal-approach')
  await visible(page, 'solution-approach')
  check('看思路后有思路和关键想法，还没有完整证明', (await page.getByTestId('solution-keyideas').isVisible()) && (await page.getByTestId('solution-full').count()) === 0)
  await tap(page, 'solution-reveal-full')
  await visible(page, 'solution-confirm')
  check('完整证明要再确认一次', (await page.getByTestId('solution-full').count()) === 0)
  await tap(page, 'solution-confirm-cancel')
  await page.getByTestId('solution-confirm').waitFor({ state: 'hidden', timeout: 5000 })
  check('取消就不给', (await page.getByTestId('solution-full').count()) === 0)
  await tap(page, 'solution-reveal-full')
  await tap(page, 'solution-confirm-go')
  await visible(page, 'solution-full')
  check('确认后显示完整证明', (await page.getByTestId('solution-full').innerText()).length > 0)
  await page.keyboard.press('Escape')
  await page.getByTestId('solution-sheet').waitFor({ state: 'hidden', timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.getByTestId('zone-sheet').waitFor({ state: 'hidden', timeout: 5000 })

  // 做完了：直接看，没有提醒
  await page.locator('[data-testid="zone-card"][data-status="done"]').first().click()
  await visible(page, 'zone-sheet')
  await tap(page, 'zone-sheet-solution')
  await visible(page, 'solution-full')
  check('做完后免费看，不再提醒', (await page.getByTestId('solution-offer').count()) === 0)
  await context.close()
})

await scenario('真实接口：查看被拒不假装成功', async () => {
  const { context, page } = await newPage()
  const practiceItem = { problemId: 'p1', title: '题一', stemPreview: '证明题一', chapter: '第一章', difficulty: 'easy', tags: [], status: 'active', attemptId: 'a1', keyCount: 2, autoImported: false }
  await routeApi(page, {
    'GET /student/practice': () => jsonResponse({ items: [practiceItem], facets: { chapters: [{ chapter: '第一章', total: 1, done: 0 }], difficulty: { easy: 1, medium: 0, hard: 0 } }, nextCursor: null }),
    'GET /student/practice/p1/solution': () => jsonResponse({ level: 'none', canReveal: true, hasApproach: true, hasFull: true }),
    'POST /student/practice/p1/solution/reveal': () => apiError(403, 'FORBIDDEN', '这道题现在不能查看'),
  })
  await goto(page, ZONE + '?api=real')
  await visible(page, 'zone-list')
  await cards(page).first().click()
  await tap(page, 'zone-sheet-solution')
  await tap(page, 'solution-reveal-approach')
  await visible(page, 'solution-reveal-error')
  check('拒绝的原因写出来，内容没出现', (await page.getByTestId('solution-reveal-error').innerText()).includes('不能查看') && (await page.getByTestId('solution-approach').count()) === 0)
  await context.close()
})

await scenario('空状态、错误和宽度', async () => {
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/practice': () => jsonResponse({ items: [], facets: { chapters: [], difficulty: { easy: 0, medium: 0, hard: 0 } }, nextCursor: null }) })
    await goto(page, ZONE + '?api=real')
    await visible(page, 'zone-empty')
    check('题库没题：不说“筛选不到”', (await bodyText(page)).includes('题库还在准备'))
    await context.close()
  }
  {
    const { context, page } = await newPage()
    let n = 0
    const list = { items: [{ problemId: 'p1', title: '题一', stemPreview: '证明题一', chapter: '第一章', difficulty: 'easy', tags: [], status: 'todo', attemptId: null, keyCount: 2, autoImported: false }], facets: { chapters: [], difficulty: { easy: 1, medium: 0, hard: 0 } }, nextCursor: null }
    await routeApi(page, { 'GET /student/practice': () => (++n <= 2 ? apiError(500, 'INTERNAL', '服务暂时不可用') : jsonResponse(list)) })
    await goto(page, ZONE + '?api=real')
    await visible(page, 'zone-error')
    check('加载失败显示错误', (await page.getByTestId('zone-error').innerText()).includes('题目没加载出来'))
    await tap(page, 'zone-retry')
    await visible(page, 'zone-list')
    check('重试后恢复', (await cards(page).count()) === 1)
    await context.close()
  }
  for (const width of [320, 390, 768, 1280]) {
    const { context, page } = await newPage({ width, height: 900 })
    await goto(page, ZONE)
    await visible(page, 'zone-list')
    check(width + ' 宽无横向滚动', await noOverflow(page))
    await context.close()
  }
})

await finish()
