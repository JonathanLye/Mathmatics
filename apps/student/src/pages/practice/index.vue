<script setup lang="ts">
/**
 * 做题页（issue #10/#11/#12/#16 的集成页）。
 * 只渲染 AttemptState；不做层/预算/门槛/归类判定（08 §8 AI 规则 3）。
 * 布局：手机单列 + 底部操作坞；平板两栏；桌面三栏（02 §3）。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import TopBar from '@/components/TopBar.vue'
import LayerNav from '@/components/LayerNav.vue'
import LayerSheet from '@/components/LayerSheet.vue'
import ProblemCard from '@/components/ProblemCard.vue'
import BudgetBar from '@/components/BudgetBar.vue'
import BottomDock from '@/components/BottomDock.vue'
import MockSwitcher from '@/components/MockSwitcher.vue'
import Layer1Form from '@/components/layers/Layer1Form.vue'
import Layer2Form from '@/components/layers/Layer2Form.vue'
import ProofLineList from '@/components/layers/ProofLineList.vue'
import HelpDrawer from '@/components/HelpDrawer.vue'
import HintPreviewCard from '@/components/HintPreviewCard.vue'
import EditorSheet from '@/components/EditorSheet.vue'
import { useAttempt } from '@/stores/attempt'
import { useViewport } from '@/composables/useViewport'
import { parseMockKey, type MockKey } from '@/mocks/attemptStates'
import { addLine, claimHint, finishSteps, requestHelp, skipLayer, submitDef, submitFramework, viewFrameTemplate } from '@/api/client'
import type { HelpIntent, HintPreview, LayerId, LineDraft, Note } from '@/types/attempt'

const { state, mockKey, busy, setMock, apply, run } = useAttempt()
const { mode } = useViewport()

const layersOpen = ref(false)
const editorOpen = ref(false)
const helpOpen = ref(false)
const hintPreview = ref<HintPreview | null>(null)
/** /help 返回的概念说明：抽屉里展示「助教」卡片（01 §4） */
const helpNote = ref<Note | null>(null)
const toast = ref('')

const currentLayer = computed(() => state.value.currentLayer)
const lines = computed(() => state.value.steps?.lines ?? [])
const notes = computed(() => state.value.notes ?? [])
const asideNotes = computed(() =>
  notes.value.filter((n) => n.kind === 'annotation' || n.kind === 'hint' || n.kind === 'concept').slice(-8).reverse(),
)
const isCompleted = computed(() => state.value.status === 'completed')
const nextLineNo = computed(() => lines.value.length + 1)
const layerTitle = computed(() => state.value.layers.find((l) => l.layer === currentLayer.value)?.title ?? '')
const layerTask = computed(() => {
  if (currentLayer.value === 'L1') return state.value.def?.task ?? ''
  if (currentLayer.value === 'L2') return state.value.frame?.task ?? ''
  if (currentLayer.value === 'L3') return '每次写一行：结论 + 依据。顺序由你决定。'
  return ''
})
const modeClass = computed(() => 'pg-practice--' + mode.value)

function show(msg: string) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 2400)
}

/** 开发期 mock 开关（PR #87 审计）：生产构建不允许用 ?mock= 切到假状态。 */
const mockEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK === '1'

/**
 * 从 URL hash 读取 mock 状态（H5 截图/演示用）：
 * 例如 #/pages/practice/index?mock=l3-active。
 * onLoad 收到的 options 在部分 H5 路由模式下只含 hash 前的查询，这里补一条兜底。
 * 用 parseMockKey（Object.hasOwn）校验：`in` 会命中 Object.prototype（constructor 等）→ 白屏。
 */
function mockFromHash(): MockKey | null {
  if (!mockEnabled || typeof window === 'undefined') return null
  const hash = window.location.hash
  const i = hash.indexOf('?')
  if (i === -1) return null
  return parseMockKey(new URLSearchParams(hash.slice(i + 1)).get('mock'))
}

const initialMock = mockFromHash()
if (initialMock) setMock(initialMock)

onLoad((q) => {
  if (!mockEnabled) return
  const k = parseMockKey(q?.mock) ?? initialMock
  if (k) setMock(k)
})

function onSwitchMock(k: MockKey) {
  setMock(k)
  hintPreview.value = null
  helpNote.value = null
  editorOpen.value = false
  helpOpen.value = false
}

function switchLayer(_layer: LayerId) {
  layersOpen.value = false
  show('P0 层跳转由服务端 state 决定，这里不自己改层')
}

