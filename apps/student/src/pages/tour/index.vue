<script setup lang="ts">
/**
 * 登录前“先试一道”：一道极简证明的预演。不发任何请求、不带引擎，剧本在 onboarding/sandbox.ts。
 * 证明轨道、反馈面板、求助抽屉、庆祝屏都是做题页同一套组件，所以预演和真实做题看起来一样。
 */
import { computed, ref } from 'vue'
import MathText from '@ui-math/MathText.vue'
import HelpDrawer from '@/components/HelpDrawer.vue'
import ProofLineList from '@/components/layers/ProofLineList.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCelebration from '@/components/ui/PgCelebration.vue'
import PgFeedbackPanel from '@/components/ui/PgFeedbackPanel.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { SANDBOX_COPY } from '@/copy/onboarding'
import { playSfx } from '@/motion/sfx'
import {
  SANDBOX_HELP_ANSWER,
  SANDBOX_STEM,
  sandboxAsk,
  sandboxCloseHelp,
  sandboxDismissFeedback,
  sandboxFinish,
  sandboxGuide,
  sandboxNextLine,
  sandboxStart,
  sandboxWrite,
} from '@/onboarding/sandbox'
import type { HelpState, Note, ProofLine } from '@/types/attempt'

const state = ref(sandboxStart())
const composerOpen = ref(false)
const helpOpen = ref(false)
const helpNote = ref<Note | null>(null)

const HELP_STATE: HelpState = { hintAvailable: true, exhausted: false, flagged: false }

const nextLine = computed(() => sandboxNextLine(state.value))
const guide = computed(() => sandboxGuide(state.value))
const composerTitle = computed(() =>
  state.value.phase === 'fix' ? SANDBOX_COPY.composerFixTitle : SANDBOX_COPY.composerTitle.replace('{n}', String(state.value.lines.length + 1)),
)

const lines = computed<ProofLine[]>(() =>
  state.value.lines.map((line, i) => ({
    lineId: 'tour-' + (i + 1),
    n: i + 1,
    statement: line.statement,
    justification: line.justification,
    provenance: 'keyboard',
  })),
)
const matchedLineIds = computed(() => lines.value.filter((_, i) => state.value.lines[i]?.tone === 'ok').map((l) => l.lineId))
const shown = computed(() => state.value.shown)

function write(): void {
  if (nextLine.value) composerOpen.value = true
}
function submit(): void {
  composerOpen.value = false
  state.value = sandboxWrite(state.value)
  playSfx(shown.value?.tone === 'ok' ? 'correct' : 'gentle-question')
}
function dismissFeedback(): void {
  state.value = sandboxDismissFeedback(state.value)
}
function answerHelp(): void {
  state.value = sandboxAsk(state.value)
  helpNote.value = { noteId: 'tour-help', kind: 'concept', who: '助教', text: SANDBOX_HELP_ANSWER, at: new Date().toISOString() }
}
function setHelpOpen(open: boolean): void {
  helpOpen.value = open
  if (!open) state.value = sandboxCloseHelp(state.value)
}
function finish(): void {
  state.value = sandboxFinish(state.value)
  playSfx('celebrate')
}
function restart(): void {
  state.value = sandboxStart()
  helpNote.value = null
}
function goLogin(): void {
  uni.reLaunch({ url: '/pages/login/index' })
}
</script>

