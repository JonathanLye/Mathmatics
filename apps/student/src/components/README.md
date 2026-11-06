# 学生端组件契约（A · 维护：Lead）

> 口径：`10-开发文档/02-学生端设计规范.md`、`03-手写键盘与识别.md`、`contracts/openapi.yaml`。
> 三条硬规则：
> 1. **前端只渲染 `AttemptState`**，不实现层/预算/门槛/归类/闸门（08 §8 AI 规则第 3 条）。
> 2. 所有颜色/间距/字号/圆角用 `packages/ui-tokens/tokens.css` 的 CSS 变量（`src/styles/tokens.css` 引入它），禁止硬编码色值。学生可见的说法从 `src/copy` 取，`tests/copy-lint.test.ts` 把关。
> 3. 事件命名 `update:*` 走 v-model，其余动词过去式/名词；不 emit 任何"判定结果"，判定只来自服务端 state。

## ui-math（packages/ui-math）

### `<MathText>`（Lead 已实现）
`props: { text?: string; block?: boolean; serif?: boolean }`，无事件。

### `<MathTextEditor>`（#13）
```ts
props: {
  modelValue: string            // MathText
  placeholder?: string
  autofocus?: boolean
  keyboardOpen?: boolean        // 由父组件控制证明键盘是否展示
  disabled?: boolean
  minRows?: number
}
emits: {
  'update:modelValue': [value: string]
  'request-system-keyboard': []  // 点键盘上的「中」
  'close-keyboard': []           // 点「完成」
}
```

### `<ProofKeyboard>`（#13）
```ts
props: {
  layout?: KeyboardLayout        // 默认读取 contracts/keyboard-layout.json
  visible: boolean
}
emits: {
  insert: [{ text: string; cursorOffset?: number }]  // 由 editor 负责落字
  action: ['backspace' | 'left' | 'right' | 'next' | 'system' | 'ink' | 'done']
}
```

### `<InkCanvas>`（#14）
```ts
props: {
  modelValue?: string          // ink-v1 JSON 字符串
  height?: number | string     // 默认 100%
  readonly?: boolean
}
emits: {
  'update:modelValue': [inkJson: string]
  'finish': [inkJson: string]
  'draw-start' : []  // 用于父级判断"有内容"
}
```

### `<RecognitionConfirm>`（#15）
```ts
props: { recognition: Recognition; busy?: boolean }
emits: {
  confirm: [text: string]
  rewrite: []
  'edit-keyboard': [text: string]
  discard: []
}
```

## apps/student/src/components

### `<Layer1Form>` / `<Layer2Form>`（#11）
```ts
props: {
  layer: 'L1' | 'L2'
  view: DefView | FrameView       // L1 传 state.def，L2 传 state.frame
  modelValue?: string
}
emits: {
  submit: [text: string]
  lesson: []
  skip: []
  'update:modelValue': [value: string]
}
```

### `<ProofLineList>`（#12；#151 补 dismiss-note）
```ts
props: { lines: ProofLine[]; notes: Note[]; busy?: boolean; readonly?: boolean }
emits: {
  'write-next': []
  'dismiss-note': [noteId: string]   // 学生关闭某条批注：父级用 filterDismissedNotes 只隐藏本页展示，不回写服务端
}
```
- 依据可空；红笔批注按 `note.lineId` 挂在对应行下方（找不到行则挂在列表末尾）；分组逻辑在 `layers/proofLines.ts`，有 vitest 单测（CI 生效）。
- 批注卡片显示 署名 / 时间 / 正文，带 `role=note` 与 `aria-label`；`readonly=false`（默认）时渲染关闭按钮（触控目标 ≥44px），`readonly`（教师镜像只读页）不渲染。
- 时间显示 `MM-DD HH:mm`（`formatNoteTime`，本地时区）。`check_line` 返回的 `res.note` 在 **B #141 落库 `state.notes` 前**只由父级在本次会话展示：父级 `mergeNotes(state.notes, res.note)` 按 `noteId` 去重，刷新/重连后以服务端下发的 `state.notes` 为准。
- `note.kind === 'annotation'` 一律 `--margin`，hint/concept 用各自颜色；不出现红叉/红色错误徽标。
- **颜色不读批注文案**：等 B 在契约加结构化字段（如 `note.linked` / `note.cls`）后再表达「衔接上了」的绿色；在此之前前端不解析 `note.text`（PR #90 复审第 3 条）。
- **≥600px（平板/桌面）行内只渲染颜色标记**，批注正文由页面页边栏渲染，避免同一条批注在两处重复渲染全文（02 §3.2；PR #90 复审第 4 条）。

