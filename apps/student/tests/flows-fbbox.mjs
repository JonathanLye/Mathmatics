/**
 * 小方信箱 e2e（pnpm e2e:flows:fbbox）：全站悬浮入口、反馈弹层、探针上下文、信箱列表与对话、红色捉虫奖章的庆祝。
 * 接口都拦截成真实形状；PG_SHOTS_DIR 指到某个目录就顺手截图（给「好看、可爱」的人工验收用）。
 */
import { SETTINGS, jsonResponse, apiError, noOverflow, routeApi, startE2E, tap, visible } from './e2eKit.mjs'

const { check, newPage, goto, scenario, finish } = await startE2E('flows-fbbox')
const SHOTS = process.env.PG_SHOTS_DIR || ''
const shot = async (page, name) => {
  if (!SHOTS) return
  await page.waitForTimeout(700) // 等入场动画停稳再拍
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}
const posted = (calls, method, suffix) => calls.filter((c) => c.method === method && c.pathname.endsWith(suffix)).map((c) => JSON.parse(c.postData || '{}'))

const ID_WAIT = '00000000-0000-4000-8000-0000000000a1'
const ID_BUG = '00000000-0000-4000-8000-0000000000a2'
const ID_DONE = '00000000-0000-4000-8000-0000000000a3'
const at = (min) => new Date(Date.now() - min * 60_000).toISOString()

function fixtures() {
  const state = {
    [ID_WAIT]: { id: ID_WAIT, refNo: 7, kind: 'bug', status: 'need_info', confirmed: false, unread: true, createdAt: at(180), lastActivityAt: at(20), event: null, messages: [{ id: ID_WAIT, from: 'me', body: '做第 3 步的时候，分数线打不出来。', createdAt: at(180) }, { id: 'd1', from: 'dev', body: '收到啦！你是用手写还是键盘？用的什么手机？', createdAt: at(20) }] },
    [ID_BUG]: { id: ID_BUG, refNo: 8, kind: 'bug', status: 'open', confirmed: true, unread: true, createdAt: at(1560), lastActivityAt: at(120), event: 'confirmed', messages: [{ id: ID_BUG, from: 'me', body: '点「求助」之后页面卡住了。', createdAt: at(1560) }, { id: 'd2', from: 'dev', body: '我们复现了这个问题，正在处理。谢谢你帮小方抓到它！', createdAt: at(120) }] },
    [ID_DONE]: { id: ID_DONE, refNo: 9, kind: 'idea', status: 'closed', closeReason: 'wontfix', confirmed: false, unread: false, createdAt: at(4000), lastActivityAt: at(3000), event: null, messages: [{ id: ID_DONE, from: 'me', body: '希望可以换头像。', createdAt: at(4000) }, { id: 'd3', from: 'dev', body: '这个想法很好，先记下了，暂时排不上。', createdAt: at(3000) }] },
  }
  const listBody = () => ({
    items: Object.values(state)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((r) => ({ id: r.id, refNo: r.refNo, kind: r.kind, status: r.status, closeReason: r.closeReason ?? null, preview: r.messages[0].body, lastReply: r.messages.filter((m) => m.from === 'dev').at(-1)?.body ?? null, confirmed: r.confirmed, unread: r.unread, createdAt: r.createdAt, lastActivityAt: r.lastActivityAt })),
    unread: Object.values(state).filter((r) => r.unread).length,
  })
  const handlers = { 'GET /student/feedback': () => jsonResponse(listBody()) }
  for (const id of Object.keys(state)) {
    handlers[`GET /student/feedback/${id}`] = () => {
      const r = state[id]
      const out = { id: r.id, refNo: r.refNo, kind: r.kind, status: r.status, closeReason: r.closeReason ?? null, confirmed: r.confirmed, event: r.event, createdAt: r.createdAt, messages: r.messages }
      r.unread = false
      r.event = null
      return jsonResponse(out)
    }
    handlers[`POST /student/feedback/${id}/messages`] = (request) => {
      const r = state[id]
      if (r.status === 'closed') return apiError(409, 'FEEDBACK_CLOSED', '这条反馈已经关闭了，可以再写一条新的')
      const message = { id: 'm' + r.messages.length, from: 'me', body: request.postDataJSON().body, createdAt: new Date().toISOString() }
      r.messages.push(message)
      if (r.status === 'need_info') r.status = 'open'
      return jsonResponse(message, 201)
    }
  }
  handlers['POST /student/feedback'] = () => jsonResponse({ id: '00000000-0000-4000-8000-0000000000b1', refNo: 42 }, 201)
  return { state, handlers }
}

