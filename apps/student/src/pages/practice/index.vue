<script setup lang="ts">
/**
 * 做题页（issue #10/#11/#12/#16 的集成页）。只做编排：
 * 状态和动作在 composables/practice/，每层的屏在 components/practice/。
 * 只渲染 AttemptState；不做层/预算/门槛/归类判定（08 §8 AI 规则 3）。
 * 布局：手机单列，主按钮贴底；平板单列（最宽 720）；桌面两栏（题面和证明在左，助教批注在右，最宽 1100）。
 */
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import BudgetBar from '@/components/BudgetBar.vue'
import HelpDrawer from '@/components/HelpDrawer.vue'
import HintPreviewCard from '@/components/HintPreviewCard.vue'
import LayerSheet from '@/components/LayerSheet.vue'
import MicroCourse from '@/components/MicroCourse.vue'
import MockSwitcher from '@/components/MockSwitcher.vue'
import OfflineBar from '@/components/OfflineBar.vue'
import TopBar from '@/components/TopBar.vue'
import WechatHint from '@/components/WechatHint.vue'
import CompletionScreen from '@/components/practice/CompletionScreen.vue'
import Composer from '@/components/practice/Composer.vue'
import ExamOverlays from '@/components/practice/ExamOverlays.vue'
import LayerDefine from '@/components/practice/LayerDefine.vue'
import LayerFrame from '@/components/practice/LayerFrame.vue'
import LayerInterstitial from '@/components/practice/LayerInterstitial.vue'
import LayerProof from '@/components/practice/LayerProof.vue'
import LayerSelfcheck from '@/components/practice/LayerSelfcheck.vue'
import LayerSummary from '@/components/practice/LayerSummary.vue'
import LayerTransfer from '@/components/practice/LayerTransfer.vue'
import PracticeFeedback from '@/components/practice/PracticeFeedback.vue'
import PracticeLoadState from '@/components/practice/PracticeLoadState.vue'
import PracticeMargin from '@/components/practice/PracticeMargin.vue'
import StemPeek from '@/components/practice/StemPeek.vue'
import PgButton from '@/components/ui/PgButton.vue'
import { useToast } from '@/components/ui/useToast'
import { mockEnabled, useAttemptSession } from '@/composables/practice/useAttemptSession'
import { useComposer } from '@/composables/practice/useComposer'
import { useDrafts } from '@/composables/practice/useDrafts'
import { useExamMode } from '@/composables/practice/useExamMode'
import { useFeedback } from '@/composables/practice/useFeedback'
import { useHelp } from '@/composables/practice/useHelp'
import { useKeyLines } from '@/composables/practice/useKeyLines'
import { useViewport } from '@/composables/useViewport'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { checkLesson } from '@/api/client'
import { initIntegrity } from '@/integrity/sdk'
import { setFeedbackTestMode } from '@/motion/useFeedbackPrefs'
import type { MockKey } from '@/mocks/attemptStates'
import type { LessonView } from '@/types/attempt'

const toast = useToast()
const { mode } = useViewport()

const drafts = useDrafts()
const session = useAttemptSession(drafts)
const { state, mockKey, busy, error, realMode, phase, loadError, currentLayer, lines, isCompleted, nextLineNo, isTransferAttempt, layerTitle, layerTask } = session
/** 写之前题面完整展开；写起来以后收成一行（桌面位置够，一直展开）。 */
const stemDefaultOpen = computed(() => mode.value === 'desktop' || lines.value.length === 0)
const exam = useExamMode(session)
const examView = reactive(exam)
const { strictExam, strictExamActive, examIsLocked, countdownText, timeUp, fullscreenNote, strictHelpOff } = exam
const help = useHelp(session, exam)
const { helpOpen, hintPreview, helpNote, visibleNotes, asideNotes } = help
const composer = useComposer(session, drafts)
const composerView = reactive(composer)
const loop = useFeedback(session)
const { feedback, interstitial } = loop
const { matchedLineIds } = useKeyLines(session)
const { restoredDraft, l1Initial } = drafts

const layersOpen = ref(false)
/** 第 1 层微课（02 §4.9）：内容由服务端下发，这里只保存在内存里渲染。 */
const microOpen = ref(false)
const microLesson = ref<LessonView | null>(null)
const offlineRetrying = ref(false)

const modeClass = computed(() => 'pg-practice--' + mode.value)
const strictClass = computed(() => ({ 'pg-practice--strict': strictExamActive.value }))

