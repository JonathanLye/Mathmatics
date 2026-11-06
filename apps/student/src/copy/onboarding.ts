/**
 * 新手引导、登录、年龄、同意、欢迎页的学生可见文案。
 * 语气：温暖、短、平实；不提内部术语。页面从这里取，不在模板里散写。
 */
import { LAYER_NAMES } from './index'

export const LOGIN_COPY = {
  title: '证明陪练场',
  sub: '一行一行写证明，不抄答案。',
  modePassword: '密码登录',
  modeInvite: '邀请码激活',
  studentNo: '学号',
  studentNoPlaceholder: '你的学号',
  password: '密码',
  passwordPlaceholder: '你的密码',
  invite: '邀请码',
  invitePlaceholder: '6 位邀请码',
  submitPassword: '进入',
  submitInvite: '激活并进入',
  submitBusy: '登录中…',
  hintInvite: '第一次登录：输入老师给你的邀请码和学号，进去后设一个自己的密码。',
  hintPassword: '输入学号和你设的密码。',
  forgot: '忘记密码',
  watchIntro: '看看怎么玩',
  trySandbox: '先试一道',
  teacher: '我是老师',
  generic: '没登录成功，请检查学号和密码，或过一会儿再试。',
} as const

export const SETPW_COPY = {
  title: '先设一个自己的密码',
  sub: '以后用学号和密码登录，别人拿到邀请码也进不了你的账号。8 到 64 个字符，不能是学号，也不要用 12345678 这类常见密码。',
  password: '新密码',
  passwordPlaceholder: '至少 8 个字符',
  again: '再输入一次',
  againPlaceholder: '再输入一次',
  submit: '保存并继续',
  busy: '保存中…',
  hint: '忘记密码时，请找老师在名单里重置。',
} as const

export const AGE_COPY = {
  title: '你现在多大？',
  sub: '选一个年龄段就行，只记录一次。',
  blockedTitle: '这里暂时还不能用',
  blockedLead: '未满 14 岁暂不开通，这不是你的问题。',
  logout: '退出登录',
  loggingOut: '正在退出…',
  blockedHelp: '如果选错了，请联系老师帮你修改。',
} as const

export const CONSENT_COPY = {
  title: '开始前，请读一下',
  sub: '这是校内的练习工具。下面说明我们要用哪些数据、存在哪里、你能怎么选。',
} as const

export const INTRO_SCENES = [
  {
    id: 'what',
    title: '这是证明陪练场',
    body: '把大学数学证明，一行一行写出来。小方陪你练，不替你写。',
  },
  {
    id: 'path',
    title: '六步走完一道证明',
    body: '先回忆定义，再搭骨架，然后写证明、自检、换题试试，最后做个总结。',
  },
  {
    id: 'ask',
    title: '写不出来就问',
    body: '它只会追问和给提示，不会把答案写给你。每一行都是你自己写出来的。',
  },
  {
    id: 'daily',
    title: '每天一点点',
    body: '每天写一点，连续天数和证明本都会记下你的进步。',
  },
] as const

export const INTRO_UI = {
  label: '新手介绍',
  next: '下一步',
  back: '上一步',
  skip: '跳过',
  done: '开始吧',
  progress: (n: number, total: number) => `第 ${n} 幕，共 ${total} 幕`,
} as const

/** 第 2 幕六个站点的名字，与路径页一致。 */
export const PATH_STEP_NAMES: readonly string[] = [
  LAYER_NAMES.L1,
  LAYER_NAMES.L2,
  LAYER_NAMES.L3,
  LAYER_NAMES.L4,
  LAYER_NAMES.L5,
  LAYER_NAMES.L6,
]

export const WELCOME_COPY = {
  nameTitle: '先认识一下',
  nameSub: '小方怎么称呼你？',
  nameLabel: '昵称',
  namePlaceholder: '1 到 16 个字',
  nameHint: '小方会用它来叫你。',
  nameTooLong: '昵称最多 16 个字',
  goalTitle: '每天想写几步？',
  goalSub: '算的是你自己写出来的关键步骤，提示不算。',
  inputTitle: '你习惯怎么写？',
  inputSub: '做题时随时可以换。',
  next: '下一步',
  back: '上一步',
  finish: '完成',
  saving: '保存中…',
  skipName: '先不取名，叫我「同学」',
  readyTitle: (name: string) => `准备好了，${name}！`,
  readySub: '去看看你的路径，小方会带你认一下各个地方。',
  readyGo: '去看看路径',
  saveFailed: '没保存上，请再试一次。',
  stepOf: (n: number, total: number) => `${n} / ${total}`,
} as const

export const DAILY_GOALS: ReadonlyArray<{ value: number; name: string; desc: string; icon: 'star' | 'flame' | 'flash'; tone: 'ok' | 'bee' | 'fox' }> = [
  { value: 2, name: '轻松', desc: '每天 2 步，先热热身', icon: 'star', tone: 'ok' },
  { value: 3, name: '稳步', desc: '每天 3 步，刚刚好', icon: 'flame', tone: 'bee' },
  { value: 5, name: '冲刺', desc: '每天 5 步，想多练一点', icon: 'flash', tone: 'fox' },
]