### `<HelpDrawer>`（#16）
```ts
props: {
  open: boolean
  help: HelpState
  mode: AttemptMode
  busy?: boolean
  note?: Note | null   // /help 返回的 note：H0/H1 免费提示、概念解释、施压拒绝、off_topic 都会在抽屉里展示
}
emits: {
  'update:open': [v: boolean]
  intent: [intent: HelpIntent]                 // stuck | concept | check_line（free 只用于自由提问，见 send）
  send: [text: string]                          // 自由提问：页面用 intent=free + text 发 /help（06 §3.4）
  claim: []                                     // 领取预览卡提示
  decline: []                                   // 先不要
  'soft-landing': [action: string]              // 额度用尽四出路（flag_teacher 后端未实现，置灰）
}
```
- 只渲染 `HelpState`/`Note`，不判门槛；请求在途（busy）时遮罩/关闭按钮/Esc 都不关抽屉；有 role=dialog/aria-modal，Esc 可关（busy 除外）。

### `<HintPreviewCard>`（#16）
```ts
props: { preview: HintPreview; busy?: boolean; budget?: BudgetView | null }
emits: { claim: []; decline: []; retry: []; 'soft-landing': [action: string] }
```
- 琥珀色边框；文案「这条会用掉提示额度 0.5（你已用 0.5 / 2），剩余 1。」（剩余 = 预算上限 − 已用 − 本条；不传 budget 时只显示成本）。
- `HintPreview` 字段全部可选（契约无 required）：blocked preview 只有 `{ allowed:false, reason, waitSec }`，此时**只渲染原因行**（无标题/成本），`fmt` 对 undefined 不崩；`revealAfter` 是领取后的累计透露量，不是秒数。
- 不能领取时显示原因并置灰「领取」；dwell 倒计时到 0 emit `retry`（也可手动「重新获取预览」）；`softLanding` 渲染成四个出路按钮（`flag_teacher` 后端未实现，置灰并注「即将上线」）。

### `<EditorSheet>`（#12/#15 整合，层内编辑）
```ts
props: {
  open: boolean
  lineNo: number
  initialStatement?: string
  initialJustification?: string
  busy?: boolean
}
emits: {
  'update:open': [v: boolean]
  submit: [{
    statement: string
    justification: string
    input: InputMeta                 // { provenance, draftId, recogId?, pasteChars? }（openapi.yaml InputMeta）
    justificationInput?: InputMeta   // 依据非空时必带：独立 provenance/draftId（03 §1）
  }]
  'request-recognition': []    // 交给父级接 mock 识别
}
```
- 手机（<600px）：底部升起弹层；**平板/桌面（≥600px）：居中对话框卡片**，不做稿纸内联展开（2026-11-03 PR #90 复审路线 ②，已写进 02 §4.4）。
- `draftId` 生命周期：打开编辑器时「这一行」「依据」各生成一次（两个独立 id），打开期间的重试/超时重发复用；重新打开才换新 id。不要在每次 submit 里重新生成（会破坏 #19 幂等；PR #90 复审第 2 条）。
- 「这一行」默认手写/键盘，「依据」默认键盘（02 §4.4）；依据可空。
- 本轮输入区是 textarea + 常用符号条；#13 的 `<MathTextEditor>`/`<ProofKeyboard>` 落地后替换输入区，提交契约不变。
- 模态：`role="dialog"` + `aria-modal` + Esc 关闭 + 关闭后焦点归还；输入框有 aria-label（a11y 建议）。

## apps/student/src/components/ui（设计系统）

