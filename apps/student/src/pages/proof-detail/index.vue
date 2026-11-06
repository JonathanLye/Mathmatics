<script setup lang="ts">
/**
 * 证明详情（只读）：自己写的证明、总结、通过核验后的标准定义、老师讲评（真实 GET /attempts/{id}/review）。
 * 可以打印或存 PDF：@media print 把导航和按钮都藏起来，只留一张干净的纸。
 * 讲评没发布时接口返回 403：只说“发布后会出现”，不当成错误。
 */
import { computed, nextTick, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import { errorMessage, fetchNotebook, getAttemptReview, isApiError } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import { applyApiOverride } from '@/components/path/openPractice'
import PgButton from '@/components/ui/PgButton.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { BOOK_COPY, COPY, DETAIL_COPY, independenceCopy } from '@/copy'
import type { NotebookCard, PublishedReview } from '@/types/attempt'
import { formatDate } from '@/utils/date'

const card = ref<NotebookCard | null>(null)
const review = ref<PublishedReview | null>(null)
const reviewLoading = ref(false)
const reviewFailed = ref(false)
const loading = ref(true)
const error = ref('')
const notFound = ref(false)
let attemptId = ''
let focusReview = false

onLoad((q) => {
  applyApiOverride(q)
  attemptId = typeof q?.attemptId === 'string' ? decodeURIComponent(q.attemptId) : ''
  focusReview = q?.section === 'review'
  void load()
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  notFound.value = false
  try {
    const book = await fetchNotebook()
    card.value = book.cards.find((entry) => entry.attemptId === attemptId) ?? null
    notFound.value = card.value === null
    if (card.value) void loadReview()
  } catch (e) {
    card.value = null
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

/**
 * 自学题做完就有讲评，教师布置要等发布；能不能看由接口说了算。
 * 403 / 404 表示还没有；其他失败（断网、服务端出错）要说实话，给一个重试。
 */
async function loadReview(): Promise<void> {
  reviewLoading.value = true
  reviewFailed.value = false
  try {
    review.value = await getAttemptReview(attemptId)
    if (focusReview) {
      void nextTick(() => document.querySelector('[data-testid="proof-detail-review"]')?.scrollIntoView({ block: 'start' }))
    }
  } catch (e) {
    review.value = null
    const notYet = isApiError(e) && (e.status === 403 || e.status === 404)
    reviewFailed.value = !notYet
  } finally {
    reviewLoading.value = false
  }
}

/** 证明行：优先带行号和依据的 lines，旧数据只有 proof 文本。 */
const lines = computed(() => {
  const value = card.value
  if (!value) return []
  if (value.lines?.length) return value.lines
  return (value.proof ?? []).map((statement, i) => ({ n: i + 1, statement, justification: undefined as string | undefined }))
})

const meta = computed(() => {
  const value = card.value
  if (!value) return ''
  const own = typeof value.independence === 'number' && value.keysTotal ? independenceCopy(Math.round(value.independence * value.keysTotal), value.keysTotal) : ''
  return [value.chapter, value.completedAt ? BOOK_COPY.completedAt(formatDate(value.completedAt)) : '', own].filter(Boolean).join(' · ')
})

const teacherNote = computed(() => review.value?.note ?? card.value?.teacherNote ?? '')
const hasReview = computed(() => Boolean(teacherNote.value) || Boolean(review.value?.proofs?.length))

function back(): void {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/proofbook/index' })
}

function print(): void {
  if (typeof window !== 'undefined') window.print()
}
</script>

<template>
  <AppShell active="proofbook">
    <view class="pg-detail" data-testid="proof-detail-page">
      <view class="pg-detail__bar pg-detail__chrome">
        <PgButton variant="ghost" size="icon" :aria-label="DETAIL_COPY.back" data-testid="proof-detail-back" @tap="back"><PgIcon name="back" :size="26" /></PgButton>
        <text class="pg-detail__bartitle">{{ DETAIL_COPY.title }}</text>
        <PgButton v-if="card" class="pg-detail__print" variant="secondary" size="sm" sound="tap" data-testid="proof-detail-print" @tap="print">{{ DETAIL_COPY.print }}</PgButton>
      </view>

      <view v-if="loading" class="pg-detail__sheet" data-testid="proof-detail-loading" aria-busy="true">
        <PgSkeleton :count="6" />
      </view>

      <view v-else-if="error" data-testid="proof-detail-error" role="alert">
        <PgEmpty :title="DETAIL_COPY.loadFailedTitle" :body="error" expr="oops" :motion="null" :size="88" action="重试" action-testid="proof-detail-retry" @action="load" />
      </view>

      <view v-else-if="notFound" data-testid="proof-detail-notfound">
        <PgEmpty :title="DETAIL_COPY.notFoundTitle" :body="DETAIL_COPY.notFoundBody" expr="think" :motion="['think-tilt', 'blink']" :action="DETAIL_COPY.notFoundAction" action-testid="proof-detail-to-book" @action="back" />
      </view>

      <template v-else-if="card">
        <!-- 一张纸：题目 + 证明 + ∎ -->
        <view class="pg-detail__sheet">
          <MathText class="pg-detail__title" :text="card.title" data-testid="proof-detail-title" />
          <text v-if="meta" class="pg-detail__meta">{{ meta }}</text>

          <text class="pg-detail__section">{{ DETAIL_COPY.proof }}</text>
          <view v-if="lines.length" class="pg-detail__lines" data-testid="proof-detail-lines">
            <view v-for="line in lines" :key="line.n" class="pg-detail__line" data-testid="proof-line">
              <text class="pg-detail__lineno">{{ line.n }}</text>
              <view class="pg-detail__linebody">
                <MathText class="pg-detail__statement" :text="line.statement" block serif />
                <MathText v-if="line.justification" class="pg-detail__basis" :text="'依据：' + line.justification" block />
              </view>
            </view>
            <view class="pg-detail__qed" aria-hidden="true"><PgIcon name="qed" :size="20" /></view>
          </view>
          <text v-else class="pg-detail__muted">{{ DETAIL_COPY.noLines }}</text>
          <text class="pg-detail__honest">{{ COPY.honestNote }}</text>
        </view>

        <view v-if="card.summary?.length" class="pg-detail__sheet" data-testid="proof-detail-summary">
          <text class="pg-detail__section">{{ DETAIL_COPY.summary }}</text>
          <MathText v-for="(answer, i) in card.summary" :key="'s' + i" class="pg-detail__text" :text="answer" block />
        </view>

        <view v-if="card.definition" class="pg-detail__sheet" data-testid="proof-detail-definition">
          <view class="pg-detail__sectionrow">
            <text class="pg-detail__section">{{ DETAIL_COPY.definition }}</text>
            <text class="pg-detail__sectionnote">{{ DETAIL_COPY.definitionNote }}</text>
          </view>
          <MathText class="pg-detail__text" :text="card.definition" block serif />
        </view>

        <view class="pg-detail__sheet pg-detail__sheet--review" :class="{ 'pg-detail__chrome': !hasReview }" data-testid="proof-detail-review">
          <text class="pg-detail__section">{{ DETAIL_COPY.review }}</text>
          <PgSkeleton v-if="reviewLoading" :count="2" />
          <template v-else-if="hasReview">
            <MathText v-if="teacherNote" class="pg-detail__text" :text="teacherNote" block data-testid="proof-detail-note" />
            <template v-if="review?.proofs?.length">
              <text class="pg-detail__sublabel">{{ DETAIL_COPY.reference }}</text>
              <MathText v-for="(proof, i) in review.proofs" :key="'r' + i" class="pg-detail__text" :text="proof" block serif data-testid="proof-detail-reference" />
            </template>
          </template>
          <view v-else-if="reviewFailed" class="pg-detail__reviewfail" data-testid="proof-detail-review-error" role="alert">
            <text class="pg-detail__muted">{{ DETAIL_COPY.reviewFailed }}</text>
            <PgButton variant="secondary" size="sm" data-testid="proof-detail-review-retry" @tap="loadReview">重试</PgButton>
          </view>
          <text v-else class="pg-detail__muted" data-testid="proof-detail-review-pending">{{ DETAIL_COPY.reviewPending }}</text>
        </view>

        <view v-if="card.weakPoints?.length" class="pg-detail__sheet" data-testid="proof-detail-weak">
          <text class="pg-detail__section">{{ DETAIL_COPY.weakPoints }}</text>
          <MathText v-for="(point, i) in card.weakPoints" :key="'w' + i" class="pg-detail__text" :text="point" block />
        </view>
      </template>
    </view>
  </AppShell>
</template>

<style scoped>
.pg-detail { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-detail__bar { display: flex; align-items: center; gap: var(--sp-1); min-height: var(--touch); }
.pg-detail__bartitle { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-detail__print { flex: none; }
.pg-detail__sheet { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; padding: var(--sp-4); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); background: var(--sheet); }
.pg-detail__sheet--review { border-color: var(--sea); background: var(--sea-soft); }
.pg-detail__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); overflow-wrap: anywhere; }
.pg-detail__meta { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); line-height: 1.5; }
.pg-detail__section { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-detail__sheet--review .pg-detail__section { color: var(--sea-text); }
.pg-detail__sublabel { margin-top: var(--sp-2); color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pg-detail__sheet > .pg-detail__section:not(:first-child) { margin-top: var(--sp-3); }
.pg-detail__lines { display: flex; flex-direction: column; }
.pg-detail__line { display: flex; gap: var(--sp-3); padding: var(--sp-2) 0; border-top: 1px solid var(--rule); }
.pg-detail__line:first-child { border-top: 0; }
.pg-detail__lineno { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; margin-top: 2px; border-radius: 50%; background: var(--paper-2); color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; }
.pg-detail__linebody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-detail__statement { color: var(--ink); font-size: var(--fs-16); line-height: var(--lh-body); }
.pg-detail__basis { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-detail__qed { display: flex; justify-content: flex-end; padding-top: var(--sp-1); color: var(--bee-lip); }
.pg-detail__honest { margin-top: var(--sp-1); color: var(--ink-2); font-size: var(--fs-12); line-height: 1.5; }
.pg-detail__text { min-width: 0; color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-detail__muted { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-detail__sectionrow { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-detail__sectionnote { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
.pg-detail__reviewfail { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
</style>

<!-- 打印：只留纸面。外壳的类名在别的组件里，scoped 够不着，所以这一段不加 scoped。打印总是白纸黑字，不管当前主题。 -->
<style>
@media print {
  :root,
  :root:not([data-theme='light']),
  html[data-theme='dark'] {
    --paper: white;
    --paper-2: white;
    --sheet: white;
    --ink: black;
    --ink-2: #444444;
    --rule: #bbbbbb;
    --sea-soft: white;
    --sea: #bbbbbb;
    --sea-text: black;
    color-scheme: light;
  }
  .pg-tabbar,
  .pg-shell__rail,
  .pg-detail__chrome,
  .pg-offline,
  .pg-shell__offline { display: none !important; }
  .pg-shell__body { margin-left: 0 !important; }
  .pg-shell__main { max-width: none !important; padding: 0 !important; animation: none !important; }
  .pg-detail__sheet { border: 0 !important; padding: 0 0 16pt !important; break-inside: avoid; }
  .pg-detail__line { break-inside: avoid; }
}
</style>
