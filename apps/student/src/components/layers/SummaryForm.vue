<script setup lang="ts">
/**
 * 第 6 层 · 总结（01 §L6 / 02 §4.3）：五问，每问一句话。
 *
 * 本组件只收集文本并上抛；要点比对与追问在服务端（mock 阶段 P0 只要求五问都写，不校验逻辑顺序）。
 */
import { computed, reactive, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { SummaryView } from '@/types/attempt'

const props = withDefaults(defineProps<{ view?: SummaryView | null; busy?: boolean }>(), {
  view: null,
  busy: false,
})

const emit = defineEmits<{ (e: 'submit', answers: string[]): void }>()

const drafts = reactive<string[]>([])
const questions = computed(() => props.view?.questions ?? [])

// 断点回填：服务端 state 里带上次答案时填回草稿。
watch(
  () => props.view,
  (view) => {
    const next = (view?.questions ?? []).map((_, i) => (view?.answers?.[i] ?? ''))
    drafts.splice(0, drafts.length, ...next)
  },
  { immediate: true },
)

const filled = computed(() => drafts.filter((d) => (d ?? '').trim().length > 0).length)
const canSubmit = computed(() => !props.busy && questions.value.length > 0 && filled.value === questions.value.length)

function submit() {
  if (!canSubmit.value) return
  emit('submit', drafts.map((d) => (d ?? '').trim()))
}
</script>

<template>
  <view class="pg-layer" data-testid="summary-form">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 6 层 · 总结</text>
      <text class="pg-layer__step pg-small">{{ filled }} / {{ questions.length }} 已回答</text>
    </view>
    <text class="pg-layer__hint pg-small">每问一句话即可。提交后进入完成页；总结会进入你的证明本。</text>

    <view
      v-for="(question, index) in questions"
      :key="index"
      class="pg-summary__item pg-sheet"
      :data-testid="'summary-item-' + index"
    >
      <view class="pg-summary__qhead">
        <text class="pg-summary__qno pg-mono">{{ index + 1 }}</text>
        <MathText :text="question" serif block />
      </view>
      <textarea
        v-model="drafts[index]"
        class="pg-layer__input"
        :data-testid="'summary-input-' + index"
        :maxlength="500"
        :disabled="props.busy"
        placeholder="一句话……"
        placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
      />
    </view>

    <button
      class="pg-layer__btn pg-layer__btn--primary"
      role="button"
      data-testid="summary-submit"
      :disabled="!canSubmit"
      @tap="submit"
    >
      {{ props.busy ? '提交中…' : '提交总结' }}
    </button>
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
.pg-layer__title { font-size: 17px; font-weight: 900; color: var(--ink); }
.pg-layer__step { color: var(--ink-2); flex: 0 0 auto; }
.pg-layer__hint { color: var(--ink-2); }
.pg-summary__item { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-summary__qhead { display: flex; gap: var(--sp-2); align-items: baseline; font-family: var(--font-serif); font-size: 15px; color: var(--ink); }
.pg-summary__qno { color: var(--ink-2); flex: 0 0 auto; font-size: 12px; }
.pg-layer__input {
  display: block;
  width: 100%;
  height: 84px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--paper);
  overflow: hidden;
}
.pg-layer__input :deep(.uni-textarea-wrapper) { height: 100%; }
.pg-layer__input :deep(textarea) {
  width: 100%;
  height: 82px;
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
.pg-layer__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.pg-layer__btn[disabled] { opacity: 0.45; }
</style>
