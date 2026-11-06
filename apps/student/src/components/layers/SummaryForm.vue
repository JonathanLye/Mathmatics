<script setup lang="ts">
/**
 * 第 6 层 · 总结（01 §L6 / 02 §4.3）：五问，每问一句话。
 *
 * 本组件只收集文本并上抛；要点比对与追问在服务端（现阶段只要求五问都写，不校验逻辑顺序）。
 */
import { computed, reactive, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import MathField from '@/components/practice/MathField.vue'
import PgButton from '@/components/ui/PgButton.vue'
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
        <text class="pg-summary__qno">{{ index + 1 }}</text>
        <MathText :text="question" serif block />
      </view>
      <MathField
        v-model="drafts[index]"
        :data-testid="'summary-input-' + index"
        :maxlength="500"
        :disabled="props.busy"
        :min-rows="2"
        placeholder="一句话……"
      />
    </view>

    <view class="pg-pin">
      <PgButton block size="lg" data-testid="summary-submit" sound="tap" :loading="props.busy" :disabled="!canSubmit" @tap="submit">
        {{ props.busy ? '提交中…' : '提交总结' }}
      </PgButton>
    </view>
  </view>
</template>

<style scoped>
.pg-summary__item { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-summary__qhead { display: flex; gap: var(--sp-2); align-items: baseline; color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-15); }
.pg-summary__qno { flex: none; color: var(--ink-2); font-family: var(--font-sans); font-size: var(--fs-13); font-weight: var(--fw-black); }
</style>
