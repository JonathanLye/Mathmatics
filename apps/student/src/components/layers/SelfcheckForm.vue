<script setup lang="ts">
/**
 * 第 4 层 · 自检（01 §L4 / 02 §4.3）。
 *
 * 针对学生自己写的证明回答 3 道局部问题；本组件只收集文本并上抛，判对/追问都由服务端 state 决定。
 * 已通过的题显示绿色「已通过」；不合格（followup）时只提示再补一句，不给讲解、不给答案。
 */
import { computed, reactive } from 'vue'
import MathText from '@ui-math/MathText.vue'
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

const items = computed(() => props.view?.items ?? [])
const passed = computed(() => items.value.filter((item) => item.status === 'accepted').length)

function canSubmit(item: SelfcheckItem): boolean {
  return !props.busy && item.status !== 'accepted' && (drafts[item.itemId] ?? '').trim().length > 0
}

function submit(item: SelfcheckItem) {
  if (!canSubmit(item)) return
  emit('submit', item.itemId, (drafts[item.itemId] ?? '').trim())
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
      <text class="pg-layer__step pg-small">{{ passed }} / {{ items.length }} 已通过</text>
    </view>
    <text class="pg-layer__hint pg-small">
      针对你自己写的证明回答。答错不会给讲解，只会追问一句；三题都通过后进入迁移题。
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

    <view
      v-for="(item, index) in items"
      :key="item.itemId"
      class="pg-check__item pg-sheet"
      :class="{ 'pg-check__item--passed': item.status === 'accepted' }"
      :data-testid="'selfcheck-item-' + item.itemId"
    >
      <view class="pg-check__qhead">
        <text class="pg-check__qno pg-mono">{{ index + 1 }}</text>
        <text
          class="pg-check__status pg-small"
          :class="'pg-check__status--' + item.status"
          :data-testid="'selfcheck-status-' + item.itemId"
        >{{ statusText(item) }}</text>
      </view>
      <MathText :text="item.question" serif block />

      <template v-if="item.status === 'accepted'">
        <text class="pg-check__answer" :data-testid="'selfcheck-answer-' + item.itemId">{{ item.answer }}</text>
      </template>
      <template v-else>
        <text v-if="item.status === 'followup'" class="pg-check__followup pg-small" :data-testid="'selfcheck-followup-' + item.itemId">
          回答有点短，再具体一句：这条依据是从哪一步、用什么运算得到的？
        </text>
        <textarea
          v-model="drafts[item.itemId]"
          class="pg-layer__input"
          :data-testid="'selfcheck-input-' + item.itemId"
          :maxlength="500"
          :disabled="props.busy"
          placeholder="写一句话回答……"
          placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
        />
        <button
          class="pg-layer__btn pg-layer__btn--primary"
          role="button"
          :data-testid="'selfcheck-submit-' + item.itemId"
          :disabled="!canSubmit(item)"
          @tap="submit(item)"
        >
          {{ props.busy ? '提交中…' : '提交这一题' }}
        </button>
      </template>
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
.pg-layer__title { font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--ink); }
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
.pg-check__item { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-check__item--passed { border-left: 3px solid var(--ok); }
.pg-check__qhead { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.pg-check__qno { color: var(--ink-2); font-size: 12px; }
.pg-check__status { padding: 1px var(--sp-2); border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-2); }
.pg-check__status--accepted { border-color: var(--ok); color: var(--ok); }
.pg-check__status--followup { border-color: var(--margin); color: var(--margin); }
.pg-check__answer { color: var(--ink); padding: var(--sp-2); background: var(--accent-soft); border-left: 3px solid var(--ok); }
.pg-check__followup { color: var(--margin); }
.pg-layer__input {
  display: block;
  width: 100%;
  height: 96px;
  border: 1px solid var(--rule);
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
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.2;
}
.pg-layer__btn--primary { border-color: var(--accent); background: var(--accent); color: #fff; }
.pg-layer__btn[disabled] { opacity: 0.45; }
</style>