// 测验模式没有音效和游戏化：进出做题页时切换全局静音。
watch(
  () => state.value.mode,
  (attemptMode) => setFeedbackTestMode(attemptMode === 'test'),
  { immediate: true },
)
onUnmounted(() => setFeedbackTestMode(false))

// #27：事件归属随作答/切层/状态更新
const integrity = initIntegrity()
function syncIntegrityContext(): void {
  integrity.setContext({
    attemptId: state.value.attemptId,
    layer: state.value.currentLayer,
    mode: state.value.mode,
    problemId: state.value.problem.problemId,
  })
}
syncIntegrityContext()
watch([() => state.value.attemptId, currentLayer, () => state.value.mode, () => state.value.status], syncIntegrityContext)

async function handleOfflineRetry(): Promise<void> {
  offlineRetrying.value = true
  try {
    await integrity.flush('manual')
  } finally {
    offlineRetrying.value = false
  }
}

onUnload(() => {
  exam.cleanupExam()
  drafts.flush()
  void integrity.flushBeacon()
})

onLoad(async (q) => {
  if (mockEnabled) exam.ensureExamMockHook()
  session.applyApiFlag(q)
  // #145 年龄门：登录后、同意/练习前必须先有年龄分档（null → 选择页；lt14 → 暂不开通）。
  // 未登录/字段缺失不在这里拦（unknown），以服务端写接口的 409 AGE_BAND_REQUIRED / 403 AGE_RESTRICTED 为准。
  if (!ageGatePassed(await enforceAgeGate())) return
  await session.load(q)
  void composer.loadDefaultInput()
})

function onSwitchMock(k: MockKey) {
  session.setMock(k)
  help.reset()
  composer.reset()
  loop.reset()
  drafts.reset()
  void drafts.restoreDrafts()
}

/** 层列表只用来看进度：层的推进由服务端决定，点已完成或当前层只收起列表。 */
function closeLayers(): void {
  layersOpen.value = false
}

/**
 * 第 1 层「看不懂」→ 取微课并打开分步微课（02 §4.9）；第 2 层「看通用骨架」→ 由服务端返回 templateShown=true 的 state。
 */
async function handleLesson() {
  if (currentLayer.value === 'L1') {
    const lesson = await session.loadLesson()
    if (!lesson) return
    microLesson.value = lesson
    microOpen.value = true
    return
  }
  if (currentLayer.value === 'L2') {
    await session.showFrameTemplate()
    return
  }
  toast.show('这一层暂时没有讲解')
}

async function checkMicro(stepId: string, choice: number) {
  const lesson = microLesson.value
  if (!lesson) return null
  return checkLesson(state.value, lesson.conceptId, stepId, choice)
}

/** 完成页「加入证明本」/ 首页「证明本」：打开证明本页。 */
function goProofbook() {
  uni.navigateTo({ url: '/pages/proofbook/index' })
}

function handleBack() {
  // 直接打开链接时没有上一页，回到路径。
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/home/index' })
}

function backHome() {
  uni.redirectTo({ url: '/pages/home/index' })
}
</script>

