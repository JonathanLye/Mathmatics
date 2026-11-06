/**
 * 证明本、证明详情、错题 e2e（pnpm e2e:flows:notebook）。
 * 覆盖：卡片打开详情、真实讲评、讲评没发布/出错、打印样式、稍后重做、错题分组和重做、空/错状态、宽度。
 */
import { apiError, bodyText, jsonResponse, noOverflow, routeApi, startE2E, tap, visible } from './e2eKit.mjs'

const { check, newPage, goto, scenario, finish } = await startE2E('flows-notebook')
const BOOK = '/pages/proofbook/index'
const MISTAKES = '/pages/mistakes/index'
const detail = (id) => '/pages/proof-detail/index?attemptId=' + id + '&api=real'
const CARD = {
  attemptId: 'a1',
  title: '题一',
  chapter: '第二章 数列极限',
  completedAt: '2026-11-01T08:00:00.000Z',
  independence: 0.5,
  keysTotal: 4,
  lines: [
    { n: 1, statement: '任取 $\\varepsilon>0$。', justification: '定义' },
    { n: 2, statement: '取 $N=1$。' },
  ],
  summary: ['先放大再倒推。'],
  definition: '$\\forall\\varepsilon>0$',
  weakPoints: ['注意 $N$ 不依赖 $n$'],
  reviewPublished: false,
}
const notebook = (cards) => () => jsonResponse({ cards })

await scenario('证明本打开详情（mock）', async () => {
  const { context, page } = await newPage()
  await goto(page, BOOK)
  await visible(page, 'notebook-card')
  check('有证明卡片和总数', (await page.getByTestId('notebook-card').count()) >= 3 && (await page.getByTestId('notebook-count').innerText()).includes('份证明'))
  check('讲评已发布有标记', (await page.getByTestId('notebook-review-tag').count()) >= 1)
  await page.getByTestId('notebook-open').first().click()
  await visible(page, 'proof-detail-page')
  await visible(page, 'proof-detail-lines')
  check('详情显示证明行和总结', (await page.getByTestId('proof-line').count()) >= 1 && (await page.getByTestId('proof-detail-summary').isVisible()))
  // 讲评是证明行之后单独请求的，要等它回来。
  await visible(page, 'proof-detail-note')
  check('详情显示讲评', await page.getByTestId('proof-detail-note').isVisible())
  check('详情有诚实说明', (await bodyText(page)).includes('系统核对关键步骤是否齐全'))
  await tap(page, 'proof-detail-back')
  await visible(page, 'notebook-card')
  check('返回证明本', page.url().includes('/pages/proofbook/index'))
  await page.getByTestId('notebook-card').nth(1).click()
  await visible(page, 'proof-detail-page')
  check('整张卡片都能点', page.url().includes('/pages/proof-detail/index'))
  await context.close()
})

await scenario('稍后重做', async () => {
  const { context, page } = await newPage()
  await goto(page, BOOK)
  await visible(page, 'redo-list')
  check('有重做列表和原因', (await page.getByTestId('redo-item-0').innerText()).includes('老师/系统标记'))
  await tap(page, 'redo-start-0')
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
  check('开始重做进做题页', page.url().includes('from=redo'), page.url())
  await context.close()
})

await scenario('重做失败不跳走', async () => {
  const { context, page } = await newPage()
  const recentlyNot = { ...CARD, completedAt: '2020-01-01T00:00:00.000Z', independence: 0, redoRecommended: true, problemId: 'p1' }
  await routeApi(page, {
    'GET /student/notebook': notebook([recentlyNot]),
    'POST /attempts/a1/redo': () => apiError(409, 'CONFLICT', '这道题正在进行中'),
  })
  await goto(page, BOOK + '?api=real')
  await visible(page, 'redo-start-0')
  await tap(page, 'redo-start-0')
  await page.waitForTimeout(800)
  check('失败留在证明本', page.url().includes('/pages/proofbook/index'))
  await context.close()
})

await scenario('证明本的空状态和错误', async () => {
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/notebook': notebook([]) })
    await goto(page, BOOK + '?api=real')
    await visible(page, 'notebook-empty')
    await tap(page, 'notebook-to-path')
    await visible(page, 'home-page')
    check('空证明本有去写第一道的入口', page.url().includes('/pages/home/index'))
    await context.close()
  }
  {
    const { context, page } = await newPage()
    let n = 0
    await routeApi(page, { 'GET /student/notebook': () => (++n === 1 ? apiError(500, 'INTERNAL', '服务暂时不可用') : jsonResponse({ cards: [CARD] })) })
    await goto(page, BOOK + '?api=real')
    await visible(page, 'notebook-error')
    check('加载失败不是永远转圈', (await page.getByTestId('notebook-loading').count()) === 0)
    await tap(page, 'notebook-retry')
    await visible(page, 'notebook-card')
    check('重试恢复', true)
    await context.close()
  }
})

