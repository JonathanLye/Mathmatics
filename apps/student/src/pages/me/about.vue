<script setup lang="ts">
/**
 * 关于：版本、AI 使用说明、问题反馈（POST /student/feedback）。
 * ?feedback=1 进来时直接打开反馈弹层（“我的”里的问题反馈用它）。发送失败留在弹层里，内容不丢。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { errorMessage, sendFeedback } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import MeSubHeader from '@/components/me/MeSubHeader.vue'
import { FEEDBACK_MAX, feedbackBody, versionLabel } from '@/components/me/meLogic'
import { applyApiOverride } from '@/components/path/openPractice'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { useToast } from '@/components/ui/useToast'
import { ABOUT_COPY } from '@/copy'
import manifest from '@/manifest.json'
import type { FeedbackKind } from '@/types/attempt'

const toast = useToast()
const version = versionLabel((manifest as { versionName?: unknown }).versionName)

const KIND_OPTIONS: ReadonlyArray<{ value: FeedbackKind; label: string; testid: string }> = [
  { value: 'bug', label: ABOUT_COPY.kindBug, testid: 'feedback-kind-bug' },
  { value: 'idea', label: ABOUT_COPY.kindIdea, testid: 'feedback-kind-idea' },
  { value: 'content', label: ABOUT_COPY.kindContent, testid: 'feedback-kind-content' },
  { value: 'other', label: ABOUT_COPY.kindOther, testid: 'feedback-kind-other' },
]

const sheetOpen = ref(false)
const kind = ref<FeedbackKind>('bug')
const body = ref('')
const message = ref('')
const sending = ref(false)

onLoad((q) => {
  applyApiOverride(q)
  if (q?.feedback === '1') sheetOpen.value = true
})

async function send(): Promise<void> {
  if (sending.value) return
  const text = feedbackBody(body.value)
  if (!text) {
    message.value = ABOUT_COPY.empty
    return
  }
  sending.value = true
  message.value = ''
  try {
    await sendFeedback(kind.value, text, 'me/about')
    body.value = ''
    sheetOpen.value = false
    toast.show(ABOUT_COPY.sent, { tone: 'ok' })
  } catch (e) {
    message.value = errorMessage(e) || ABOUT_COPY.sendFailed
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <AppShell active="me">
    <view class="pg-about" data-testid="about-page">
      <MeSubHeader :title="ABOUT_COPY.title" />

      <PgCard class="pg-about__hero">
        <PgMascot expr="happy" :motion="['breathe', 'blink']" :size="72" />
        <text class="pg-about__name">{{ ABOUT_COPY.name }}</text>
        <text class="pg-about__tagline">{{ ABOUT_COPY.tagline }}</text>
        <text class="pg-about__version" data-testid="about-version">{{ ABOUT_COPY.version }} {{ version }}</text>
      </PgCard>

      <PgCard class="pg-about__card" data-testid="about-ai">
        <text class="pg-about__title">{{ ABOUT_COPY.aiTitle }}</text>
        <view v-for="item in ABOUT_COPY.aiItems" :key="item" class="pg-about__item">
          <view class="pg-about__dot" aria-hidden="true" />
          <text class="pg-about__itemtext">{{ item }}</text>
        </view>
      </PgCard>

      <PgCard class="pg-about__card">
        <text class="pg-about__title">{{ ABOUT_COPY.feedbackTitle }}</text>
        <text class="pg-about__itemtext">{{ ABOUT_COPY.feedbackBody }}</text>
        <PgButton variant="secondary" block sound="tap" data-testid="about-feedback" @tap="sheetOpen = true">{{ ABOUT_COPY.feedbackAction }}</PgButton>
      </PgCard>
    </view>

    <PgSheet v-model:open="sheetOpen" data-testid="feedback-sheet" :persistent="sending">
      <view class="pg-about__sheet">
        <text class="pg-about__sheettitle">{{ ABOUT_COPY.sheetTitle }}</text>
        <PgSegmented v-model="kind" :options="KIND_OPTIONS" :label="ABOUT_COPY.sheetTitle" />
        <textarea v-model="body" class="pg-input-area" data-testid="feedback-body" :maxlength="FEEDBACK_MAX" :placeholder="ABOUT_COPY.placeholder" />
        <text v-if="message" class="pg-about__error" role="alert" data-testid="feedback-error">{{ message }}</text>
        <PgButton block sound="tap" data-testid="feedback-send" :loading="sending" @tap="send">{{ ABOUT_COPY.send }}</PgButton>
      </view>
    </PgSheet>
  </AppShell>
</template>

<style scoped>
.pg-about { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-about__hero { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); text-align: center; }
.pg-about__name { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-about__tagline { color: var(--ink-2); font-size: var(--fs-15); line-height: 1.5; }
.pg-about__version { margin-top: var(--sp-1); color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); font-variant-numeric: tabular-nums; }
.pg-about__card { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-about__title { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-about__item { display: flex; gap: var(--sp-2); }
.pg-about__dot { flex: none; width: 6px; height: 6px; margin-top: 9px; border-radius: 50%; background: var(--accent); }
.pg-about__itemtext { min-width: 0; color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-about__sheet { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-about__sheettitle { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-about__error { color: var(--fox-text); font-size: var(--fs-13); line-height: 1.5; }
</style>