<template>
  <PracticeLoadState v-if="phase !== 'ready'" :phase="phase" :message="loadError" @retry="session.retryLoad" @home="backHome" />
  <view v-else class="pg-page pg-practice" :class="[modeClass, strictClass, { 'pg-practice--feedback': feedback }]">
    <TopBar
      :layers="state.layers"
      :completed="isCompleted"
      :help-disabled="busy || strictHelpOff"
      @back="handleBack"
      @open-layers="layersOpen = true"
      @help="help.openHelp"
    />

    <!-- #27 离线提示条：正常文档流 + sticky，不覆盖 44px 操作区/BottomDock -->
    <OfflineBar :retrying="offlineRetrying" @retry="handleOfflineRetry" />
    <!-- #37 微信内打开提示：非阻塞横条，非微信 UA 不渲染 -->
    <WechatHint />

    <!-- #46 测验模式：倒计时以服务端 state.serverTime/截止时间为准；到点不在本地结束 -->
    <view v-if="strictExamActive && !examIsLocked" class="pg-exambar" data-testid="exam-bar">
      <text class="pg-exambar__label">限时测验 · 只读计时</text>
      <text class="pg-exambar__time pg-mono" data-testid="exam-countdown">
        {{ timeUp ? '已到时间，等待服务端提交…' : countdownText }}
      </text>
      <text v-if="fullscreenNote" class="pg-exambar__note pg-small" data-testid="exam-fullscreen-note">{{ fullscreenNote }}</text>
    </view>
    <view v-if="error" class="pg-practice__error pg-small">
      <text class="pg-practice__errortext">{{ error }}</text>
      <PgButton variant="ghost" size="sm" @tap="backHome">回首页</PgButton>
    </view>

    <view class="pg-practice__shell">
      <view class="pg-practice__main">
        <StemPeek v-if="!isCompleted" :problem="state.problem" :default-open="stemDefaultOpen" />
        <BudgetBar v-if="!isCompleted" :budget="state.budget" :show-keys="currentLayer !== 'L1' && currentLayer !== 'L2'" />

        <view class="pg-practice__content">
          <!-- #27 草稿恢复提示：重新打开时告诉学生内容来自本机未提交草稿 -->
          <view v-if="restoredDraft" class="pg-draftnotice" data-testid="draft-restored" role="status">
            <text class="pg-draftnotice__text pg-small">已恢复上次未提交的草稿</text>
            <PgButton variant="ghost" size="sm" data-testid="draft-restored-dismiss" @tap="restoredDraft = null">知道了</PgButton>
          </view>

          <view v-if="!isCompleted" class="pg-practice__head">
            <text class="pg-practice__layertitle">{{ layerTitle }}</text>
            <!-- #11：L1/L2 的任务说明由表单用 MathText 渲染，这里不再显示纯文本（避免露出 LaTeX 源码）。 -->
            <text
              v-if="layerTask && currentLayer !== 'L1' && currentLayer !== 'L2'"
              class="pg-practice__layertask pg-small"
            >{{ layerTask }}</text>
          </view>

          <CompletionScreen
            v-if="isCompleted"
            :state="state"
            :child="isTransferAttempt"
            @back-to-parent="session.backToParent"
            @proofbook="goProofbook"
            @make-transfer="session.beginTransfer"
            @home="backHome"
          />

          <LayerTransfer
            v-else-if="isTransferAttempt"
            child
            :problem="state.problem"
            :lines="lines"
            :notes="visibleNotes"
            :can-finish="Boolean(state.steps?.canFinish)"
            :busy="busy"
            @add-line="session.addChildLine"
            @edit-line="session.editChildLine"
            @delete-line="session.deleteChildLine"
            @finish="session.finishChild"
            @dismiss-note="help.dismissNote"
          />

          <LayerDefine
            v-else-if="currentLayer === 'L1'"
            :view="state.def"
            :busy="busy"
            :initial-text="l1Initial"
            @submit="session.submitText"
            @update:text="drafts.saveDefinition"
            @lesson="handleLesson"
            @skip="session.skipCurrentLayer"
          />

          <LayerFrame
            v-else-if="currentLayer === 'L2'"
            :view="state.frame"
            :busy="busy"
            @submit="session.submitText"
            @lesson="handleLesson"
            @skip="session.skipCurrentLayer"
          />

          <LayerProof
            v-else-if="currentLayer === 'L3'"
            :lines="lines"
            :notes="visibleNotes"
            :busy="busy"
            :can-finish="Boolean(state.steps?.canFinish)"
            :matched-line-ids="matchedLineIds"
            @write-next="composer.openComposer"
            @edit-line="composer.openEdit"
            @delete-line="session.removeLine($event.lineId)"
            @dismiss-note="help.dismissNote"
            @finish="session.finishProof"
          />

          <LayerSelfcheck
            v-else-if="currentLayer === 'L4'"
            :view="state.selfcheck ?? null"
            :lines="lines"
            :busy="busy"
            @submit="session.answerSelfcheckItem"
            @skip="session.skipCurrentLayer"
          />

          <LayerTransfer
            v-else-if="currentLayer === 'L5'"
            :view="state.transfer ?? null"
            :problem="state.problem"
            :busy="busy"
            @start="session.beginTransfer"
            @skip="session.skipCurrentLayer"
          />

          <LayerSummary v-else-if="currentLayer === 'L6'" :view="state.summary ?? null" :busy="busy" @submit="session.submitSummaryAnswers" />

          <view v-else class="pg-practice__placeholder pg-sheet">
            <text class="pg-practice__layertitle">{{ layerTitle }}</text>
            <text class="pg-practice__layertask pg-small">这一层暂未接入。</text>
          </view>
        </view>
      </view>

      <PracticeMargin
        v-if="mode === 'desktop'"
        :notes="asideNotes"
        :help-disabled="strictHelpOff"
        :strict-exam="strictExam"
        @dismiss="help.dismissNote"
        @help="help.openHelp"
      />
    </view>

    <LayerSheet :open="layersOpen" :layers="state.layers" :current="currentLayer" @update:open="layersOpen = $event" @select="closeLayers" />

    <HelpDrawer
      :open="helpOpen"
      :help="state.help"
      :mode="state.mode"
      :busy="busy"
      :note="helpNote"
      @update:open="help.setHelpOpen"
      @intent="help.pickIntent"
      @send="help.sendQuestion"
      @claim="help.claim"
      @decline="help.decline"
      @soft-landing="help.softLanding"
    />

    <HintPreviewCard
      v-if="hintPreview"
      :preview="hintPreview"
      :budget="state.budget"
      :busy="busy"
      @claim="help.claim"
      @decline="help.decline"
      @retry="help.retryPreview"
      @soft-landing="help.softLanding"
    />

    <Composer :composer="composerView" :line-no="nextLineNo" :lines="lines" :busy="busy" :photo-disabled="strictExam" />

    <PracticeFeedback :view="feedback" @continue="loop.dismissFeedback" />
    <LayerInterstitial :view="interstitial" :layers="state.layers" @continue="loop.dismissInterstitial" />

    <MicroCourse :open="microOpen" :lesson="microLesson" :check="checkMicro" @close="microOpen = false" />

    <!-- 真实模式和生产构建都不显示演示状态切换（#24） -->
    <MockSwitcher v-if="mockEnabled && !realMode" :model-value="mockKey" @update:model-value="onSwitchMock" />

    <ExamOverlays :exam="examView" :completed="isCompleted" />
  </view>