async function handleSubmit(text: string) {
  const fn = currentLayer.value === 'L1' ? submitDef : submitFramework
  const next = await run(() => fn(state.value, text))
  if (next) apply(next)
}

/**
 * 第 1 层「看不懂」→ 微课入口（#26 接内容）；
 * 第 2 层「看通用骨架」→ 契约的 POST /framework/template，由服务端返回 templateShown=true 的 state。
 */
async function handleLesson() {
  if (currentLayer.value === 'L2') {
    const next = await run(() => viewFrameTemplate(state.value))
    if (next) apply(next)
    return
  }
  show('微课/图解是 #26（第二轮 Day2）的内容；本轮先把入口留好')
}

/** 跳层是独立操作（POST /layers/{L}/skip）：不把「已掌握，跳过」当文本提交，也不写 def/frame.last。 */
async function handleSkip() {
  const layer = currentLayer.value
  if (layer !== 'L1' && layer !== 'L2') return
  const next = await run(() => skipLayer(state.value, layer))
  if (next) apply(next)
}

async function handleAddLine(draft: LineDraft) {
  const next = await run(() => addLine(state.value, draft))
  if (next) {
    apply(next)
    editorOpen.value = false
  }
}

async function handleFinish() {
  const next = await run(() => finishSteps(state.value))
  if (next) apply(next)
}

function openHelp() {
  helpOpen.value = true
}

function handleHelpOpen(v: boolean) {
  helpOpen.value = v
  if (!v) helpNote.value = null
}

/** 取 /help 返回 state 里最新一条 note（mock 的 requestHelp 只回 state，不回 note 字段）。 */
function latestNote(notes: Note[] | undefined): Note | null {
  if (!notes || notes.length === 0) return null
  return notes[notes.length - 1] ?? null
}

/**
 * 三种意图 / 自由提问的统一出口（#16）：
 * - 返回 preview（H2 起）→ 抽屉收起，页面弹提示预览卡；
 * - 概念说明 → 01 §4 规定显示在抽屉里，抽屉保持打开，把 note 传给 HelpDrawer；
 * - 行检查 → 批注锚到行内（行下列表/页边），抽屉收起。
 * 这里只搬运服务端结果，不判定门槛与预算。
 */
async function runHelp(intent: HelpIntent, text = '') {
  const res = await run(() => requestHelp(state.value, intent, text))
  if (!res) return
  apply(res.state)
  if (res.preview) {
    helpNote.value = null
    hintPreview.value = res.preview
    helpOpen.value = false
    return
  }
  const note = res.note ?? latestNote(res.state.notes)
  if (res.routed === 'concept') {
    helpNote.value = note
    return
  }
  helpNote.value = null
  helpOpen.value = false
  show(res.routed === 'check_line' ? '批注已放到这一行下方' : '已收到你的问题')
}

function handleIntent(intent: HelpIntent) {
  void runHelp(intent)
}

function handleSend(text: string) {
  if (!text.trim()) {
    show('先写一句你卡在哪')
    return
  }
  void runHelp('concept', text.trim())
}

async function handleClaim() {
  const preview = hintPreview.value
  if (!preview) return
  const next = await run(() => claimHint(state.value, preview))
  if (next) {
    apply(next)
    hintPreview.value = null
    show('已领取；下一级要等你再写一行并停留 20 秒')
  }
}

function handleDecline() {
  hintPreview.value = null
}

/** 软着陆四个出路的展示名（01 §4.4；页面只显示选择，不实现微课跳转）。 */
const SOFT_LANDING_LABEL: Record<string, string> = {
  back_to_definition: '回到定义',
  open_lesson: '打开讲解',
  park_and_next: '先做下一题再回来',
  flag_teacher: '求助老师',
}

function handleSoftLanding(action: string) {
  helpOpen.value = false
  helpNote.value = null
  show('已选「' + (SOFT_LANDING_LABEL[action] ?? action) + '」；微课/下一题入口在 #26 接入')
}

function handleInk() {
  editorOpen.value = true
  show('手写画布由 #14 提供，本轮先进入行编辑器')
}

function handleKeyboard() {
  editorOpen.value = true
}

function handlePhoto() {
  show('拍照识别是 #25（Day2）')
}

function handleBack() {
  uni.navigateBack()
}

