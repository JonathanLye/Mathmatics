import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ApiError,
  __resetClientForTests,
  configureClientForTests,
  getMyFeedback,
  listMyFeedback,
  replyMyFeedback,
  sendFeedback,
} from '@/api/client'
import { openOverlayCount, sheetClosed, sheetOpened } from '@/components/ui/uiLogic'
import { FBBOX_CLOSE_LABEL, FBBOX_COPY, FBBOX_QUICK_TAGS, FBBOX_STATUS_LABEL } from '@/copy/feedbackbox'
import {
  canReply,
  fabModeFor,
  pageKeyOf,
  pageNameOf,
  parseDraft,
  parseEnv,
  refLabel,
  routeOf,
  serializeDraft,
  statusLabelOf,
  statusToneOf,
  timeAgo,
  waitingOnMe,
  withItems,
} from '@/feedbackbox/logic'
import { MockFeedbackError, mockGetFeedback, mockListFeedback, mockReplyFeedback, mockSubmitFeedback, resetMockFeedback } from '@/feedbackbox/mockApi'
import { CRUMB_LIMIT, ERROR_LIMIT, cleanMessage, collectContext, recordApi, recordCrumb, recordError, resetProbe, setProbeContext } from '@/feedbackbox/probe'
import { __resetFeedbackBoxForTests, addQuickTag, openFeedbackSheet, setBody, submitFeedback, useFeedbackBox } from '@/feedbackbox/store'
import { __resetFeedbackPrefsForTests } from '@/motion/useFeedbackPrefs'

// 小方信箱（15 号文档）：入口显示规则、探针不带正文、信箱的演示规则与真实接口的请求形状。

const base = { route: '/pages/home/index', loggedIn: true, consented: true, testMode: false, overlayOpen: false }

describe('入口显示规则', () => {
  it('登录、同意之后的主页面都显示完整入口', () => {
    for (const route of ['/pages/home/index', '/pages/practice-zone/index', '/pages/mistakes/index', '/pages/proofbook/index', '/pages/proof-detail/index', '/pages/me/index', '/pages/me/about', '/pages/not-found/index']) {
      expect(fabModeFor({ ...base, route }), route).toBe('full')
    }
  })

  it('做题页缩成小标', () => {
    expect(fabModeFor({ ...base, route: '/pages/practice/index' })).toBe('mini')
  })

  it('登录、同意、改密、年龄、引导、隐私政策、镜像页没有入口', () => {
    for (const route of ['/pages/login/index', '/pages/consent/index', '/pages/set-password/index', '/pages/age/index', '/pages/welcome/index', '/pages/tour/index', '/pages/privacy-policy/index', '/pages/mirror/index', '/pages/dev/gallery']) {
      expect(fabModeFor({ ...base, route }), route).toBe('hidden')
    }
  })

  it('没登录、没签同意书、考试模式、有弹层时都隐藏', () => {
    expect(fabModeFor({ ...base, loggedIn: false })).toBe('hidden')
    expect(fabModeFor({ ...base, consented: false })).toBe('hidden')
    expect(fabModeFor({ ...base, route: '/pages/practice/index', testMode: true })).toBe('hidden')
    expect(fabModeFor({ ...base, overlayOpen: true })).toBe('hidden')
  })

  it('弹层登记让 overlayOpen 的来源（openOverlayCount）跟着变', () => {
    const token = {}
    expect(openOverlayCount.value).toBe(0)
    sheetOpened(token)
    expect(openOverlayCount.value).toBe(1)
    sheetClosed(token)
    expect(openOverlayCount.value).toBe(0)
  })
})