export const INPUT_CHOICES: ReadonlyArray<{ value: 'hand' | 'keyboard' | 'photo'; name: string; desc: string }> = [
  { value: 'hand', name: '手写', desc: '用手指或笔写，小方帮你认成公式' },
  { value: 'keyboard', name: '键盘', desc: '用数学键盘输入符号和分式' },
  { value: 'photo', name: '拍照', desc: '写在纸上，拍下来识别' },
]

export const TOUR_STEPS = [
  {
    // 路径页由别的任务改版：按这几个选择器依次找，找到第一个就用。
    target: '[data-testid="home-path-node"], [data-testid^="home-todo-start-"], [data-testid^="home-continue-"], [data-testid="home-todo-card"], [data-testid="home-inprogress-card"], [data-testid="home-todo-empty"]',
    title: '这是你的路径',
    // 刚进来、老师还没布置题的时候路径是空的，所以这句话在有题和没题时都说得通。
    body: '老师布置的题会一道一道排在这里，能做的会亮起来，做完一道再往下走。',
  },
  {
    target: '[data-testid="home-daily-goal"], [data-testid="home-week"], [data-testid="home-done-count"]',
    title: '今天的小目标',
    body: '每写出一个关键步骤，小目标就往前一格。提示不算，自己写的才算。',
  },
  {
    target: '[data-testid="tab-me"]',
    title: '「我的」在这里',
    body: '外观、音效和动效在这里调，想再看一遍引导也在这里。',
  },
] as const

export const TOUR_UI = { next: '下一步', done: '知道了', skip: '跳过' } as const

export const REPLAY_COPY = {
  title: '重看新手引导',
  sub: '再看一遍开场动画和首页导览',
} as const

export const SANDBOX_COPY = {
  label: '试玩 · 不会记录任何内容',
  close: '回到登录',
  help: '求助',
  composerTitle: '写下第 {n} 行',
  composerFixTitle: '改写第 2 行',
  justification: '依据',
  scripted: '试玩时这一行已替你写好。真正做题时由你自己写，可以手写、键盘或拍照。',
  submit: '写好了，提交',
  finish: '写完了',
  xp: '经验',
  doneTitle: '试玩完成',
  doneBody: '这就是一道题的样子：自己写，卡住了问一句，每一步都看得见。',
  login: '登录开始我的证明',
  again: '再玩一次',
} as const

/** 做题页就地提示：target 按顺序找，找到第一个就用；都找不到时气泡居中。 */
export const COACH_COPY: Record<string, { target: string; title: string; body: string }> = {
  'layer.L1': { target: '.pg-practice__content', title: '先回忆定义', body: '用自己的话写就行。系统只告诉你缺了哪一块，不替你写。' },
  'layer.L2': { target: '.pg-practice__content', title: '搭骨架', body: '先写开头、结尾和要构造什么，中间的计算留到下一步。' },
  'layer.L3': { target: '[data-testid="write-next"]', title: '一行一行写', body: '每次写一行：结论加依据。写不下去就点右上角的灯泡。' },
  'layer.L4': { target: '.pg-practice__content', title: '自检', body: '回答几个小问题，确认每一步你都说得清。' },
  'layer.L5': { target: '.pg-practice__content', title: '换题试试', body: '同样的想法换一道题，可以做，也可以跳过。' },
  'layer.L6': { target: '.pg-practice__content', title: '总结', body: '用自己的话说说这个证明，下次才记得住。' },
  'input.hand': { target: '[data-testid="ink-sheet"]', title: '手写一行', body: '用手指或手写笔写，写完确认识别结果再提交。' },
  'input.keyboard': { target: '[data-testid="editor-statement"]', title: '键盘写公式', body: '下面的符号键能打 ε、≤ 这些符号，上方实时显示排版效果。' },
  'input.photo': { target: '[data-testid="composer-tab-photo"]', title: '拍纸上写的', body: '拍一行就好，识别后由你确认。认不出来也没关系，可以换手写或键盘。' },
  'help.open': { target: '.pg-help__intents', title: '三种求助', body: '卡住了、概念不懂、想让人看看这一行，都可以问。它只引导，不替你写。' },
  'hint.costed': { target: '.pg-preview__cost', title: '这条提示要用额度', body: '提示额度每道题有限，用了不会退回。看清说明，再决定领不领。' },
  'note.first': { target: '[data-feedback-tone]', title: '这是一个问题', body: '助教不判对错，只提问。想一想，再决定要不要改这一行。' },
  'done.first': { target: '[data-testid="completion-card"]', title: '这一题做完了', body: '证明已经收进证明本。接下来可以换题试试，也可以做下一题。' },
}
