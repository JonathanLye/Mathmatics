<script setup lang="ts">
/**
 * 我的证明本（01 §3 完成页 → 证明本；openapi GET /student/notebook）。
 *
 * - 只读展示「自己写完的证明 + 总结 + 通过核验后的标准定义」；点卡片可回到该题；
 * - #47 接线：用 components/proofbook/redo.ts 的 listRedoable 渲染「稍后重做」分组
 *   （独立度分档、教师标记优先、近期完成冷却），点「开始重做」发起新作答（mock 跨页交接，真接口 #24）。
 * P1 的「稍后重做」换片与导出见 #47/#74；本轮只接入口。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import { fetchNotebook, startRedo } from '@/api/client'
import { setPendingAttempt } from '@/stores/attempt'
import { buildRedoList, levelLabel, REDO_OPTIONS } from '@/components/proofbook/redoInput'
import type { RedoEntry } from '@/components/proofbook/redo'
import type { NotebookCard, NotebookView } from '@/types/attempt'

const notebook = ref<NotebookView | null>(null)
const loading = ref(true)
const startingRedo = ref(false)

onShow(async () => {
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

function independenceText(entry: RedoEntry): string {
  if (entry.independence === null) return '独立度 —'
  return '独立度 ' + entry.independence.toFixed(2) + ' · ' + levelLabel(entry.independence)
}

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}
</script>

<template>
  <view class="pg-page pg-book">
    <view class="pg-book__head">
      <button class="pg-book__back pg-tap" role="button" data-testid="notebook-back" @tap="back">‹</button>
      <text class="pg-book__title">我的证明本</text>
    </view>
    <text class="pg-book__hint pg-small">自己写完的证明与总结（只读）。点「回到该题」可以再看一遍。</text>

    <view v-if="loading" class="pg-book__skeleton pg-sheet">
      <view class="pg-book__line" /><view class="pg-book__line" /><view class="pg-book__line" />
    </view>

    <template v-else>
      <!-- #47：稍后重做（独立度分档 / 教师标记优先 / 冷却期） -->
      <view class="pg-book__redo pg-sheet" data-testid="redo-list">
        <view class="pg-book__redohead">
          <text class="pg-book__sectiontitle">稍后重做</text>
          <text class="pg-book__redocount pg-small">{{ redoList.total }} 题</text>
        </view>
        <text class="pg-book__redohint pg-small">
          独立度越低越该重做；老师标记的排最前。最近 {{ REDO_OPTIONS.cooldownDays }} 天内做完的先不进列表。
        </text>
        <text v-if="redoList.skippedRecent > 0" class="pg-book__redoskip pg-small" data-testid="redo-skipped">
          有 {{ redoList.skippedRecent }} 道最近完成的题，过冷却期后再推荐。
        </text>
        <text v-if="redoList.redoable.length === 0" class="pg-book__empty pg-small" data-testid="redo-empty">
          暂时没有需要重做的题。等独立度回落后会出现在这里。
        </text>
        <view v-for="(entry, index) in redoList.redoable" :key="entry.sourceAttemptId" class="pg-book__redoitem" :data-testid="'redo-item-' + index">
          <view class="pg-book__redomain">
            <text class="pg-book__redotitle">{{ entry.title }}</text>
            <text class="pg-book__redometa pg-small">{{ independenceText(entry) }} · 完成于 {{ fmtDate(entry.completedAt) }}</text>
            <text class="pg-book__redoreason pg-small">{{ entry.reason }}</text>
          </view>
          <button
            class="pg-book__redoopen"
            role="button"
            :data-testid="'redo-start-' + index"
            :disabled="startingRedo"
            @tap="startRedoEntry(entry)"
          >
            开始重做
          </button>
        </view>
      </view>

      <text class="pg-book__subtitle">全部证明</text>
      <text v-if="cards.length === 0" class="pg-book__empty pg-small">还没有完成的证明。做完一题后会自动进来。</text>
      <view v-for="card in cards" :key="card.attemptId" class="pg-book__card pg-sheet" data-testid="notebook-card">
        <text class="pg-book__ptitle">{{ card.title }}</text>
        <text class="pg-book__meta pg-small">
          完成于 {{ fmtDate(card.completedAt) }} · 证明 {{ card.proof?.length ?? 0 }} 行 · 总结 {{ card.summary?.length ?? 0 }} 条
        </text>

        <view v-if="card.summary?.length" class="pg-book__section">
          <text class="pg-book__label pg-small">我的总结</text>
          <MathText v-for="(answer, i) in card.summary" :key="'s' + i" :text="answer" block />
        </view>
        <view v-if="card.definition" class="pg-book__section">
          <text class="pg-book__label pg-small">标准定义（通过核验后展示）</text>
          <MathText :text="card.definition" serif block />
        </view>
        <view v-if="card.weakPoints?.length" class="pg-book__section">
          <text class="pg-book__label pg-small">下次注意</text>
          <MathText v-for="(point, i) in card.weakPoints" :key="'w' + i" :text="point" block />
        </view>

        <button class="pg-book__open" role="button" data-testid="notebook-open" @tap="openCard(card)">回到该题</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.pg-book { padding-top: calc(var(--safe-top) + var(--sp-2)); padding-bottom: calc(var(--sp-6) + var(--safe-bottom)); }
.pg-book__head { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.pg-book__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-height: 44px;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 26px;
  line-height: 1;
}
.pg-book__back::after { border: 0; }
.pg-book__title { font-family: var(--font-serif); font-size: 20px; font-weight: 600; }
.pg-book__hint { display: block; margin-bottom: var(--sp-3); color: var(--ink-2); }
.pg-book__empty { display: block; color: var(--ink-2); }
.pg-book__subtitle { display: block; margin: var(--sp-3) 0 var(--sp-2); font-family: var(--font-serif); font-size: 16px; font-weight: 600; }
.pg-book__redo { padding: var(--sp-3); margin-bottom: var(--sp-2); }
.pg-book__redohead { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-book__sectiontitle { font-family: var(--font-serif); font-size: 16px; font-weight: 600; }
.pg-book__redocount { color: var(--ink-2); }
.pg-book__redohint { display: block; margin-top: 2px; color: var(--ink-2); }
.pg-book__redoskip { display: block; margin-top: 2px; color: var(--hint); }
.pg-book__redoitem { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) 0; border-top: 1px dashed var(--rule); }
.pg-book__redomain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pg-book__redotitle { font-size: 15px; color: var(--ink); }
.pg-book__redometa { color: var(--ink-2); }
.pg-book__redoreason { color: var(--margin); }
.pg-book__redoopen {
  flex: 0 0 auto;
  min-height: 40px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--accent);
  font-size: 14px;
}
.pg-book__card { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); margin-bottom: var(--sp-3); }
.pg-book__ptitle { font-family: var(--font-serif); font-size: 16px; font-weight: 600; }
.pg-book__meta { color: var(--ink-2); }
.pg-book__section { display: flex; flex-direction: column; gap: 2px; padding-top: var(--sp-2); border-top: 1px dashed var(--rule); }
.pg-book__label { color: var(--ink-2); }
.pg-book__open {
  margin-top: var(--sp-2);
  min-height: 44px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--accent);
  font-size: 15px;
}
.pg-book__skeleton { padding: var(--sp-3); }
.pg-book__line { height: 16px; border-radius: 4px; background: var(--paper); margin: var(--sp-2) 0; }
</style>
