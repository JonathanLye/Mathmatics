<script setup lang="ts">
/**
 * 第 4 层 · 自检（01 §L4 / 02 §4.3；#47 自适应接线）。
 *
 * - 由 components/selfcheck/adaptive.ts 根据服务端下发的 passed 记录决定「下一题」：
 *   没做过的题按维度顺序、答错的题隔 retryGap 道题后重试、每题 maxAttempts 封顶；
 * - UI 每次只显示自适应选出的那道题，并给出「先做下一题 / 稍后重试 / 再试一次」提示；
 * - 前端判对错吗？不判。passed 来自服务端 state 的记录（mock 由 submitSelfcheck reducer 写入）。
 * - 已通过的题折叠成只读回答，不合格时只追问一句、不给讲解、不给答案。
 */
import { computed, reactive } from 'vue'
import MathText from '@ui-math/MathText.vue'
import MathField from '@/components/practice/MathField.vue'
import PgButton from '@/components/ui/PgButton.vue'
import { nextSelfcheck, type AdaptiveDecision } from '@/components/selfcheck/adaptive'
import { adaptiveHint, selfcheckAdaptiveInput, selfcheckProgress } from '@/components/selfcheck/adaptView'
import type { ProofLine, SelfcheckItem, SelfcheckView } from '@/types/attempt'

const props = withDefaults(defineProps<{ reviewing?: boolean; view?: SelfcheckView | null; lines?: ProofLine[]; busy?: boolean }>(), {
  view: null,
  lines: () => [],
  busy: false,
})

const emit = defineEmits<{
  (e: 'submit', itemId: string, text: string): void
  (e: 'skip'): void
}>()

/** 每道题的草稿（提交前只在本机）。 */
const drafts = reactive<Record<string, string>>({})

const adaptive = computed(() => selfcheckAdaptiveInput(props.view))
const decision = computed<AdaptiveDecision>(() =>
  nextSelfcheck(adaptive.value.items, adaptive.value.records, adaptive.value.config),
)
const hint = computed(() => adaptiveHint(decision.value))
const progress = computed(() => selfcheckProgress(props.view, decision.value))
const items = computed(() => props.view?.items ?? [])
const current = computed<SelfcheckItem | null>(() => {
  if (!decision.value.nextItemId) return null
  return adaptive.value.byId[decision.value.nextItemId] ?? null
})
/** 第几题（学生看的序号，不显示内部 id）。 */
const currentNumber = computed(() => items.value.findIndex((item) => item.itemId === current.value?.itemId) + 1)
const passedItems = computed(() => items.value.filter((item) => item.status === 'accepted'))
const exhaustedCount = computed(() => progress.value.exhausted)
const canSubmit = computed(
  () => Boolean(current.value) && !props.busy && decision.value.action !== 'done' && (drafts[current.value!.itemId] ?? '').trim().length > 0,
)

function submit() {
  if (!canSubmit.value || !current.value) return
  emit('submit', current.value.itemId, (drafts[current.value.itemId] ?? '').trim())
}

function statusText(item: SelfcheckItem): string {
  if (item.status === 'accepted') return '已通过'
  if (item.status === 'followup') return '再补一句'
  return '待回答'
}
</script>