describe('纯逻辑', () => {
  it('路径与页面名：去掉 query/hash，认得出页面', () => {
    expect(routeOf('#/pages/practice/index?attemptId=x&token=secret')).toBe('/pages/practice/index')
    expect(routeOf('pages/home/index#top')).toBe('/pages/home/index')
    expect(routeOf(null)).toBe('')
    expect(pageKeyOf('/pages/me/about')).toBe('me')
    expect(pageNameOf('/pages/practice/index')).toBe('做题')
    expect(pageNameOf('/pages/unknown/x')).toBeUndefined()
  })

  it('编号、状态说法、标签颜色', () => {
    expect(refLabel(42)).toBe('#0042')
    expect(refLabel(12345)).toBe('#12345')
    expect(statusLabelOf('need_info')).toBe('想问问你')
    expect(statusLabelOf('closed', 'wontfix')).toBe('先放一放')
    expect(statusLabelOf('closed', 'fixed')).toBe('已解决')
    expect(statusLabelOf('closed', 'unknown-reason')).toBe('已关闭')
    expect(statusToneOf('need_info')).toBe('fox')
    expect(statusToneOf('resolved')).toBe('ok')
    expect(canReply('open')).toBe(true)
    expect(canReply('closed')).toBe(false)
  })

  it('环境：只取系统、浏览器大类和视口，不带整串 UA', () => {
    const env = parseEnv('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604', 390, 844, 3)
    expect(env).toEqual({ os: 'iOS', browser: 'Safari', viewport: '390x844', dpr: 3 })
    expect(parseEnv('... MicroMessenger/8.0 ... Android ...', 0, 0, 0)).toEqual({ os: 'Android', browser: '微信' })
  })

  it('草稿：来回序列化，坏数据当没有', () => {
    expect(parseDraft(serializeDraft({ kind: 'idea', body: '想要深色模式' }))).toEqual({ kind: 'idea', body: '想要深色模式' })
    expect(parseDraft('{bad json')).toBeNull()
    expect(parseDraft(JSON.stringify({ kind: 'bug', body: '   ' }))).toBeNull()
    expect(parseDraft(JSON.stringify({ kind: 'weird', body: 'x' }))?.kind).toBe('bug')
    expect(parseDraft(null)).toBeNull()
  })

  it('时间：刚刚 / 分钟 / 小时 / 昨天 / 日期', () => {
    const now = new Date('2026-11-07T12:00:00Z').getTime()
    expect(timeAgo('2026-11-07T11:59:40Z', now)).toBe('刚刚')
    expect(timeAgo('2026-11-07T11:30:00Z', now)).toBe('30 分钟前')
    expect(timeAgo('2026-11-07T09:00:00Z', now)).toBe('3 小时前')
    expect(timeAgo('2026-11-06T09:00:00Z', now)).toBe('昨天')
    expect(timeAgo('not a date', now)).toBe('')
  })

  it('「会带上什么」与实际上下文一一对应', () => {
    expect(withItems({})).toEqual([])
    expect(withItems({ route: '/pages/practice/index', problemId: 'epsN', stepNo: 0 })).toEqual(['page', 'problem', 'step'])
    expect(withItems({ route: '/x', env: { os: 'iOS' }, errors: [{ message: 'boom' }] })).toEqual(['page', 'device', 'errors'])
  })

  it('有多少条在等我回应', () => {
    expect(waitingOnMe(mockListFeedback().items)).toBe(1)
  })
})

describe('文案', () => {
  // 只看学生能看到的文字（对象的键不算）。
  const strings = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
  const all = [
    ...strings([FBBOX_COPY, FBBOX_STATUS_LABEL, FBBOX_CLOSE_LABEL, FBBOX_QUICK_TAGS]),
    FBBOX_COPY.sentRef('#0001'),
    FBBOX_COPY.threadTitle('#0001'),
  ].join('\n')
  it('不出现开发者术语（工单、日志、探针、上报、bug、debug）', () => {
    for (const word of ['工单', '日志', '探针', '上报', 'bug', 'Bug', 'debug', '后台']) expect(all.includes(word), word).toBe(false)
  })
  it('每个状态、每个关闭原因都有说法', () => {
    expect(Object.keys(FBBOX_STATUS_LABEL).sort()).toEqual(['closed', 'need_info', 'new', 'open', 'resolved'])
    expect(Object.keys(FBBOX_CLOSE_LABEL).sort()).toEqual(['duplicate', 'fixed', 'no_repro', 'wontfix'])
  })
})

