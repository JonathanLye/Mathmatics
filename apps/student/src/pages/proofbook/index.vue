<script setup lang="ts">
/**
 * 证明本（GET /student/notebook）：写完的证明自动收录，点开看详情。
 * “稍后重做”用 components/proofbook/redo.ts 分档（独立度、教师标记、近期完成冷却）；点开始重做走真实重做接口。
 * 加载中骨架、失败可重试，不会永远转圈；没有内容时给一个去写第一道的入口。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import { errorMessage, fetchNotebook, startRedo } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import TagChip from '@/components/TagChip.vue'
import { applyApiOverride, openPractice } from '@/components/path/openPractice'
import type { RedoEntry } from '@/components/proofbook/redo'
import { REDO_OPTIONS, buildRedoList, redoIndependenceText } from '@/components/proofbook/redoInput'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { useToast } from '@/components/ui/useToast'
import { BOOK_COPY, independenceCopy } from '@/copy'
import type { NotebookCard, NotebookView } from '@/types/attempt'
import { formatDate } from '@/utils/date'

const toast = useToast()
const notebook = ref<NotebookView | null>(null)
const loading = ref(true)
const error = ref('')
const startingRedo = ref(false)
/** 从路径、完成页压栈进来才有返回；底部标签切换进来没有上一页。 */
const canGoBack = ref(false)

onLoad((q) => {
  applyApiOverride(q)
})

onShow(() => {
  canGoBack.value = getCurrentPages().length > 1
  void load()
})

