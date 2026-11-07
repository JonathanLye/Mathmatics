/**
 * 小方信箱（全站反馈）用到的学生文案（15 号文档）。
 * 语气：口语、短句、第二人称；不说「工单、日志、上报、探针」；失败时说清楚内容还在。
 */
import type { FeedbackKind } from '@/types/attempt'
import type { FeedbackStatus } from '@/types/feedbackbox'

export const FBBOX_COPY = {
  fabLabel: '告诉小方哪里怪怪的',
  coachmark: '哪里怪怪的？点小方告诉我们',
  sheetTitle: '哪里怪怪的？告诉小方',
  kindLabel: '反馈类型',
  kindBug: '有问题',
  kindIdea: '有想法',
  kindContent: '题目有误',
  kindOther: '其他',
  placeholder: '发生了什么？想怎么改？随便说，不用写得很正式。',
  bodyLabel: '想说的话',
  send: '送出去',
  empty: '写点什么再送出去吧',
  sendFailed: '没发出去，请再试一次，写的内容还在',
  withTitle: '小方会一起带上',
  withToggle: '带上这些，小方更好找原因',
  withNone: '只带上你写的话',
  sent: '收到啦！',
  sentRef: (ref: string) => `编号 ${ref}，小方已经交给开发者了。`,
  sentHint: '可以在「我的 → 我的反馈」里看进度。',
  sentAction: '去看看',
  sentClose: '好的',
  inboxRow: '我的反馈',
  inboxRowSub: '看开发者的回复和处理进度',
  inboxTitle: '我的反馈',
  inboxEmptyTitle: '还没有反馈',
  inboxEmptyBody: '发现哪里怪怪的，点小方告诉我们。',
  inboxLoadFailed: '反馈没加载出来',
  inboxRetry: '重试',
  threadTitle: (ref: string) => `反馈 ${ref}`,
  threadEmpty: '还没有回复，开发者看到后会在这里回你。',
  fromMe: '我',
  fromDev: '小方 & 开发组',
  replyPlaceholder: '补充一句…',
  replyNeedInfo: '开发者想问问你，补充一句吧',
  replySend: '发送',
  replyFailed: '没发出去，请再试一次，写的内容还在',
  replyClosed: '这条反馈已经关闭了，可以再写一条新的。',
  writeNew: '写一条新的',
  confirmedTag: '已确认复现',
  celebrateResolvedTitle: '解决啦！',
  celebrateResolvedBody: '谢谢你帮小方找到它。',
  celebrateConfirmedTitle: '抓到虫啦！',
  celebrateConfirmedBody: '你帮小方找到了一个真问题，得到一枚「捉虫小能手」。',
  celebrateAction: '收下啦',
  badgeAction: '看看我的徽章',
  toastReport: '告诉小方',
  draftKept: '上次写的还在，接着写吧',
  offlineQueued: '现在没网，连上后会自动送出去',
} as const

export const FBBOX_KIND_LABEL: Readonly<Record<FeedbackKind, string>> = {
  bug: FBBOX_COPY.kindBug,
  idea: FBBOX_COPY.kindIdea,
  content: FBBOX_COPY.kindContent,
  other: FBBOX_COPY.kindOther,
}

/** 点一下就填进输入框的快捷话（随类型变化）。 */
export const FBBOX_QUICK_TAGS: Readonly<Record<FeedbackKind, readonly string[]>> = {
  bug: ['卡住了', '页面打不开', '公式输不进', '按钮点了没反应', '太慢了'],
  idea: ['想要新功能', '这里可以更简单', '想要更多题', '界面可以更好看'],
  content: ['题目写错了', '题目看不懂', '提示不对', '答案有问题'],
  other: ['找不到入口', '想问个问题', '想夸夸小方'],
}

/** 学生看到的状态说法（开发者端的说法见教师端）。 */
export const FBBOX_STATUS_LABEL: Readonly<Record<FeedbackStatus, string>> = {
  new: '已收到',
  open: '正在看',
  need_info: '想问问你',
  resolved: '已解决',
  closed: '已关闭',
}

export const FBBOX_CLOSE_LABEL = {
  fixed: '已解决',
  duplicate: '和别的反馈合并了',
  wontfix: '先放一放',
  no_repro: '暂时没能复现',
} as const

/** 「小方会一起带上」里每一项的说法。 */
export const FBBOX_WITH_LABEL = {
  page: '这一页',
  problem: '这道题',
  step: '第几步',
  device: '手机型号',
  errors: '最近的小错误',
} as const
