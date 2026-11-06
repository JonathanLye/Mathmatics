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
import { nextSelfcheck, type AdaptiveDecision } from '@/components/selfcheck/adaptive'
import { adaptiveHint, selfcheckAdaptiveInput, selfcheckProgress } from '@/components/selfcheck/adaptView'
import type { ProofLine, SelfcheckItem, SelfcheckView } from '@/types/attempt'

const props = withDefaults(defineProps<{ view?: SelfcheckView | null; lines?: ProofLine[]; busy?: boolean }>(), {
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
      <text class="pg-layer__title">第 4 层 · 自检</text>
      <text class="pg-layer__step pg-small" data-testid="selfcheck-progress">
        已通过 {{ progress.passed }} / {{ progress.total }}
        <template v-if="exhaustedCount > 0">（{{ exhaustedCount }} 题次数用尽）</template>
      </text>
    </view>
    <text class="pg-layer__hint pg-small">
      针对你自己写的证明回答。答错不会给讲解，只会追问一句；系统会按维度挑题，答错的题稍后再回来重试。
    </text>

    <view v-if="props.lines.length > 0" class="pg-check__proof pg-sheet" data-testid="selfcheck-proof">
      <text class="pg-check__prooflabel pg-small">你写的证明（只读）</text>
      <view v-for="line in props.lines" :key="line.lineId" class="pg-check__line">
        <text class="pg-check__no pg-mono">{{ line.n }}</text>
        <view class="pg-check__body">
          <MathText :text="line.statement" block />
          <text class="pg-check__just pg-small">依据 {{ line.justification || '（未写）' }}</text>
        </view>
      </view>
    </view>

    <text class="pg-check__adaptive pg-small" :class="'pg-check__adaptive--' + hint.kind" data-testid="selfcheck-hint">
      {{ hint.text }}
    </text>

    <view v-if="current" class="pg-check__item pg-sheet" :data-testid="'selfcheck-item-' + current.itemId">
      <view class="pg-check__qhead">
        <text class="pg-check__qno pg-mono">{{ current.itemId }}</text>
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
      <textarea
        v-model="drafts[current.itemId]"
        class="pg-layer__input"
        :data-testid="'selfcheck-input-' + current.itemId"
        :maxlength="500"
        :disabled="props.busy"
        placeholder="写一句话回答……"
        placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
      />
      <button
        class="pg-layer__btn pg-layer__btn--primary"
        role="button"
        :data-testid="'selfcheck-submit-' + current.itemId"
        :disabled="!canSubmit"
        @tap="submit"
      >
        {{ props.busy ? '提交中…' : decision.action === 'retry' ? '再提交一次' : '提交这一题' }}
      </button>
    </view>

    <view v-else-if="decision.action === 'done'" class="pg-check__done pg-sheet" data-testid="selfcheck-done">
      <text class="pg-check__donetitle">自检完成</text>
      <text class="pg-check__just pg-small">{{ hint.text }}，正在进入迁移题……</text>
    </view>

    <view v-if="passedItems.length > 0" class="pg-check__passed pg-sheet" data-testid="selfcheck-passed">
      <text class="pg-check__prooflabel pg-small">已通过的题</text>
      <view v-for="item in passedItems" :key="item.itemId" class="pg-check__passedrow" :data-testid="'selfcheck-answer-' + item.itemId">
        <MathText :text="item.question" block />
        <text class="pg-check__answer pg-small">{{ item.answer }}</text>
      </view>
    </view>

    <view class="pg-layer__row">
      <button class="pg-layer__btn" role="button" data-testid="selfcheck-skip" :disabled="props.busy" @tap="emit('skip')">
        跳过自检
      </button>
    </view>
  </view>
</template>

<style scoped>
.pg-layer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3) 0 var(--sp-4);
  min-width: 0;
}
.pg-layer__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-layer__title { font-size: 12px; font-weight: 900; letter-spacing: 0.9px; color: var(--ink-2); }
.pg-layer__step { color: var(--ink-2); flex: 0 0 auto; }
.pg-layer__hint { color: var(--ink-2); }
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__row .pg-layer__btn { flex: 1; }
.pg-check__proof { padding: var(--sp-2) var(--sp-3); }
.pg-check__prooflabel { color: var(--ink-2); }
.pg-check__line { display: flex; gap: var(--sp-2); padding: 4px 0; }
.pg-check__no { width: 20px; color: var(--ink-2); font-size: 12px; }
.pg-check__body { flex: 1; min-width: 0; }
.pg-check__just { color: var(--ink-2); }
.pg-check__adaptive {
  display: block;
  padding: var(--sp-2);
  border-left: 3px solid var(--rule);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  background: var(--paper);
  color: var(--ink);
}
.pg-check__adaptive--wait { border-left-color: var(--hint); background: var(--hint-soft); }
.pg-check__adaptive--retry { border-left-color: var(--margin); background: var(--margin-soft); }
.pg-check__adaptive--done { border-left-color: var(--ok); background: var(--accent-soft); }
.pg-check__item { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-check__qhead { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.pg-check__qno { color: var(--ink-2); font-size: 12px; }
.pg-check__status { padding: 1px var(--sp-2); border-radius: 999px; border: 2px solid var(--rule); color: var(--ink-2); }
.pg-check__status--accepted { border-color: var(--ok); color: var(--ok); }
.pg-check__status--followup { border-color: var(--margin); color: var(--margin-text); }
.pg-check__followup { color: var(--margin-text); }
.pg-check__done { display: flex; flex-direction: column; gap: var(--sp-1); padding: var(--sp-3); }
.pg-check__donetitle { font-size: 16px; font-weight: 900; }
.pg-check__passed { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); }
.pg-check__passedrow { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-1) 0; border-bottom: 1px dashed var(--rule); }
.pg-check__passedrow:last-child { border-bottom: 0; }
.pg-check__answer { color: var(--ink-2); }
.pg-layer__input {
  display: block;
  width: 100%;
  height: 96px;
  border: 2px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--paper);
  overflow: hidden;
}
.pg-layer__input :deep(.uni-textarea-wrapper) { height: 100%; }
.pg-layer__input :deep(textarea) {
  width: 100%;
  height: 94px;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.65;
  resize: none;
}
.pg-layer__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 2px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.2;
}
.pg-layer__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.pg-layer__btn[disabled] { opacity: 0.45; }
</style>
