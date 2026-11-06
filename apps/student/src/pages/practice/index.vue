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
import DraftNotice from '@/components/practice/DraftNotice.vue'
import ExamBar from '@/components/practice/ExamBar.vue'
import ExamOverlays from '@/components/practice/ExamOverlays.vue'
import ReviewingBar from '@/components/practice/ReviewingBar.vue'
import LayerDefine from '@/components/practice/LayerDefine.vue'
import LayerFrame from '@/components/practice/LayerFrame.vue'
import LayerInterstitial from '@/components/practice/LayerInterstitial.vue'
import LayerProof from '@/components/practice/LayerProof.vue'
import LayerSelfcheck from '@/components/practice/LayerSelfcheck.vue'
import LayerSummary from '@/components/practice/LayerSummary.vue'
import LayerTransfer from '@/components/practice/LayerTransfer.vue'
import PracticeCoach from '@/components/practice/PracticeCoach.vue'
import PracticeFeedback from '@/components/practice/PracticeFeedback.vue'
import PracticeLoadState from '@/components/practice/PracticeLoadState.vue'
import PracticeMargin from '@/components/practice/PracticeMargin.vue'
import PracticeThinking from '@/components/practice/PracticeThinking.vue'
import StemPeek from '@/components/practice/StemPeek.vue'
import SolutionSheet from '@/components/practice-zone/SolutionSheet.vue'
import { mockEnabled, useAttemptSession } from '@/composables/practice/useAttemptSession'
import { useComposer } from '@/composables/practice/useComposer'
import { useDrafts } from '@/composables/practice/useDrafts'
import { useExamMode } from '@/composables/practice/useExamMode'
import { useFeedback } from '@/composables/practice/useFeedback'
import { useHelp } from '@/composables/practice/useHelp'
import { useKeyLines } from '@/composables/practice/useKeyLines'
import { useLessonPanel } from '@/composables/practice/useLessonPanel'
import { usePracticeNav } from '@/composables/practice/usePracticeNav'
import { useViewport } from '@/composables/useViewport'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { initIntegrity } from '@/integrity/sdk'
import { setFeedbackTestMode } from '@/motion/useFeedbackPrefs'
import type { MockKey } from '@/mocks/attemptStates'

const { mode } = useViewport()

const drafts = useDrafts()
const session = useAttemptSession(drafts)
const { state, mockKey, busy, realMode, phase, loadError, currentLayer, lines, isCompleted, nextLineNo, isTransferAttempt, layerTitle, layerTask } = session
/** 写之前题面完整展开；写起来以后收成一行（桌面位置够，一直展开）。 */
const stemDefaultOpen = computed(() => mode.value === 'desktop' || lines.value.length === 0)
const exam = useExamMode(session)
const examView = reactive(exam)
const { strictExam, strictExamActive, examIsLocked, countdownText, timeUp, fullscreenNote, strictHelpOff } = exam
const nav = usePracticeNav(session)
const { origin, nextBusy, layersOpen, frontier, reviewing, selectLayer } = nav
const lesson = useLessonPanel(session)
const { microOpen, microLesson } = lesson
const help = useHelp(session, exam, { openLesson: () => void lesson.openLesson(), parkAndLeave: () => void nav.parkAndNext() })
const { helpOpen, hintPreview, helpNote, visibleNotes, asideNotes } = help
const composer = useComposer(session, drafts)
const composerView = reactive(composer)
const loop = useFeedback(session)
const { feedback, interstitial, completionRewards } = loop
const { matchedLineIds } = useKeyLines(session)
const { restoredDraft, l1Initial } = drafts

const offlineRetrying = ref(false)
const solutionOpen = ref(false)
/** 从路径或练习区进来的自学题才有“看解题思路”；老师布置的题没有。 */
const selfStudy = ref(false)
function openSolution(): void {
  help.setHelpOpen(false)
  solutionOpen.value = true
}

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
  drafts.stopBackup()
  void integrity.flushBeacon()
})