<template>
  <view class="pg-page pg-tour" data-testid="tour-page">
    <view class="pg-tour__bar">
      <PgButton variant="ghost" size="icon" :aria-label="SANDBOX_COPY.close" data-testid="tour-close" @tap="goLogin">
        <PgIcon name="close" :size="22" />
      </PgButton>
      <text class="pg-tour__label">{{ SANDBOX_COPY.label }}</text>
      <PgButton variant="ghost" size="icon" :aria-label="SANDBOX_COPY.help" data-testid="tour-help" @tap="setHelpOpen(true)">
        <PgIcon name="bulb" :size="24" />
      </PgButton>
    </view>

    <view class="pg-tour__main">
      <view class="pg-tour__stem"><MathText :text="SANDBOX_STEM" block /></view>

      <view v-if="guide" class="pg-tour__guide" role="status" data-testid="tour-guide">
        <PgMascot expr="happy" motion="blink" :size="56" />
        <text class="pg-tour__say">{{ guide }}</text>
      </view>

      <ProofLineList
        rail
        animate
        :editable="false"
        :lines="lines"
        :notes="[]"
        :matched-line-ids="matchedLineIds"
        note-layout="inline"
        @write-next="write"
      />

      <view v-if="state.phase === 'finish'" class="pg-tour__finish">
        <PgButton block size="lg" data-testid="tour-finish" sound="tap" @tap="finish">{{ SANDBOX_COPY.finish }}</PgButton>
      </view>
    </view>

    <PgSheet :open="composerOpen" aria-labelledby="pg-tour-composer-title" @update:open="composerOpen = $event">
      <view class="pg-tour__composer" data-testid="tour-composer">
        <text id="pg-tour-composer-title" class="pg-tour__composertitle">{{ composerTitle }}</text>
        <view v-if="nextLine" class="pg-tour__line">
          <MathText :text="nextLine.statement" block />
          <view class="pg-tour__just">
            <text class="pg-tour__justlabel">{{ SANDBOX_COPY.justification }}</text>
            <MathText :text="nextLine.justification" />
          </view>
        </view>
        <text class="pg-tour__scripted">{{ SANDBOX_COPY.scripted }}</text>
        <PgButton block size="lg" data-testid="tour-submit" @tap="submit">{{ SANDBOX_COPY.submit }}</PgButton>
      </view>
    </PgSheet>

    <PgFeedbackPanel
      :open="Boolean(shown)"
      :tone="shown?.tone ?? 'sea'"
      :title="shown?.title ?? ''"
      action-text="继续"
      action-testid="tour-feedback-continue"
      :data-feedback-tone="shown?.tone"
      @action="dismissFeedback"
    >
      <MathText v-if="shown" :text="shown.body" block />
      <text v-if="shown && shown.xp > 0" class="pg-tour__xp">+{{ shown.xp }} {{ SANDBOX_COPY.xp }}</text>
    </PgFeedbackPanel>

    <HelpDrawer
      :open="helpOpen"
      :help="HELP_STATE"
      mode="practice"
      :note="helpNote"
      @update:open="setHelpOpen"
      @intent="answerHelp"
      @send="answerHelp"
    />

    <PgCelebration :open="state.phase === 'done'" :title="SANDBOX_COPY.doneTitle" expr="cheer" confetti>
      <text class="pg-tour__donebody">{{ SANDBOX_COPY.doneBody }}</text>
      <template #actions>
        <PgButton block size="lg" data-testid="tour-login" @tap="goLogin">{{ SANDBOX_COPY.login }}</PgButton>
        <PgButton block variant="ghost" data-testid="tour-restart" @tap="restart">{{ SANDBOX_COPY.again }}</PgButton>
      </template>
    </PgCelebration>
  </view>
</template>

<style scoped>
.pg-tour { min-height: 100vh; padding-bottom: 160px; background: var(--paper); }
.pg-tour__bar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); }
.pg-tour__label { color: var(--ink-2); font-size: var(--fs-small); font-weight: 700; text-align: center; }
.pg-tour__main { display: flex; flex-direction: column; gap: var(--sp-4); width: 100%; max-width: 720px; margin: 0 auto; padding: 0 var(--sp-4); box-sizing: border-box; }
.pg-tour__stem { padding: var(--sp-3) var(--sp-4); background: var(--paper-2); border-radius: var(--radius-12); overflow-x: auto; }
.pg-tour__guide { display: flex; align-items: center; gap: var(--sp-3); }
.pg-tour__say { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-body); font-weight: 700; line-height: 1.5; }
.pg-tour__finish { position: sticky; bottom: var(--sp-3); }
.pg-tour__composer { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-tour__composertitle { color: var(--ink); font-size: var(--fs-h2, 20px); font-weight: 800; }
.pg-tour__line { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); background: var(--paper-2); border-radius: var(--radius-12); overflow-x: auto; }
.pg-tour__just { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); color: var(--ink-2); font-size: var(--fs-small); }
.pg-tour__justlabel { font-weight: 700; }
.pg-tour__scripted { color: var(--ink-2); font-size: var(--fs-small); line-height: 1.5; }
.pg-tour__xp { display: block; margin-top: var(--sp-1); font-weight: 800; }
.pg-tour__donebody { color: var(--ink); font-size: var(--fs-body); line-height: 1.6; text-align: center; }
</style>
