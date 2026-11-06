<script setup lang="ts">
/**
 * 我的证明本（01 §3 完成页 → 证明本；openapi GET /student/notebook）。
 *
 * - 只读展示「自己写完的证明 + 总结 + 通过核验后的标准定义」；点卡片可回到该题；
 * - #47 接线：用 components/proofbook/redo.ts 的 listRedoable 渲染「稍后重做」分组
 *   （独立度分档、教师标记优先、近期完成冷却），点「开始重做」发起新作答（mock 跨页交接，真接口 #24）。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import AppShell from '@/components/AppShell.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { fetchNotebook, startRedo } from '@/api/client'
import { setPendingAttempt } from '@/stores/attempt'
import { buildRedoList, redoIndependenceText, REDO_OPTIONS } from '@/components/proofbook/redoInput'
import type { RedoEntry } from '@/components/proofbook/redo'
import type { NotebookCard, NotebookView } from '@/types/attempt'
import { formatDate } from '@/utils/date'

const notebook = ref<NotebookView | null>(null)
const loading = ref(true)
const startingRedo = ref(false)
/** 从首页“查看”压栈进来才有返回；底部标签切换进来没有上一页。 */
const canGoBack = ref(false)

onShow(async () => {
  canGoBack.value = getCurrentPages().length > 1
  loading.value = true
  notebook.value = await fetchNotebook()
  loading.value = false
})

const cards = computed(() => notebook.value?.cards ?? [])
const redoList = computed(() => buildRedoList(cards.value))

function back() {
  uni.navigateBack()
}

/** 回到该题（mock：用卡片上的 mock 键打开对应状态；真实接口用 attemptId 拉取，#24）。 */
function openCard(card: NotebookCard) {
  if (card.mock) {
    uni.navigateTo({ url: '/pages/practice/index?mock=' + card.mock })
    return
  }
  uni.navigateTo({ url: '/pages/practice/index' })
}

/** 「稍后重做」：mock 发起新作答（服务端返回新 state）→ 暂存 → 跳做题页。 */
async function startRedoEntry(entry: RedoEntry) {
  if (startingRedo.value) return
  startingRedo.value = true
  try {
    const next = await startRedo(entry.sourceAttemptId)
    setPendingAttempt(next)
    uni.navigateTo({ url: '/pages/practice/index?from=redo' })
  } finally {
    startingRedo.value = false
  }
}
</script>

<template>
  <AppShell active="proofbook">
    <view class="pg-book">
      <view class="pg-book__head">
        <PgButton v-if="canGoBack" variant="ghost" size="icon" aria-label="返回" data-testid="notebook-back" @tap="back"><PgIcon name="back" :size="26" /></PgButton>
        <text class="pg-book__title">我的证明本</text>
      </view>
      <text class="pg-book__hint">自己写完的证明与总结（只读）。点「回到该题」可以再看一遍。</text>

      <PgCard v-if="loading"><PgSkeleton :count="3" /></PgCard>

      <template v-else>
        <!-- #47：稍后重做（独立度分档 / 教师标记优先 / 冷却期） -->
        <PgCard class="pg-book__redo" data-testid="redo-list">
          <view class="pg-book__redohead">
            <text class="pg-book__sectiontitle">稍后重做</text>
            <text class="pg-book__redocount">{{ redoList.total }} 题</text>
          </view>
          <text class="pg-book__muted">靠提示多的题最值得再写一遍；老师标记的排最前。最近 {{ REDO_OPTIONS.cooldownDays }} 天内做完的先不进列表。</text>
          <text v-if="redoList.skippedRecent > 0" class="pg-book__redoskip" data-testid="redo-skipped">有 {{ redoList.skippedRecent }} 道最近完成的题，过几天再推荐。</text>
          <text v-if="redoList.redoable.length === 0" class="pg-book__muted" data-testid="redo-empty">暂时没有需要重做的题。</text>
          <view v-for="(entry, index) in redoList.redoable" :key="entry.sourceAttemptId" class="pg-book__redoitem" :data-testid="'redo-item-' + index">
            <view class="pg-book__redomain">
              <MathText class="pg-book__redotitle" :text="entry.title" />
              <text class="pg-book__muted">{{ redoIndependenceText(entry) }} · 完成于 {{ formatDate(entry.completedAt) }}</text>
              <text class="pg-book__redoreason">{{ entry.reason }}</text>
            </view>
            <PgButton variant="secondary" size="sm" :data-testid="'redo-start-' + index" :disabled="startingRedo" @tap="startRedoEntry(entry)">开始重做</PgButton>
          </view>
        </PgCard>

        <text class="pg-book__sectiontitle pg-book__subtitle">全部证明</text>
        <PgEmpty v-if="cards.length === 0" title="证明本还是空的" body="做完一题后，证明会自动收进来。" />
        <PgCard v-for="card in cards" :key="card.attemptId" class="pg-book__card" data-testid="notebook-card">
          <MathText class="pg-book__ptitle" :text="card.title" />
          <text class="pg-book__muted">完成于 {{ formatDate(card.completedAt) }} · 证明 {{ card.proof?.length ?? 0 }} 行 · 总结 {{ card.summary?.length ?? 0 }} 条</text>

          <view v-if="card.summary?.length" class="pg-book__section">
            <text class="pg-book__label">我的总结</text>
            <MathText v-for="(answer, i) in card.summary" :key="'s' + i" :text="answer" block />
          </view>
          <view v-if="card.definition" class="pg-book__section">
            <text class="pg-book__label">标准定义（通过核验后展示）</text>
            <MathText :text="card.definition" serif block />
          </view>
          <view v-if="card.weakPoints?.length" class="pg-book__section">
            <text class="pg-book__label">下次注意</text>
            <MathText v-for="(point, i) in card.weakPoints" :key="'w' + i" :text="point" block />
          </view>

          <PgButton variant="secondary" block data-testid="notebook-open" @tap="openCard(card)">回到该题</PgButton>
        </PgCard>
      </template>
    </view>
  </AppShell>
</template>

<style scoped>
.pg-book { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-book__head { display: flex; align-items: center; gap: var(--sp-1); min-height: var(--touch); }
.pg-book__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-book__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-book__muted { display: block; color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-book__subtitle { margin-top: var(--sp-3); }
.pg-book__redo { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-book__redohead { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-book__sectiontitle { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-book__redocount { color: var(--ink-2); font-size: var(--fs-13); }
.pg-book__redoskip { color: var(--bee-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-book__redoitem { display: flex; align-items: center; gap: var(--sp-3); padding-top: var(--sp-3); margin-top: var(--sp-1); border-top: var(--bw) solid var(--rule); }
.pg-book__redomain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-book__redotitle { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); }
.pg-book__redoreason { color: var(--sea-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-book__card { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-book__ptitle { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-book__section { display: flex; flex-direction: column; gap: var(--sp-1); padding-top: var(--sp-2); border-top: var(--bw) solid var(--rule); }
.pg-book__label { color: var(--ink-2); font-size: var(--fs-12); }
</style>