纯逻辑在 `ui/uiLogic.ts`（`tests/ui-logic.test.ts`）。属性和 `data-testid` 都透传到根节点。

| 组件 | 用途 | 主要 props |
|---|---|---|
| `PgButton` | 所有按钮；一屏一个 primary | `variant`（primary/secondary/ghost/danger/hint/sea）、`size`（sm/md/lg/icon）、`block`、`stack`、`loading`、`disabled`、`sound` |
| `PgCard` | 卡片 | `tone`（plain/soft/accent/sea/bee/ok/fox）、`lip`、`flush` |
| `PgField` | 表单项外壳 | `label`、`hint`、`error`、`optional` |
| `PgSheet` / `PgDialog` | 底部弹层（≥768 居中）/ 确认框 | `open`、`persistent`；`title`、`body`、`confirmText`、`danger`、`busy` |
| `PgToast` + `useToast()` | 全局轻提示；`main.ts` 挂一个 | `show(msg, { tone, duration })` |
| `PgEmpty` / `PgSkeleton` | 空状态（带小方）/ 加载占位 | `title`、`body`、`expr`、`action` |
| `PgProgress` | 分段或连续进度，前进时闪光 | `segments` 或 `value`、`tone`、`label` |
| `PgSegmented` / `PgSwitch` | 分段选择 / 开关 | `options`、`v-model` |
| `PgListRow` / `PgStatChip` / `PgFold` | 列表行 / 数字徽章 / 折叠块（mathlib 收在“延伸”下） | |
| `PgTabBar` | 五个主标签，手机底栏、平板图标栏、桌面侧栏 | `active` |
| `PgCoachmark` / `PgFeedbackPanel` / `PgCelebration` | 新手引导 / 答题反馈面板 / 全屏庆祝 + 撒花 | |
| `PgMascot` / `PgIcon` | 小方 / 图标（`packages/ui-math/src/design/icons.ts`） | `expr`、`motion`、`size` |

- `AppShell`：主标签页的外壳（标签栏、离线条、主栏 + `#rail` 右栏）。做题页不用它。
- `src/motion/`：动效 token、`sfx`、`haptics`、`confetti`、`useCountUp`、`useMascot`、`useFeedbackPrefs`。都是调用点主动触发，测验模式和教师镜像保持安静。
- 陈列页：`pages/dev/gallery`（只在开发和 mock 构建可进），改组件时在这里看全部状态。

## apps/student/src/components/onboarding（新手引导）
- `useOnboarding()`（`composables/useOnboarding.ts`）：看过哪些提示（`settings.onboarding.seen.*`）。`canShow(key)` 在读到设置、引导启用、不在测验、没看过时才为真；`markSeen(...keys)` 立即生效并排队写回（服务端整体替换，所以每次带完整对象）。键表在 `onboarding/logic.ts`（`ONBOARDING_KEYS`，做题页的就地提示也用这里的名字）。
- 同意书之前的页面不要调它（设置要求已签同意书）；登录页只用本机标记 `deviceIntroSeen()`。
- 演示数据默认关闭引导；`?onboarding=new` 打开“新学生”场景，“重看引导”也会打开。
- `IntroStory`：4 幕开场动画，发出 `done({ skipped })`。`PathIllustration`：六站路径插画（`once` 走一趟 / `loop` 循环）。动画全是 CSS，减少动态效果时停在最后一帧。
- `HomeOnboarding`：首页挂载点（欢迎页拦截 + 3 步导览），放在 `AppShell` 之外。导览目标按 `data-testid` 找，选择器列表在 `copy/onboarding.ts` 的 `TOUR_STEPS`。
- `ReplayOnboarding`：“重看新手引导”一行，放进“我的”页的列表里；也可直接调 `replayOnboarding()`。

## 自测约定
- 纯逻辑放 `apps/student/tests/*.test.ts`（vitest，node 环境，不依赖 DOM）。
- 组件至少保证 `npm run build:h5` 通过 + 390/768/1280 截图（tests/screenshots.mjs，由 Lead 汇总）。
- 不提交 `node_modules`、`dist`、截图产物（.gitignore 已覆盖）。