onLoad(async (q) => {
  nav.setOrigin(q?.from)
  selfStudy.value = q?.from === 'path' || q?.from === 'zone'
  drafts.startBackup()
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
</script>

<template>
  <PracticeLoadState v-if="phase !== 'ready'" :phase="phase" :message="loadError" @retry="session.retryLoad" @home="nav.backHome" />
  <view v-else class="pg-page pg-practice" :class="[modeClass, strictClass, { 'pg-practice--feedback': feedback, 'pg-practice--reviewing': reviewing }]">
    <TopBar
      :layers="state.layers"
      :completed="isCompleted"
      :help-disabled="busy || strictHelpOff"
      @back="nav.handleBack"
      @open-layers="layersOpen = true"
      @help="help.openHelp"
    />

    <!-- #27 离线提示条：正常文档流 + sticky，不覆盖 44px 操作区 -->
    <OfflineBar :retrying="offlineRetrying" @retry="handleOfflineRetry" />
    <!-- #37 微信内打开提示：非阻塞横条，非微信 UA 不渲染 -->
    <WechatHint />

    <!-- #46 测验模式：倒计时以服务端 state.serverTime/截止时间为准；到点不在本地结束 -->
    <ExamBar v-if="strictExamActive && !examIsLocked" :time-up="timeUp" :countdown="countdownText" :note="fullscreenNote" />

    <view class="pg-practice__shell">
      <view class="pg-practice__main">
        <StemPeek v-if="!isCompleted" :problem="state.problem" :default-open="stemDefaultOpen" :redo="state.kind === 'redo'" />
        <BudgetBar v-if="!isCompleted" :budget="state.budget" :show-keys="currentLayer !== 'L1' && currentLayer !== 'L2'" />

        <view class="pg-practice__content">
          <ReviewingBar v-if="reviewing && currentLayer && frontier" :current="currentLayer" :frontier="frontier" :busy="busy" @return="selectLayer(frontier!)" />
          <DraftNotice v-if="restoredDraft" @dismiss="restoredDraft = null" />

          <view v-if="!isCompleted && !isTransferAttempt" class="pg-practice__head">
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
            :rewards="completionRewards"
            :origin="origin"
            :busy="busy || nextBusy"
            @back-to-parent="session.backToParent"
            @proofbook="nav.goProofbook"
            @next="nav.goNext"
            @home="nav.backHome"
          />

          <LayerTransfer
            v-else-if="isTransferAttempt"
            child
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
            :reviewing="reviewing"
            @submit="session.submitText"
            @update:text="drafts.saveDefinition"
            @lesson="lesson.handleLesson"
            @skip="session.skipCurrentLayer"
          />

          <LayerFrame
            v-else-if="currentLayer === 'L2'"
            :view="state.frame"
            :busy="busy"
            :reviewing="reviewing"
            @submit="session.submitText"
            @lesson="lesson.handleLesson"
            @skip="session.skipCurrentLayer"
          />

          <LayerProof
            v-else-if="currentLayer === 'L3'"
            :reviewing="reviewing"
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
            :reviewing="reviewing"
            @submit="session.answerSelfcheckItem"
            @skip="session.skipCurrentLayer"
          />

          <LayerTransfer
            v-else-if="currentLayer === 'L5'"
            :view="state.transfer ?? null"
            :busy="busy"
            :reviewing="reviewing"
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

    <LayerSheet :open="layersOpen" :layers="state.layers" :current="currentLayer" @update:open="layersOpen = $event" @select="selectLayer" />

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
      :solution-available="selfStudy && !strictExam"
      @feedback="help.noteFeedback"
      @solution="openSolution"
    />

    <SolutionSheet v-model:open="solutionOpen" :problem-id="state.problem.problemId" :exam-mode="strictExam" />

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

    <PracticeThinking :busy="busy" />
    <PracticeFeedback :view="feedback" @continue="loop.dismissFeedback" />
    <LayerInterstitial :view="interstitial" :layers="state.layers" @continue="loop.dismissInterstitial" />
    <PracticeCoach
      :layer="currentLayer"
      :completed="isCompleted"
      :composer-open="composer.editorOpen.value"
      :composer-tab="composer.tab.value"
      :help-open="helpOpen"
      :hint-cost="hintPreview?.cost ?? 0"
      :question-shown="feedback?.tone === 'sea' && Boolean(feedback?.lineId)"
      :overlay-open="Boolean(feedback || interstitial)"
    />

    <MicroCourse :open="microOpen" :lesson="microLesson" :check="lesson.checkMicro" @close="microOpen = false" />

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
/* 回看已完成的层只读：引擎不会因为重新提交再推进一次，这里不给主按钮。 */
.pg-practice--reviewing :deep(.pg-pin) { display: none; }
.pg-practice--feedback .pg-practice__main {
  padding-bottom: calc(260px + var(--safe-bottom));
}
.pg-practice__content {
  padding: 0;
}
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
