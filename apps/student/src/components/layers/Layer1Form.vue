<script setup lang="ts">
/**
 * 第 1 层 · 回忆定义（issue #11）。
 *
 * 只做三件事：渲染服务端下发的任务说明、收集学生写的定义、把文本原样上抛。
 * 是否通过、缺哪个成分、能不能跳层都由服务端 state 决定，前端不做判定（08 §8 AI 规则 3）。
 * Props/Emits 与 #8 的占位版保持一致，practice 页不需要改契约。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
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
      <text class="pg-layer__title">第 1 层</text>
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
      class="pg-input-area"
      data-testid="layer1-input"
      data-pg-target="def"
      :maxlength="MAX_MATH_TEXT"
      :disabled="props.busy"
      placeholder="在这里写出定义……"
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

    <!-- 核对没通过：服务端指出缺的那一个成分。问题挂在表单下面，所有宽度都一样。 -->
    <view v-if="props.view.feedback" class="pg-layer__feedback" data-testid="layer1-feedback" role="status">
      <text class="pg-layer__feedbackwho pg-small">助教</text>
      <MathText :text="props.view.feedback" block />
    </view>

    <PgButton block size="lg" data-testid="layer1-check" sound="tap" :loading="props.busy" :disabled="!canSubmit" @tap="submit">
      {{ props.busy ? '核对中…' : '核对' }}
    </PgButton>
    <view class="pg-layer__row">
      <PgButton variant="secondary" data-testid="layer1-lesson" :disabled="props.busy" @tap="emit('lesson')">看不懂</PgButton>
      <PgButton variant="secondary" data-testid="layer1-skip" :disabled="props.busy" @tap="emit('skip')">已掌握，跳过</PgButton>
    </view>
  </view>
</template>