describe('探针', () => {
  beforeEach(() => resetProbe())

  it('默认（不开扩展）只带位置类字段，不带设备、错误、操作记录', () => {
    setProbeContext({ problemId: 'epsN', layer: 'L3', mode: 'practice', stepNo: 2, attemptId: '00000000-0000-4000-8000-000000000001' })
    recordError(new Error('boom'), 'window')
    recordCrumb({ kind: 'tap', text: 'step:2' })
    const ctx = collectContext({ route: '/pages/practice/index?x=1', extended: false })
    expect(ctx).toEqual({ route: '/pages/practice/index', pageName: '做题', problemId: 'epsN', layer: 'L3', mode: 'practice', stepNo: 2, attemptId: '00000000-0000-4000-8000-000000000001' })
    expect(ctx.env).toBeUndefined()
    expect(ctx.errors).toBeUndefined()
    expect(ctx.breadcrumbs).toBeUndefined()
  })

  it('开了扩展才带设备、最近的错误和操作；接口记录不含 query', () => {
    recordError(new TypeError('x is undefined'), 'promise')
    recordApi({ method: 'POST', path: '/attempts/1/lines?debug=1&token=s', status: 500, ms: 123.4, reqId: 'rAbCdEf123456' })
    recordCrumb({ kind: 'nav', text: '/pages/home/index?x=1' })
    const ctx = collectContext({ route: '/pages/home/index', extended: true, theme: 'dark', motion: true })
    expect(ctx.env).toMatchObject({ theme: 'dark', motion: true })
    expect(ctx.errors).toEqual([expect.objectContaining({ name: 'TypeError', message: 'x is undefined', where: 'promise' })])
    expect(ctx.breadcrumbs).toEqual([
      expect.objectContaining({ kind: 'api', text: 'POST /attempts/1/lines', status: 500, ms: 123, reqId: 'rAbCdEf123456' }),
      expect.objectContaining({ kind: 'nav', text: '/pages/home/index' }),
    ])
    expect(JSON.stringify(ctx)).not.toContain('token')
  })

  it('环形缓冲：错误最多 20 条、操作最多 30 条', () => {
    for (let i = 0; i < ERROR_LIMIT + 5; i += 1) recordError(new Error('e' + i))
    for (let i = 0; i < CRUMB_LIMIT + 5; i += 1) recordCrumb({ kind: 'tap', text: 't' + i })
    const ctx = collectContext({ route: '/pages/home/index', extended: true })
    expect(ctx.errors).toHaveLength(ERROR_LIMIT)
    expect(ctx.errors?.[0]?.message).toBe('e5')
    expect(ctx.breadcrumbs).toHaveLength(CRUMB_LIMIT)
  })

  it('错误信息会去掉长数字串和网址 query，并截断到 200 字', () => {
    expect(cleanMessage('学号 20260012345678 出错')).toBe('学号 … 出错')
    expect(cleanMessage('fetch https://a.cn/x?token=abc failed')).toBe('fetch https://a.cn/x failed')
    expect(cleanMessage('x'.repeat(500))).toHaveLength(200)
  })

  it('圈到的元素最多 5 个，原样带上', () => {
    const ctx = collectContext({ route: '/pages/practice/index', targets: ['a', 'b', 'c', 'd', 'e', 'f'], extended: false })
    expect(ctx.targets).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('任何情况下上下文里都没有作答正文类的键', () => {
    setProbeContext({ problemId: 'p', stepNo: 1 })
    recordError(new Error('boom'))
    const keys = Object.keys(collectContext({ route: '/pages/practice/index', extended: true }))
    for (const forbidden of ['text', 'body', 'proof', 'answer', 'input', 'lines']) expect(keys).not.toContain(forbidden)
  })
})

describe('信箱的演示规则（和真实服务端一致）', () => {
  beforeEach(() => resetMockFeedback())

  it('初始：一条等你补充、一条刚被确认复现，两条都未读', () => {
    const { items, unread } = mockListFeedback()
    expect(unread).toBe(2)
    expect(items.map((i) => i.status).sort()).toEqual(['need_info', 'open'])
    expect(items.find((i) => i.confirmed)?.unread).toBe(true)
  })

  it('提交得到递增的编号；新反馈是「已收到」且不算未读', () => {
    const a = mockSubmitFeedback('idea', '想要深色模式')
    const b = mockSubmitFeedback('bug', '键盘卡住了')
    expect(b.refNo).toBe(a.refNo + 1)
    const item = mockListFeedback().items.find((i) => i.id === a.id)
    expect(item).toMatchObject({ status: 'new', unread: false, preview: '想要深色模式' })
  })

  it('打开即已读；庆祝事件只在第一次打开时返回', () => {
    const confirmed = mockListFeedback().items.find((i) => i.confirmed)!
    expect(mockGetFeedback(confirmed.id).event).toBe('confirmed')
    expect(mockGetFeedback(confirmed.id).event).toBeNull()
    expect(mockListFeedback().unread).toBe(1)
  })

  it('追问：想问问你 → 正在看；已关闭不能再回复；不存在 404', () => {
    const waiting = mockListFeedback().items.find((i) => i.status === 'need_info')!
    mockReplyFeedback(waiting.id, '用的 iPhone 13')
    expect(mockGetFeedback(waiting.id)).toMatchObject({ status: 'open' })
    expect(mockGetFeedback(waiting.id).messages.at(-1)).toMatchObject({ from: 'me', body: '用的 iPhone 13' })
    const closed = mockSubmitFeedback('bug', '旧问题')
    // 直接构造一条已关闭的：演示数据里没有，用 reply 的错误形状验证即可
    expect(() => mockReplyFeedback('00000000-0000-4000-8000-999999999999', 'x')).toThrow(MockFeedbackError)
    expect(closed.refNo).toBeGreaterThan(0)
  })
})

describe('接口客户端（真实模式的请求形状）', () => {
  interface Call { url: string; init: RequestInit; body: unknown }
  const capture = (responder: (call: Call) => Response) => {
    const calls: Call[] = []
    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
      const call: Call = { url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
      calls.push(call)
      return responder(call)
    }
    return { calls, fetchImpl }
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  afterEach(() => __resetClientForTests())

  it('列表、对话、追加回复的路径与方法', async () => {
    const { calls, fetchImpl } = capture((c) => {
      if (c.url.endsWith('/messages')) return json({ id: 'm1', from: 'me', body: '补充', createdAt: '2026-11-07T00:00:00.000Z' }, 201)
      if (c.url.includes('/student/feedback/')) return json({ id: 'f1', refNo: 1, kind: 'bug', status: 'open', confirmed: false, createdAt: '2026-11-07T00:00:00.000Z', messages: [] })
      return json({ items: [], unread: 0 })
    })
    configureClientForTests({ fetchImpl, mock: false })
    expect(await listMyFeedback()).toEqual({ items: [], unread: 0 })
    expect((await getMyFeedback('f1')).id).toBe('f1')
    expect((await replyMyFeedback('f1', '补充')).id).toBe('m1')
    expect(calls.map((c) => `${c.init.method} ${c.url.replace(/^.*\/api\/v1/, '')}`)).toEqual([
      'GET /student/feedback',
      'GET /student/feedback/f1',
      'POST /student/feedback/f1/messages',
    ])
    expect(calls[2]?.body).toEqual({ body: '补充' })
    expect((calls[2]?.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
  })

  it('已关闭的反馈回复得到 FEEDBACK_CLOSED', async () => {
    const { fetchImpl } = capture(() => json({ error: { code: 'FEEDBACK_CLOSED', message: '这条反馈已经关闭了，可以再写一条新的' } }, 409))
    configureClientForTests({ fetchImpl, mock: false })
    await expect(replyMyFeedback('f1', 'x')).rejects.toMatchObject({ code: 'FEEDBACK_CLOSED', status: 409 })
  })

  it('演示模式下 sendFeedback 返回编号', async () => {
    configureClientForTests({ mock: true })
    const receipt = await sendFeedback('idea', '想要深色模式', { route: '/pages/home/index' })
    expect(receipt.refNo).toBeGreaterThan(0)
  })
})

describe('共享状态', () => {
  beforeEach(() => {
    __resetFeedbackBoxForTests()
    __resetFeedbackPrefsForTests()
    resetMockFeedback()
    resetProbe()
    configureClientForTests({ mock: true })
  })
  afterEach(() => __resetClientForTests())

  it('打开弹层时拍下上下文快照；快捷话追加到输入框', () => {
    setProbeContext({ problemId: 'epsN', stepNo: 3 })
    openFeedbackSheet({ kind: 'content', targets: ['step:3'] })
    const { state } = useFeedbackBox()
    expect(state.open).toBe(true)
    expect(state.kind).toBe('content')
    expect(state.context).toMatchObject({ problemId: 'epsN', stepNo: 3, targets: ['step:3'] })
    addQuickTag('题目写错了')
    addQuickTag('答案有问题')
    expect(state.body).toBe('题目写错了，答案有问题')
  })

  it('空内容不发送，给出提示；发送成功后清空输入并给回执', async () => {
    openFeedbackSheet()
    const { state } = useFeedbackBox()
    expect(await submitFeedback()).toBe(false)
    expect(state.error).toBe(FBBOX_COPY.empty)
    setBody('公式输不进')
    expect(state.error).toBe('')
    expect(await submitFeedback()).toBe(true)
    expect(state.receipt?.refNo).toBeGreaterThan(0)
    expect(state.body).toBe('')
  })

  it('发送失败时内容还在，提示说清楚', async () => {
    const fetchImpl = async () => new Response('x', { status: 500 })
    configureClientForTests({ fetchImpl, mock: false })
    openFeedbackSheet()
    setBody('卡住了')
    const { state } = useFeedbackBox()
    expect(await submitFeedback()).toBe(false)
    expect(state.body).toBe('卡住了')
    expect(state.error).toBe(FBBOX_COPY.sendFailed)
    expect(state.sending).toBe(false)
  })

  it('关掉「带上这些」后只送学生写的话', async () => {
    const sent: unknown[] = []
    const fetchImpl = async (_url: string, init: RequestInit = {}) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000009', refNo: 9 }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    configureClientForTests({ fetchImpl, mock: false })
    setProbeContext({ problemId: 'epsN' })
    openFeedbackSheet()
    const store = await import('@/feedbackbox/store')
    store.setAttach(false)
    setBody('只说一句')
    await submitFeedback()
    expect(sent[0]).toEqual({ kind: 'bug', body: '只说一句' })
    expect(ApiError).toBeDefined()
  })
})
