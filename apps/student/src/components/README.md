# 学生端组件契约（A · 维护：Lead）

> 口径：`10-开发文档/02-学生端设计规范.md`、`03-手写键盘与识别.md`、`contracts/openapi.yaml`。
> 三条硬规则：
> 1. **前端只渲染 `AttemptState`**，不实现层/预算/门槛/归类/闸门（08 §8 AI 规则第 3 条）。
> 2. 所有颜色/间距/字号用 `src/styles/tokens.css` 的 CSS 变量，禁止硬编码色值。
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

### `<ProofLineList>`（#12）
```ts
props: { lines: ProofLine[]; notes: Note[]; busy?: boolean }
emits: { 'write-next': [] }
```
- 依据可空；红笔批注按 `note.lineId` 挂在对应行下方（找不到行则挂在列表末尾）。
- `note.kind === 'annotation'` 用 `--margin`，hint/concept 用各自颜色；不出现红叉/红色错误徽标。

### `<HelpDrawer>`（#16）
```ts
props: { open: boolean; help: HelpState; mode: AttemptMode; busy?: boolean }
emits: {
  'update:open': [v: boolean]
  intent: [intent: HelpIntent]                 // stuck | concept | check_line
  send: [text: string]                          // 自由输入
  claim: []                                     // 领取预览卡提示
  decline: []                                   // 先不要
  soft-landing: [action: string]                // 额度用尽四出路
}
```

### `<HintPreviewCard>`（#16）
```ts
props: { preview: HintPreview; busy?: boolean }
emits: { claim: []; decline: [] }
```
- 琥珀色边框；文案「这条会计入透露 0.5，剩余 1.5」；不能领取时显示原因与倒计时并置灰。

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
  submit: [{ statement: string; justification: string; input: { provenance: InputProvenance; draftId: string } }]
  'request-recognition': []    // 交给父级接 mock 识别
}
```
- 手机：底部升起弹层；平板/桌面：稿纸内展开（由父级 `layout` 决定，组件内用 CSS 自适应即可）。
- 「这一行」默认手写/键盘，「依据」默认键盘（02 §4.4）；依据可空。

## 自测约定
- 纯逻辑放 `apps/student/tests/*.test.ts`（vitest，node 环境，不依赖 DOM）。
- 组件至少保证 `npm run build:h5` 通过 + 390/768/1280 截图（tests/screenshots.mjs，由 Lead 汇总）。
- 不提交 `node_modules`、`dist`、截图产物（.gitignore 已覆盖）。