await scenario('详情：讲评来自接口', async () => {
  {
    const { context, page } = await newPage()
    const calls = await routeApi(page, {
      'GET /student/notebook': notebook([CARD]),
      'GET /attempts/a1/review': () => jsonResponse({ proofs: ['参考证明正文'], note: '讲评正文' }),
    })
    await goto(page, detail('a1'))
    await visible(page, 'proof-detail-note')
    check('讲评显示接口内容', (await page.getByTestId('proof-detail-note').innerText()).includes('讲评正文'))
    check('参考证明显示', (await page.getByTestId('proof-detail-reference').innerText()).includes('参考证明正文'))
    check('调了 getAttemptReview', calls.some((c) => c.pathname.endsWith('/attempts/a1/review')))
    check('行号、依据、定义、下次注意都在', (await page.getByTestId('proof-line').count()) === 2 && (await page.getByTestId('proof-detail-lines').innerText()).includes('依据') && (await page.getByTestId('proof-detail-definition').isVisible()) && (await page.getByTestId('proof-detail-weak').isVisible()))
    await context.close()
  }
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/notebook': notebook([CARD]), 'GET /attempts/a1/review': () => apiError(403, 'FORBIDDEN', '讲评现在还不能看') })
    await goto(page, detail('a1'))
    await visible(page, 'proof-detail-review-pending')
    check('没发布：说发布后会出现，不当错误', (await page.getByTestId('proof-detail-review-error').count()) === 0)
    await context.close()
  }
  {
    const { context, page } = await newPage()
    let n = 0
    await routeApi(page, {
      'GET /student/notebook': notebook([CARD]),
      'GET /attempts/a1/review': () => (++n <= 2 ? apiError(500, 'INTERNAL', '服务暂时不可用') : jsonResponse({ proofs: [], note: '讲评正文' })),
    })
    await goto(page, detail('a1'))
    await visible(page, 'proof-detail-review-error')
    check('接口出错：不假装没发布', (await page.getByTestId('proof-detail-review-pending').count()) === 0)
    await tap(page, 'proof-detail-review-retry')
    await visible(page, 'proof-detail-note')
    check('重试后显示讲评', true)
    await context.close()
  }
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/notebook': notebook([CARD]) })
    await goto(page, detail('nope'))
    await visible(page, 'proof-detail-notfound')
    check('找不到：说明一下，能回证明本', await page.getByTestId('proof-detail-to-book').isVisible())
    await context.close()
  }
  {
    const { context, page } = await newPage()
    let n = 0
    await routeApi(page, {
      'GET /student/notebook': () => (++n === 1 ? apiError(500, 'INTERNAL', '服务暂时不可用') : jsonResponse({ cards: [CARD] })),
      'GET /attempts/a1/review': () => apiError(403, 'FORBIDDEN', 'no'),
    })
    await goto(page, detail('a1'))
    await visible(page, 'proof-detail-error')
    await tap(page, 'proof-detail-retry')
    await visible(page, 'proof-detail-lines')
    check('详情加载失败能重试', true)
    await context.close()
  }
})

await scenario('打印', async () => {
  const { context, page } = await newPage({ width: 1280, height: 800, colorScheme: 'dark' })
  await routeApi(page, { 'GET /student/notebook': notebook([CARD]), 'GET /attempts/a1/review': () => jsonResponse({ proofs: [], note: '讲评正文' }) })
  await goto(page, detail('a1'))
  await visible(page, 'proof-detail-note')
  await page.evaluate(() => {
    window.__printed = 0
    window.print = () => { window.__printed += 1 }
  })
  await tap(page, 'proof-detail-print')
  check('点打印调用浏览器打印', (await page.evaluate(() => window.__printed)) === 1)
  await page.emulateMedia({ media: 'print' })
  const printed = await page.evaluate(() => {
    const gone = (selector) => {
      const el = document.querySelector(selector)
      return !el || getComputedStyle(el).display === 'none'
    }
    return {
      nav: gone('.pg-tabbar'),
      rail: gone('.pg-shell__rail'),
      bar: gone('.pg-detail__bar'),
      paper: getComputedStyle(document.querySelector('.pg-detail__sheet')).backgroundColor,
      ink: getComputedStyle(document.querySelector('.pg-detail__title')).color,
    }
  })
  check('打印时隐藏导航、右栏和按钮', printed.nav && printed.rail && printed.bar, JSON.stringify(printed))
  check('打印总是白纸黑字', printed.paper === 'rgb(255, 255, 255)' && printed.ink === 'rgb(0, 0, 0)', JSON.stringify(printed))
  await context.close()
})