await scenario('悬浮入口、红点与反馈弹层', async () => {
  const { context, page } = await newPage()
  const { handlers } = fixtures()
  const calls = await routeApi(page, handlers)
  await goto(page, '/pages/me/index?api=real')
  await visible(page, 'fbbox-fab')
  check('我的页有小方入口', (await page.getByTestId('fbbox-fab').count()) === 1)
  await visible(page, 'fbbox-hint')
  check('第一次出现有一句提示', (await page.getByTestId('fbbox-hint').innerText()).includes('点小方告诉我们'))
  await page.waitForFunction(() => document.querySelector('[data-testid="fbbox-dot"]')?.innerText?.trim() === '2', null, { timeout: 8000 })
  check('入口上的数字点是信箱里的未读数', (await page.getByTestId('fbbox-dot').innerText()).trim() === '2')
  check('「我的」标签上也有点', await page.getByTestId('tab-me-dot').first().isVisible())
  const dotColor = await page.getByTestId('fbbox-dot').evaluate((el) => getComputedStyle(el).backgroundColor)
  check('小圆点用金色 --bee，不用红', dotColor === 'rgb(255, 194, 51)', dotColor)
  await shot(page, '01-fab-me-mobile')

  await tap(page, 'fbbox-fab')
  await visible(page, 'fbbox-sheet')
  check('点小方打开弹层，提示条收起', !(await page.getByTestId('fbbox-hint').isVisible().catch(() => false)))
  check('「会带上」写明这一页', (await page.getByTestId('fbbox-with').innerText()).includes('这一页'))
  await tap(page, 'fbbox-send')
  await visible(page, 'fbbox-error')
  check('空内容不发', posted(calls, 'POST', '/student/feedback').length === 0)
  await tap(page, 'fbbox-kind-content')
  await page.getByTestId('fbbox-tag').filter({ hasText: '题目写错了' }).click()
  await page.getByTestId('fbbox-tag').filter({ hasText: '答案有问题' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="fbbox-body"] textarea')?.value.includes('答案有问题'), null, { timeout: 5000 })
  const typed = await page.getByTestId('fbbox-body').locator('textarea').inputValue()
  check('点快捷话直接填进输入框', typed === '题目写错了，答案有问题', typed || '(空)')
  await shot(page, '02-sheet-filled-mobile')
  await tap(page, 'fbbox-send')
  await visible(page, 'fbbox-receipt')
  check('回执带编号 #0042', (await page.getByTestId('fbbox-receipt').innerText()).includes('#0042'))
  await shot(page, '03-sheet-received-mobile')
  const body = posted(calls, 'POST', '/student/feedback').at(-1)
  check('请求体：类型、内容、页面位置', body.kind === 'content' && body.body === '题目写错了，答案有问题' && body.page === '/pages/me/index' && body.context?.pageName === '我的', JSON.stringify(body))
  check('不带设备和错误（扩展采集默认关）', body.context?.env === undefined && body.context?.errors === undefined && body.context?.breadcrumbs === undefined)
  const sent = calls.filter((c) => c.method === 'POST' && c.pathname.endsWith('/student/feedback')).at(-1)
  check('请求带 X-Request-Id', /^[\w-]{8,}$/.test(sent?.headers?.['x-request-id'] ?? ''), sent?.headers?.['x-request-id'])
  await tap(page, 'fbbox-to-inbox')
  await visible(page, 'inbox-page')
  check('「去看看」到信箱', (await page.evaluate(() => location.hash + location.pathname)).includes('inbox'))
  await context.close()
})

await scenario('关掉「带上这些」只送学生的话', async () => {
  const { context, page } = await newPage()
  const { handlers } = fixtures()
  const calls = await routeApi(page, handlers)
  await goto(page, '/pages/me/index?api=real')
  await tap(page, 'fbbox-fab')
  await visible(page, 'fbbox-sheet')
  await tap(page, 'fbbox-attach')
  check('关掉后提示只带你写的话', (await page.getByTestId('fbbox-with').innerText()).includes('只带上你写的话'))
  await page.getByTestId('fbbox-body').locator('textarea').fill('只说一句')
  await tap(page, 'fbbox-send')
  await visible(page, 'fbbox-receipt')
  const body = posted(calls, 'POST', '/student/feedback').at(-1)
  check('请求体里没有 context', body.context === undefined && body.page === undefined, JSON.stringify(body))
  await context.close()
})

await scenario('没有入口的页面', async () => {
  const { context, page } = await newPage()
  const { handlers } = fixtures()
  await routeApi(page, handlers)
  for (const route of ['/pages/login/index', '/pages/privacy-policy/index']) {
    await goto(page, route + '?api=real')
    await page.waitForTimeout(600)
    check(route + ' 没有小方入口', (await page.getByTestId('fbbox-fab').count()) === 0)
  }
  await context.close()
})

await scenario('信箱：列表、对话、追加回复', async () => {
  const { context, page } = await newPage()
  const { handlers } = fixtures()
  const calls = await routeApi(page, handlers)
  await goto(page, '/pages/me/inbox?api=real')
  await visible(page, 'inbox-list')
  check('三条反馈', (await page.getByTestId('inbox-item').count()) === 3)
  check('两条未读，有金色小点', (await page.getByTestId('inbox-unread-dot').count()) === 2)
  const first = await page.getByTestId('inbox-item').first().innerText()
  check('最近有动静的在最前，状态和开发者回复可见', first.includes('想问问你') && first.includes('小方 & 开发组'), first)
  await shot(page, '04-inbox-list-mobile')

  await page.getByTestId('inbox-item').first().click()
  await visible(page, 'inbox-messages')
  check('想问问你：顶部提示请补充', await page.getByTestId('inbox-needinfo').isVisible())
  check('对话：我的在右、开发者在左', (await page.locator('[data-from="me"]').count()) === 1 && (await page.locator('[data-from="dev"]').count()) === 1)
  await shot(page, '05-thread-needinfo-mobile')
  await tap(page, 'inbox-reply-send')
  await visible(page, 'inbox-reply-error')
  check('空回复不发', posted(calls, 'POST', '/messages').length === 0)
  await page.getByTestId('inbox-reply').locator('textarea').fill('用的 iPhone 13，手写')
  await tap(page, 'inbox-reply-send')
  await page.waitForFunction(() => document.querySelectorAll('[data-from="me"]').length === 2, null, { timeout: 8000 })
  check('回复发出后进对话，状态回到正在看', (await page.getByTestId('inbox-status').innerText()).includes('正在看'))
  check('请求体就是回复内容', posted(calls, 'POST', '/messages').at(-1)?.body === '用的 iPhone 13，手写')

  await tap(page, 'inbox-thread-back')
  await visible(page, 'inbox-list')
  await context.close()
})

await scenario('被确认复现：红色奖章庆祝只播一次', async () => {
  const { context, page } = await newPage()
  const { handlers } = fixtures()
  await routeApi(page, handlers)
  await goto(page, `/pages/me/inbox?api=real&id=00000000-0000-4000-8000-0000000000a2`)
  await visible(page, 'inbox-medal')
  const medalColor = await page.getByTestId('inbox-medal').evaluate((el) => getComputedStyle(el).backgroundColor)
  check('奖章是红色（--danger-face）', medalColor === 'rgb(196, 50, 58)', medalColor)
  check('庆祝文案', (await page.getByTestId('celebration').innerText()).includes('抓到虫啦'))
  await page.waitForTimeout(900)
  await shot(page, '06-celebrate-confirmed-mobile')
  await tap(page, 'celebration-close')
  await page.getByTestId('celebration').waitFor({ state: 'hidden', timeout: 5000 })
  check('已确认复现的标签在对话页', await page.getByTestId('inbox-confirmed').isVisible())
  await tap(page, 'inbox-thread-back')
  await visible(page, 'inbox-list')
  await page.getByTestId('inbox-item').first().click()
  await page.waitForTimeout(500)
  check('再次打开不再庆祝', (await page.getByTestId('inbox-medal').count()) === 0)
  await context.close()
})

await scenario('已关闭的反馈不能再回复', async () => {
  const { context, page } = await newPage()
  const { handlers } = fixtures()
  await routeApi(page, handlers)
  await goto(page, `/pages/me/inbox?api=real&id=00000000-0000-4000-8000-0000000000a3`)
  await visible(page, 'inbox-closed')
  check('没有回复框，提示可以写新的', (await page.getByTestId('inbox-reply').count()) === 0 && (await page.getByTestId('inbox-closed').innerText()).includes('再写一条新的'))
  check('关闭原因的说法：先放一放', (await page.getByTestId('inbox-status').innerText()).includes('先放一放'))
  await tap(page, 'inbox-write-new')
  await visible(page, 'fbbox-sheet')
  check('「写一条新的」打开弹层', await page.getByTestId('fbbox-sheet').isVisible())
  await context.close()
})

await scenario('桌面和暗色', async () => {
  for (const [width, height, scheme, tag] of [[1280, 800, 'light', 'desktop'], [390, 844, 'dark', 'dark']]) {
    const { context, page } = await newPage({ width, height, colorScheme: scheme })
    const { handlers } = fixtures()
    await routeApi(page, handlers)
    await goto(page, '/pages/me/index?api=real')
    await visible(page, 'fbbox-fab')
    check(`${tag}：无横向滚动`, await noOverflow(page))
    await shot(page, `07-fab-${tag}`)
    await tap(page, 'fbbox-fab')
    await visible(page, 'fbbox-sheet')
    await page.getByTestId('fbbox-body').locator('textarea').fill('暗色下也要好看')
    await shot(page, `08-sheet-${tag}`)
    await page.keyboard.press('Escape')
    await goto(page, '/pages/me/inbox?api=real')
    await visible(page, 'inbox-list')
    await shot(page, `09-inbox-${tag}`)
    await context.close()
  }
})

void SETTINGS
await finish()
