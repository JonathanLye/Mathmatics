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
props: {
  lines: ProofLine[]; notes: Note[]; busy?: boolean; readonly?: boolean
  // 做题页专用，默认都关（教师镜像复用这个组件，外观和行为不变）：
  rail?: boolean                     // 行连成带节点的竖线
  editable?: boolean                 // 行内改写、两步删除
  animate?: boolean                  // 新行进场动画
  matchedLineIds?: readonly string[] // 点亮节点的行（见 practice/proofRail.ts）
  noteLayout?: 'auto' | 'inline' | 'margin'
}
emits: {
  'write-next': []
  'dismiss-note': [noteId: string]   // 学生关闭某条批注：父级用 filterDismissedNotes 只隐藏本页展示，不回写服务端
  'edit-line': [line: ProofLine]
  'delete-line': [line: ProofLine]
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
  'soft-landing': [action: string]              // 额度用尽四出路
  feedback: [noteId: string, useful: boolean]   // 只有 note.aiGenerated 时才显示
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
- 不能领取时显示原因并置灰「领取」；dwell 倒计时到 0 emit `retry`（也可手动「重新获取预览」）；`softLanding` 渲染成四个出路按钮（都可点，见 `useHelp` 的 exits）。

### `practice/Composer.vue` + `composables/practice/useComposer.ts`（写下一行的唯一入口）
- 第 3 层只有一个入口「写下一行」。弹一个面板，手写 / 键盘 / 拍照分段切换，默认值来自 `settings.default_input`；切分段不丢内容。行内改写用同一个面板。
- 手机（<600px）：底部弹层；平板/桌面：居中对话框。`role="dialog"` + `aria-modal` + Esc 关闭。
- `draftId` 生命周期：打开时「这一行」「依据」各生成一次（两个独立 id），打开期间的重试/超时重发复用；重新打开才换新 id。不要在每次提交里重新生成（会破坏 #19 幂等；PR #90 复审第 2 条）。
- 键盘：`MathField`（`MathTextEditor` + `ProofKeyboard` + 实时预览）。依据可空，有候选也能自由写。
- 拍照识别失败或超时（`practice/recognitionFailure.ts`，上限 25 秒）：一句说明 + 一键切手写/键盘 + 再试一次；不显示原始报错，写过的内容不动，拍照分段不隐藏。

### 做题页其余屏幕（`practice/`）
- `pages/practice/index.vue` 只做编排（<400 行）；逻辑在 `composables/practice/use*.ts`。
- `TopBar`：关闭 + 连续进度条 + 求助灯泡。`StemPeek`：题面收成一行。`BudgetBar`：关键步骤 y/n + 提示额度。
- `PracticeFeedback` + `feedback.ts`：提交后的面板，只比较前后两份服务端 state，不读学生内容。测验模式不出现。
- `LayerInterstitial`：层间过场。测验模式跳过。
- `CompletionScreen`：全屏庆祝；经验/连胜/徽章来自 `rewards`，步骤来自 `completion`。
- `ReviewSheet`：完成页的「看讲评」（`GET /attempts/{id}/review`），只在 `completion.reviewAvailable` 时有入口。
- `LayerSheet` + `ReviewingBar`：点已完成的层走 `POST /layers/{layer}/enter` 回去看，回看时只读（没有主按钮和「跳过」），有一键回到正在做的层；`frontierLayer` 只决定显示，能不能去由服务端决定。
- `useDrafts`：本机 IndexedDB 是主存储；`PUT /attempts/{id}/draft` 最多 15 秒备份一次，切后台和离开页面时各补一次，失败不打断。
- `TutorBubble` + `tutorTyping.ts`：助教气泡的打字效果，切点不落在公式中间。
- `PracticeThinking`：请求超过 300 毫秒才出现的小方。失败走 `guarded()`（`useAttemptSession`）：带「重试」的轻提示，不会空白。

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

## 自测约定
- 纯逻辑放 `apps/student/tests/*.test.ts`（vitest，node 环境，不依赖 DOM）。
- 组件至少保证 `npm run build:h5` 通过 + 390/768/1280 截图（tests/screenshots.mjs，由 Lead 汇总）。
- 不提交 `node_modules`、`dist`、截图产物（.gitignore 已覆盖）。