await scenario('错题（mock）', async () => {
  const { context, page } = await newPage()
  await goto(page, MISTAKES)
  await visible(page, 'mistake-item')
  check('按卡点分组', (await page.getByTestId('mistake-group').count()) >= 2)
  const first = await page.getByTestId('mistake-item').first().innerText()
  check('有题目、你写的、一句提问', first.includes('你写的') && first.includes('想一想') && first.includes('？'))
  const red = await page.getByTestId('mistake-item').first().evaluate((el) => /rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/.test(getComputedStyle(el.querySelector('.pg-mistake__linetext')).color))
  check('学生写的行不标红', !red)
  const disabled = await page.getByTestId('mistake-redo').evaluateAll((els) => els.filter((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true').length)
  check('不能重做的按钮禁用，并说明', disabled >= 1 && (await bodyText(page)).includes('测验结束后可以重做'))
  await page.getByTestId('mistake-redo').first().click()
  await page.waitForSelector('.pg-practice', { state: 'visible', timeout: 12000 })
  check('重做进做题页', page.url().includes('from=mistakes'), page.url())
  await context.close()
})

await scenario('错题：筛选、空状态、错误、重做失败', async () => {
  const item = (id, chapter, canRedo = true) => ({ id, group: 'scaling', problemTitle: '题 ' + id, chapter, attemptId: 'att-' + id, lineExcerpt: '取 $N=1$', note: '$N$ 能依赖 $n$ 吗？', createdAt: '2026-11-01T08:00:00.000Z', canRedo })
  const view = { groups: [{ group: 'scaling', title: '放缩卡住', count: 2, items: [item('m1', '第二章'), item('m2', '第三章')] }], total: 2 }
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/mistakes': () => jsonResponse(view), 'POST /attempts/att-m1/redo': () => apiError(409, 'CONFLICT', '这道题正在进行中') })
    await goto(page, MISTAKES + '?api=real&chapter=' + encodeURIComponent('第二章'))
    await visible(page, 'mistakes-filter')
    check('带章节进来只看这一章', (await page.getByTestId('mistake-item').count()) === 1)
    await page.getByTestId('mistake-redo').first().click()
    await page.getByText('这道题正在进行中').first().waitFor({ state: 'visible', timeout: 5000 })
    check('重做失败：提示原因，不跳走', page.url().includes('/pages/mistakes/index'))
    await tap(page, 'mistakes-filter-clear')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mistake-item"]').length === 2, null, { timeout: 5000 })
    check('看全部', (await page.getByTestId('mistakes-filter').count()) === 0)
    await context.close()
  }
  {
    const { context, page } = await newPage()
    await routeApi(page, { 'GET /student/mistakes': () => jsonResponse({ groups: [], total: 0 }) })
    await goto(page, MISTAKES + '?api=real')
    await visible(page, 'mistakes-empty')
    check('没有错题：指向路径', (await bodyText(page)).includes('还没有错题，去路径上挑一道'))
    await tap(page, 'mistakes-to-path')
    await visible(page, 'home-page')
    await context.close()
  }
  {
    const { context, page } = await newPage()
    let n = 0
    await routeApi(page, { 'GET /student/mistakes': () => (++n === 1 ? apiError(500, 'INTERNAL', '服务暂时不可用') : jsonResponse(view)) })
    await goto(page, MISTAKES + '?api=real')
    await visible(page, 'mistakes-error')
    await tap(page, 'mistakes-retry')
    await visible(page, 'mistake-item')
    check('错题加载失败能重试', true)
    await context.close()
  }
})

await scenario('宽度', async () => {
  for (const route of [BOOK, MISTAKES, '/pages/proof-detail/index?attemptId=11111111-1111-4111-8111-111111111111']) {
    for (const width of [320, 390, 768, 1280]) {
      const { context, page } = await newPage({ width, height: 900 })
      await goto(page, route)
      await page.waitForTimeout(300)
      check(route.split('?')[0] + ' ' + width + ' 宽无横向滚动', await noOverflow(page))
      await context.close()
    }
  }
})

await finish()