</template>

<style scoped>
.pg-practice {
  padding-bottom: 0;
}
/* #46 严格测验：题面/证明行禁止选中复制（输入框仍可编辑；粘贴由 SDK 拦截并上报） */
.pg-practice--strict :deep(.pg-problem),
.pg-practice--strict :deep(.pg-lines) {
  user-select: none;
  -webkit-user-select: none;
}
.pg-exambar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--accent-soft);
  border-bottom: 2px solid var(--accent);
  color: var(--accent-text);
}
.pg-exambar__label { font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-exambar__time { margin-left: auto; font-size: var(--fs-16); }
.pg-exambar__note { flex-basis: 100%; color: var(--bee-text); }
.pg-practice__shell {
  display: block;
}
/* 平板：单列，最宽 720。 */
.pg-practice--tablet .pg-practice__shell,
.pg-practice--tablet :deep(.pg-topbar__row) {
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}
/* 桌面：题面和证明在左，助教批注在右；表单不撑满。 */
.pg-practice--desktop .pg-practice__shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--sp-8);
  max-width: 1100px;
  margin: 0 auto;
  padding-top: var(--sp-2);
}
.pg-practice--desktop :deep(.pg-topbar__row) {
  max-width: 1100px;
  margin: 0 auto;
}
.pg-practice__main {
  min-width: 0;
  /* 手机：给贴底的主按钮留位置 */
  padding-bottom: calc(112px + var(--safe-bottom));
}
.pg-practice--tablet .pg-practice__main,
.pg-practice--desktop .pg-practice__main {
  padding-bottom: var(--sp-10);
}
/* 反馈面板开着时还能把证明滚到面板上方。 */
.pg-practice--feedback .pg-practice__main {
  padding-bottom: calc(260px + var(--safe-bottom));
}
.pg-practice__error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--sea-soft);
  color: var(--ink);
}
.pg-practice__errortext { flex: 1; }
.pg-practice__content {
  padding: 0;
}
.pg-draftnotice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border: 2px solid var(--accent);
  border-radius: var(--radius-16);
  background: var(--accent-soft);
  color: var(--ink);
  font-weight: var(--fw-bold);
}
.pg-draftnotice__text { flex: 1; min-width: 0; }
.pg-practice__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--sp-2) 0;
}
.pg-practice__layertitle {
  font-size: var(--fs-22);
  font-weight: var(--fw-black);
  line-height: var(--lh-tight);
  color: var(--ink);
}
.pg-practice__layertask {
  color: var(--ink-2);
  font-weight: var(--fw-bold);
}
.pg-practice__placeholder { padding: var(--sp-3); }
</style>