<template>
  <view class="pg-layer" data-testid="selfcheck-form">
    <view class="pg-layer__head">
      <text class="pg-layer__step pg-small" data-testid="selfcheck-progress">
        已通过 {{ progress.passed }} / {{ progress.total }}
        <template v-if="exhaustedCount > 0">（{{ exhaustedCount }} 题次数用尽）</template>
      </text>
    </view>
    <text class="pg-layer__hint pg-small">
      针对你自己写的证明回答。没答到点上不会给讲解，只会追问一句，稍后再回来试一次。
    </text>

    <view v-if="props.lines.length > 0" class="pg-check__proof pg-sheet" data-testid="selfcheck-proof">
      <text class="pg-check__prooflabel pg-small">你写的证明（只读）</text>
      <view v-for="line in props.lines" :key="line.lineId" class="pg-check__line">
        <text class="pg-check__no">{{ line.n }}</text>
        <view class="pg-check__body">
          <MathText :text="line.statement" block />
          <view class="pg-check__just pg-small">依据 <MathText :text="line.justification || '（未写）'" /></view>
        </view>
      </view>
    </view>

    <text class="pg-check__adaptive pg-small" :class="'pg-check__adaptive--' + hint.kind" data-testid="selfcheck-hint">
      {{ hint.text }}
    </text>

    <view v-if="current" class="pg-check__item pg-sheet" :data-testid="'selfcheck-item-' + current.itemId">
      <view class="pg-check__qhead">
        <text class="pg-check__qno">第 {{ currentNumber }} 题</text>
        <text
          class="pg-check__status pg-small"
          :class="'pg-check__status--' + current.status"
          :data-testid="'selfcheck-status-' + current.itemId"
        >{{ statusText(current) }}</text>
      </view>
      <MathText :text="current.question" serif block />
      <text v-if="decision.action === 'retry'" class="pg-check__followup pg-small" :data-testid="'selfcheck-retry-' + current.itemId">
        这题上次没通过（第 {{ decision.attemptNo }} 次作答）。再具体一点：这条依据是从哪一步、用什么运算得到的？
      </text>
      <MathField
        v-model="drafts[current.itemId]"
        :data-testid="'selfcheck-input-' + current.itemId"
        :maxlength="500"
        :disabled="props.busy"
        :min-rows="2"
        placeholder="写一句话回答……"
      />
      <view class="pg-pin">
        <PgButton block size="lg" :data-testid="'selfcheck-submit-' + current.itemId" sound="tap" :loading="props.busy" :disabled="!canSubmit" @tap="submit">
          {{ props.busy ? '提交中…' : decision.action === 'retry' ? '再提交一次' : '提交这一题' }}
        </PgButton>
      </view>
    </view>

    <view v-else-if="decision.action === 'done'" class="pg-check__done pg-sheet" data-testid="selfcheck-done">
      <text class="pg-check__donetitle">自检完成</text>
      <text class="pg-check__just pg-small">{{ hint.text }}，正在换一道题……</text>
    </view>

    <view v-if="passedItems.length > 0" class="pg-check__passed pg-sheet" data-testid="selfcheck-passed">
      <text class="pg-check__prooflabel pg-small">已通过的题</text>
      <view v-for="item in passedItems" :key="item.itemId" class="pg-check__passedrow" :data-testid="'selfcheck-answer-' + item.itemId">
        <MathText :text="item.question" block />
        <view class="pg-check__answer pg-small"><MathText :text="item.answer ?? ''" /></view>
      </view>
    </view>

    <PgButton v-if="!props.reviewing" variant="secondary" block data-testid="selfcheck-skip" :disabled="props.busy" @tap="emit('skip')">跳过自检</PgButton>
  </view>
</template>

<style scoped>
.pg-check__proof { padding: var(--sp-2) var(--sp-3); }
.pg-check__prooflabel { color: var(--ink-2); }
.pg-check__line { display: flex; gap: var(--sp-2); padding: var(--sp-1) 0; }
.pg-check__no { width: 20px; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-check__body { flex: 1; min-width: 0; }
.pg-check__just { color: var(--ink-2); }
.pg-check__adaptive {
  display: block;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink);
}
.pg-check__adaptive--wait { background: var(--bee-soft); }
.pg-check__adaptive--retry { background: var(--sea-soft); }
.pg-check__adaptive--done { background: var(--ok-soft); }
.pg-check__item { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-check__qhead { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.pg-check__qno { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-check__status { padding: 1px var(--sp-2); border-radius: var(--radius-pill); border: var(--bw) solid var(--rule); color: var(--ink-2); }
.pg-check__status--accepted { border-color: var(--ok); color: var(--ok-text); }
.pg-check__status--followup { border-color: var(--sea); color: var(--sea-text); }
.pg-check__followup { color: var(--sea-text); }
.pg-check__done { display: flex; flex-direction: column; gap: var(--sp-1); padding: var(--sp-3); }
.pg-check__donetitle { font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-check__passed { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); }
.pg-check__passedrow { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-1) 0; border-bottom: var(--bw) solid var(--rule); }
.pg-check__passedrow:last-child { border-bottom: 0; }
.pg-check__answer { color: var(--ink-2); }
</style>
