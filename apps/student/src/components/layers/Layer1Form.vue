<script setup lang="ts">
/**
 * 第 1 层 · 记忆核验（issue #11）。
 *
 * 只做三件事：渲染服务端下发的任务说明、收集学生写的定义、把文本原样上抛。
 * 是否通过、缺哪个成分、能不能跳层都由服务端 state 决定，前端不做判定（08 §8 AI 规则 3）。
 * Props/Emits 与 #8 的占位版保持一致，practice 页不需要改契约。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { DefView } from '@/types/attempt'

/** 单条 MathText 上限，对齐 openapi.yaml 的 `MathText.maxLength: 4000`；最终以服务端校验为准（#24）。 */
const MAX_MATH_TEXT = 4000

const props = withDefaults(defineProps<{ layer?: string; view?: DefView; busy?: boolean; initialText?: string }>(), {
  layer: 'L1',
  view: () => ({}),
  busy: false,
  initialText: '',
})

const emit = defineEmits<{
  (e: 'submit', text: string): void
  (e: 'lesson'): void
  (e: 'skip'): void
  /** #27：输入变化上抛，由做题页做 IndexedDB 防抖草稿保存。 */
  (e: 'update:text', value: string): void
}>()

/** 输入草稿：提交前只留在本机，不写回服务端 state。 */
const draft = ref('')

// 断点续写优先用本机草稿（#27），否则回填服务端 state 的上次提交（#11）。
watch(
  [() => props.initialText, () => props.view.last],
  ([initialText, last]) => {
    if (typeof initialText === 'string' && initialText.length > 0) draft.value = initialText
    else if (typeof last === 'string') draft.value = last
  },
  { immediate: true },
)

// 输入变化上报（防抖落盘由父级做）。
watch(draft, (value) => emit('update:text', value))

const text = computed(() => draft.value.trim())
const canSubmit = computed(() => text.value.length > 0 && !props.busy)
/** 接近上限时把字数提示变色。 */
const nearLimit = computed(() => draft.value.length >= MAX_MATH_TEXT * 0.95)

function submit() {
  if (!canSubmit.value) return
  emit('submit', text.value)
}
</script>

<template>
  <view class="pg-layer" data-testid="layer1-form">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 1 层 · 记忆核验</text>
      <text class="pg-layer__step pg-small">写出定义</text>
    </view>

    <view class="pg-layer__task" data-testid="layer1-task">
      <MathText :text="props.view.task || '写出本题要用到的定义。'" serif block />
    </view>
    <text class="pg-layer__hint pg-small">
      可以用自己的话写，也可以用量词。核对后系统只会指出缺了哪一个成分。
    </text>

    <textarea
      v-model="draft"
      class="pg-layer__input"
      data-testid="layer1-input"
      data-pg-target="def"
      :maxlength="MAX_MATH_TEXT"
      :disabled="props.busy"
      placeholder="在这里写出定义……"
      placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
    />
    <text
      v-if="text"
      class="pg-layer__count pg-small"
      :class="{ 'pg-layer__count--near': nearLimit }"
      data-testid="layer1-count"
    >已写 {{ draft.length }} / {{ MAX_MATH_TEXT }} 字</text>

    <view v-if="text" class="pg-layer__preview" data-testid="layer1-preview">
      <text class="pg-layer__previewlabel pg-small">公式预览</text>
      <MathText :text="text" block />
    </view>

    <button
      class="pg-layer__btn pg-layer__btn--primary"
      data-testid="layer1-check"
      role="button"
      :disabled="!canSubmit"
      @tap="submit"
    >
      {{ props.busy ? '核对中…' : '核对' }}
    </button>
    <view class="pg-layer__row">
      <button class="pg-layer__btn" data-testid="layer1-lesson" role="button" :disabled="props.busy" @tap="emit('lesson')">
        看不懂
      </button>
      <button class="pg-layer__btn" data-testid="layer1-skip" role="button" :disabled="props.busy" @tap="emit('skip')">
        已掌握，跳过
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
.pg-layer__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}
.pg-layer__title {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}
.pg-layer__step { color: var(--ink-2); flex: 0 0 auto; }
.pg-layer__task {
  font-family: var(--font-serif);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
}
.pg-layer__hint { color: var(--ink-2); }
.pg-layer__count { color: var(--ink-2); align-self: flex-end; }
.pg-layer__count--near { color: var(--hint); font-weight: 600; }
/* uni-app H5 的 textarea 是 <uni-textarea> 自定义元素，内层才是原生 textarea。 */
.pg-layer__input {
  display: block;
  width: 100%;
  height: 132px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--paper);
  overflow: hidden;
}
.pg-layer__input :deep(.uni-textarea-wrapper) { height: 100%; }
.pg-layer__input :deep(textarea) {
  width: 100%;
  height: 130px;
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
.pg-layer__preview {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  background: var(--accent-soft);
}
.pg-layer__previewlabel { color: var(--ink-2); }
/* uni-button 默认 margin:auto，在 flex 列里会缩成内容宽，这里显式吃掉。 */
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
.pg-layer__btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.pg-layer__btn[disabled] { opacity: 0.45; }
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__row .pg-layer__btn { width: auto; flex: 1; }
</style>