function backHome() {
  uni.redirectTo({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="pg-page pg-practice" :class="modeClass">
    <TopBar
      :title="state.problem.title"
      :current-layer="currentLayer"
      :layers="state.layers"
      @back="handleBack"
      @open-layers="layersOpen = true"
    />

    <LayerNav
      v-if="mode === 'tablet'"
      :layers="state.layers"
      :current="currentLayer"
      @select="switchLayer"
    />

    <view class="pg-practice__shell">
      <view v-if="mode === 'desktop'" class="pg-practice__rail">
        <LayerNav :layers="state.layers" :current="currentLayer" vertical @select="switchLayer" />
        <BudgetBar :budget="state.budget" />
      </view>

      <view class="pg-practice__main">
        <ProblemCard :problem="state.problem" />

        <view class="pg-practice__content">
          <view class="pg-practice__head">
            <text class="pg-practice__layertitle">{{ layerTitle }}</text>
            <!-- #11：L1/L2 的任务说明由表单用 MathText 渲染，这里不再显示纯文本（避免露出 LaTeX 源码）。 -->
            <text
              v-if="layerTask && currentLayer !== 'L1' && currentLayer !== 'L2'"
              class="pg-practice__layertask pg-small"
            >{{ layerTask }}</text>
          </view>

          <template v-if="isCompleted">
            <view class="pg-practice__done pg-sheet">
              <text class="pg-practice__donetitle">本题完成</text>
              <text class="pg-practice__donebody pg-small">
                自己写出 {{ state.budget.keysOwn }} / {{ state.budget.keysTotal }} 个关键步骤；
                透露 {{ state.budget.revealUsed }} / {{ state.budget.revealMax }}。
                独立度 {{ state.completion?.independence ?? '-' }}。
              </text>
              <text class="pg-practice__donebody pg-small">mathlib4 对照（只列定理名）：{{ (state.completion?.leanCard as any)?.theorems?.join('、') ?? '—' }}</text>
              <view class="pg-practice__donerow">
                <button class="pg-practice__btn" @tap="backHome">回首页</button>
                <button class="pg-practice__btn pg-practice__btn--primary" @tap="backHome">加入证明本</button>
              </view>
            </view>
          </template>

          <Layer1Form
            v-else-if="currentLayer === 'L1'"
            layer="L1"
            :view="state.def ?? {}"
            :busy="busy"
            @submit="handleSubmit"
            @lesson="handleLesson"
            @skip="handleSkip"
          />

          <Layer2Form
            v-else-if="currentLayer === 'L2'"
            layer="L2"
            :view="state.frame ?? {}"
            :busy="busy"
            @submit="handleSubmit"
            @lesson="handleLesson"
            @skip="handleSkip"
          />

          <template v-else-if="currentLayer === 'L3'">
            <ProofLineList :lines="lines" :notes="state.notes" :busy="busy" @write-next="editorOpen = true" />
            <view class="pg-practice__finishrow">
              <button
                class="pg-practice__btn pg-practice__btn--primary"
                :disabled="!state.steps?.canFinish || busy"
                @tap="handleFinish"
              >
                写完了
              </button>
            </view>
          </template>

          <view v-else class="pg-practice__placeholder pg-sheet">
            <text class="pg-practice__layertitle">{{ currentLayer }} · {{ layerTitle }}</text>
            <text class="pg-practice__layertask pg-small">
              本层不在本轮 Day0–Day1 范围（第 4–6 层与迁移题在 #26 第二轮）。当前页只验证状态渲染。
            </text>
          </view>
        </view>
      </view>

      <view v-if="mode !== 'mobile'" class="pg-practice__aside">
        <text class="pg-practice__asidetitle">页边</text>
        <view v-for="n in asideNotes" :key="n.noteId" class="pg-practice__note pg-sheet" :class="'pg-practice__note--' + n.kind">
          <text class="pg-practice__notewho pg-small">{{ n.who }}</text>
          <text class="pg-practice__notetext pg-small">{{ n.text }}</text>
        </view>
        <text v-if="asideNotes.length === 0" class="pg-practice__empty pg-small">还没有批注。写完一行，红笔会出现在这一行旁边。</text>
        <view class="pg-practice__asidehelp">
          <button class="pg-practice__btn pg-small" @tap="openHelp">求助</button>
        </view>
      </view>
    </view>

    <view v-if="mode === 'mobile'" class="pg-practice__dockwrap">
      <BudgetBar :budget="state.budget" />
      <BottomDock :help-busy="busy" @ink="handleInk" @keyboard="handleKeyboard" @photo="handlePhoto" @help="openHelp" />
    </view>

    <LayerSheet v-if="mode === 'mobile'" :open="layersOpen" :layers="state.layers" :current="currentLayer" @update:open="layersOpen = $event" @select="switchLayer" />
    <view v-else-if="layersOpen" class="pg-practice__mask" @tap="layersOpen = false" />

    <HelpDrawer
      :open="helpOpen"
      :help="state.help"
      :mode="state.mode"
      :busy="busy"
      :note="helpNote"
      @update:open="handleHelpOpen"
      @intent="handleIntent"
      @send="handleSend"
      @claim="handleClaim"
      @decline="handleDecline"
      @soft-landing="handleSoftLanding"
    />

    <HintPreviewCard
      v-if="hintPreview"
      :preview="hintPreview"
      :budget="state.budget"
      :busy="busy"
      @claim="handleClaim"
      @decline="handleDecline"
    />

    <EditorSheet
      :open="editorOpen"
      :line-no="nextLineNo"
      :initial-statement="''"
      :initial-justification="''"
      :busy="busy"
      @update:open="editorOpen = $event"
      @submit="handleAddLine"
    />

    <MockSwitcher v-if="mockEnabled" :model-value="mockKey" @update:model-value="onSwitchMock" />

    <view v-if="toast" class="pg-toast pg-small">{{ toast }}</view>
  </view>
</template>

<style scoped>
.pg-practice {
  padding-bottom: 0;
}
.pg-practice__shell {
  display: block;
}
.pg-practice--tablet .pg-practice__shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 0;
}
.pg-practice--desktop .pg-practice__shell {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 300px;
  max-width: 1280px;
  margin: 0 auto;
}
.pg-practice__rail {
  border-right: 1px solid var(--rule);
  padding-top: var(--sp-2);
  position: sticky;
  top: 60px;
  align-self: start;
}
.pg-practice__main {
  min-width: 0;
  padding-bottom: 140px;
}
.pg-practice__content {
  padding: 0 var(--sp-3);
}
.pg-practice__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--sp-2) 0;
}
.pg-practice__layertitle {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}
.pg-practice__layertask {
  color: var(--ink-2);
}
.pg-practice__aside {
  border-left: 1px solid var(--rule);
  padding: var(--sp-3);
  min-width: 0;
}
.pg-practice__asidetitle {
  display: block;
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.pg-practice__note {
  padding: var(--sp-2);
  margin-bottom: var(--sp-2);
  border-left: 3px solid var(--rule);
}
.pg-practice__note--annotation { border-left-color: var(--margin); background: var(--margin-soft); }
.pg-practice__note--hint { border-left-color: var(--hint); background: var(--hint-soft); }
.pg-practice__note--concept { border-left-color: var(--accent); background: var(--accent-soft); }
.pg-practice__notewho { display: block; color: var(--ink-2); }
.pg-practice__notetext { display: block; margin-top: 2px; color: var(--ink); }
.pg-practice__empty { color: var(--ink-2); }
.pg-practice__asidehelp { margin-top: var(--sp-3); }
.pg-practice__dockwrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
}
.pg-practice__dockwrap :deep(.pg-budget) {
  background: var(--paper);
  border-top: 1px solid var(--rule);
}
.pg-practice__finishrow {
  display: flex;
  justify-content: flex-end;
  padding: var(--sp-3) 0 var(--sp-2);
}
.pg-practice__btn {
  min-height: 44px;
  padding: 0 var(--sp-4);
  border-radius: var(--radius-input);
  border: 1px solid var(--rule);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
}
.pg-practice__btn--primary {
  border-color: var(--accent);
  color: #fff;
  background: var(--accent);
}
.pg-practice__btn:disabled {
  opacity: 0.45;
}
.pg-practice__placeholder { padding: var(--sp-3); }
.pg-practice__done { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-practice__donetitle { font-family: var(--font-serif); font-size: 20px; font-weight: 600; }
.pg-practice__donebody { color: var(--ink-2); }
.pg-practice__donerow { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
.pg-practice__mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(29, 36, 48, 0.2);
}
.pg-toast {
  position: fixed;
  left: 50%;
  bottom: calc(120px + var(--safe-bottom));
  transform: translateX(-50%);
  z-index: 80;
  max-width: 80vw;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-input);
  background: rgba(29, 36, 48, 0.92);
  color: #fff;
  text-align: center;
}
</style>
