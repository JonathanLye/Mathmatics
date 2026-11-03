<script setup lang="ts">
/**
 * 我的证明本（01 §3 完成页 → 证明本；openapi GET /student/notebook）。
 *
 * 只读展示「自己写完的证明 + 总结 + 通过核验后的标准定义」；点卡片可回到该题。
 * P1 的「稍后重做」换片与导出见 #47，本轮先做只读列表。
 */
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import { fetchNotebook } from '@/api/client'
import type { NotebookCard, NotebookView } from '@/types/attempt'

const notebook = ref<NotebookView | null>(null)
const loading = ref(true)

onShow(async () => {
  loading.value = true
  notebook.value = await fetchNotebook()
  loading.value = false
})

const cards = () => notebook.value?.cards ?? []

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
      <text v-if="cards().length === 0" class="pg-book__empty pg-small">还没有完成的证明。做完一题后会自动进来。</text>
      <view v-for="card in cards()" :key="card.attemptId" class="pg-book__card pg-sheet" data-testid="notebook-card">
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
.pg-book__card { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); margin-bottom: var(--sp-3); }
.pg-book__ptitle { font-family: var(--font-serif); font-size: 16px; font-weight: 600; }
.pg-book__meta { color: var(--ink-2); }
.pg-book__section { display: flex; flex-direction: column; gap: 2px; padding-top: var(--sp-2); border-top: 1px dashed var(--rule); }
.pg-book__label { color: var(--ink-2); }
.pg-book__weak { color: var(--ink-2); }
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