async function load(): Promise<void> {
  if (!notebook.value) loading.value = true
  error.value = ''
  try {
    notebook.value = await fetchNotebook()
  } catch (e) {
    notebook.value = null
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

const cards = computed(() => notebook.value?.cards ?? [])
const redoList = computed(() => buildRedoList(cards.value))

function back(): void {
  uni.navigateBack()
}

function goPath(): void {
  uni.reLaunch({ url: '/pages/home/index' })
}

/** 讲评已发布的直接滚到讲评。 */
function openCard(card: NotebookCard): void {
  const section = card.reviewPublished ? '&section=review' : ''
  uni.navigateTo({ url: '/pages/proof-detail/index?attemptId=' + encodeURIComponent(card.attemptId) + section })
}

function cardStats(card: NotebookCard): string {
  const lines = card.lines?.length ?? card.proof?.length ?? 0
  const own = typeof card.independence === 'number' && card.keysTotal ? independenceCopy(Math.round(card.independence * card.keysTotal), card.keysTotal) : ''
  return [BOOK_COPY.lines(lines), own].filter(Boolean).join(' · ')
}

async function startRedoEntry(entry: RedoEntry): Promise<void> {
  if (startingRedo.value) return
  startingRedo.value = true
  try {
    openPractice(await startRedo(entry.sourceAttemptId), 'redo')
  } catch (e) {
    toast.show(errorMessage(e), { tone: 'warn' })
  } finally {
    startingRedo.value = false
  }
}
</script>

<template>
  <AppShell active="proofbook">
    <view class="pg-book" data-testid="notebook-page">
      <view class="pg-book__head">
        <PgButton v-if="canGoBack" variant="ghost" size="icon" aria-label="返回" data-testid="notebook-back" @tap="back"><PgIcon name="back" :size="26" /></PgButton>
        <view class="pg-book__heading">
          <view class="pg-book__titlerow">
            <text class="pg-book__title">{{ BOOK_COPY.title }}</text>
            <text v-if="cards.length" class="pg-book__count" data-testid="notebook-count">{{ BOOK_COPY.count(cards.length) }}</text>
          </view>
          <text class="pg-book__hint">{{ BOOK_COPY.hint }}</text>
        </view>
      </view>

      <view v-if="loading" class="pg-book__list" data-testid="notebook-loading" aria-busy="true">
        <PgSkeleton variant="block" :count="3" />
      </view>

      <view v-else-if="error" data-testid="notebook-error" role="alert">
        <PgEmpty :title="BOOK_COPY.loadFailedTitle" :body="error" expr="oops" :motion="null" :size="88" action="重试" action-testid="notebook-retry" @action="load" />
      </view>

      <view v-else-if="cards.length === 0" data-testid="notebook-empty">
        <PgEmpty :title="BOOK_COPY.emptyTitle" :body="BOOK_COPY.emptyBody" expr="happy" :motion="['breathe', 'blink']" :action="BOOK_COPY.emptyAction" action-testid="notebook-to-path" @action="goPath" />
      </view>

      <template v-else>
        <PgCard class="pg-book__redo" data-testid="redo-list">
          <view class="pg-book__redohead">
            <text class="pg-book__sectiontitle">{{ BOOK_COPY.redoTitle }}</text>
            <text class="pg-book__muted">{{ redoList.total }} 题</text>
          </view>
          <text class="pg-book__muted">{{ BOOK_COPY.redoHint(REDO_OPTIONS.cooldownDays ?? 2) }}</text>
          <text v-if="redoList.skippedRecent > 0" class="pg-book__redoskip" data-testid="redo-skipped">{{ BOOK_COPY.redoSkipped(redoList.skippedRecent) }}</text>
          <text v-if="redoList.redoable.length === 0" class="pg-book__muted" data-testid="redo-empty">{{ BOOK_COPY.redoEmpty }}</text>
          <view v-for="(entry, index) in redoList.redoable" :key="entry.sourceAttemptId" class="pg-book__redoitem" :data-testid="'redo-item-' + index">
            <view class="pg-book__redomain">
              <MathText class="pg-book__redotitle" :text="entry.title" />
              <text class="pg-book__muted">{{ redoIndependenceText(entry) }} · <text class="pg-book__nowrap">完成于 {{ formatDate(entry.completedAt) }}</text></text>
              <text class="pg-book__redoreason">{{ entry.reason }}</text>
            </view>
            <PgButton variant="secondary" size="sm" sound="tap" :data-testid="'redo-start-' + index" :disabled="startingRedo" @tap="startRedoEntry(entry)">{{ BOOK_COPY.redoStart }}</PgButton>
          </view>
        </PgCard>

        <text class="pg-book__sectiontitle pg-book__all">{{ BOOK_COPY.allProofs }}</text>
        <view class="pg-book__list pg-stagger">
          <PgCard
            v-for="card in cards"
            :key="card.attemptId"
            class="pg-book__card"
            lip
            role="button"
            tabindex="0"
            :aria-label="BOOK_COPY.open + ' ' + card.title"
            data-testid="notebook-card"
            :data-attempt-id="card.attemptId"
            @tap="openCard(card)"
            @keydown.enter.prevent="openCard(card)"
          >
            <view class="pg-book__stamp" aria-hidden="true"><PgIcon name="qed" :size="18" /></view>
            <view class="pg-book__cardmain">
              <view v-if="card.reviewPublished || card.kind === 'redo'" class="pg-book__tags">
                <TagChip v-if="card.reviewPublished" tone="sea" data-testid="notebook-review-tag">{{ BOOK_COPY.reviewPublished }}</TagChip>
                <TagChip v-if="card.kind === 'redo'" tone="accent">{{ BOOK_COPY.redoTag }}</TagChip>
              </view>
              <MathText class="pg-book__ptitle" :text="card.title" />
              <text class="pg-book__muted"><text v-if="card.chapter">{{ card.chapter }} · </text><text v-if="card.completedAt" class="pg-book__nowrap">{{ BOOK_COPY.completedAt(formatDate(card.completedAt)) }}</text></text>
              <text class="pg-book__muted" data-testid="notebook-stats">{{ cardStats(card) }}</text>
            </view>
            <view class="pg-book__open" data-testid="notebook-open"><PgIcon name="chevron" :size="20" /></view>
          </PgCard>
        </view>
      </template>
    </view>
  </AppShell>
</template>

<style scoped>
.pg-book { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-book__head { display: flex; align-items: flex-start; gap: var(--sp-1); }
.pg-book__heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-book__titlerow { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-book__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-book__count { flex: none; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-book__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-book__muted { display: block; color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-book__all { margin-top: var(--sp-2); }
.pg-book__list { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-book__redo { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-book__redohead { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-book__sectiontitle { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-book__redoskip { color: var(--bee-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-book__redoitem { display: flex; align-items: center; gap: var(--sp-3); padding-top: var(--sp-3); margin-top: var(--sp-1); border-top: var(--bw) solid var(--rule); }
.pg-book__redomain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-book__redotitle { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); }
.pg-book__redoreason { color: var(--sea-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-book__nowrap { white-space: nowrap; }
.pg-book__card { display: flex; align-items: center; gap: var(--sp-3); cursor: pointer; transition: transform var(--dur-base) var(--ease-spring); }
.pg-book__card:active { transform: translateY(2px); transition-duration: var(--dur-fast); }
.pg-book__stamp { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-12); background: var(--bee-soft); color: var(--bee-lip); }
.pg-book__cardmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-book__tags { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-bottom: 2px; }
.pg-book__ptitle { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); line-height: 1.35; overflow-wrap: anywhere; }
.pg-book__open { flex: none; width: var(--touch); height: var(--touch); margin-right: calc(var(--sp-2) * -1); display: flex; align-items: center; justify-content: center; color: var(--ink-2); }
</style>
