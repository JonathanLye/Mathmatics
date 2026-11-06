<script setup lang="ts">
/**
 * 第 2 层 · 搭骨架（issue #11）。
 *
 * 显示骨架任务；"看通用骨架"把服务端下发的通用模板用 MathText 展开（不占提示额度，02 §4.3）；
 * 输入框收集学生的形式框架并原样上抛。是否通过由服务端 state 判定，前端不做判定。
 * Props/Emits 与 #8 的占位版保持一致，practice 页不需要改契约。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import type { FrameView } from '@/types/attempt'

/** 单条 MathText 上限，对齐 openapi.yaml 的 `MathText.maxLength: 4000`；最终以服务端校验为准（#24）。 */
const MAX_MATH_TEXT = 4000

const props = withDefaults(defineProps<{ layer?: string; view?: FrameView; busy?: boolean }>(), {
  layer: 'L2',
  view: () => ({}),
  busy: false,
})

const emit = defineEmits<{
  (e: 'submit', text: string): void
  (e: 'lesson'): void
  (e: 'skip'): void
}>()

const draft = ref('')

watch(
  () => props.view.last,
  (last) => {
    if (typeof last === 'string') draft.value = last
  },
  { immediate: true },
)

const text = computed(() => draft.value.trim())
const canSubmit = computed(() => text.value.length > 0 && !props.busy)
/** 是否展示通用骨架只看服务端 state（viewFrameTemplate 返回 templateShown=true），本地不置状态。 */
const templateVisible = computed(() => Boolean(props.view.template) && Boolean(props.view.templateShown))
/** 接近上限时把字数提示变色。 */
const nearLimit = computed(() => draft.value.length >= MAX_MATH_TEXT * 0.95)

function submit() {
  if (!canSubmit.value) return
  emit('submit', text.value)
}

/** 通用骨架不占提示额度；由父组件调 POST /framework/template，本组件只上抛 lesson 事件。 */
function showTemplate() {
  emit('lesson')
}
</script>

<template>
  <view class="pg-layer" data-testid="layer2-form">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 2 层</text>
      <text class="pg-layer__step pg-small">写出框架</text>
    </view>

    <view class="pg-layer__task" data-testid="layer2-task">
      <MathText :text="props.view.task || '写出这个证明的骨架。'" serif block />
    </view>
    <text class="pg-layer__hint pg-small">
      开头写什么、结尾落到什么、中间要构造的是什么；最后补一句「真正要解决的是什么」。不用写出构造本身。
    </text>

    <view v-if="templateVisible" class="pg-layer__preview pg-layer__preview--bee" data-testid="layer2-template">
      <text class="pg-layer__previewlabel pg-small">通用骨架（不占提示额度）</text>
      <MathText :text="props.view.template || ''" serif block />
    </view>

    <textarea
      v-model="draft"
      class="pg-input-area"
      data-testid="layer2-input"
      :maxlength="MAX_MATH_TEXT"
      :disabled="props.busy"
      placeholder="按骨架写：任取 ε>0。取 N=＿（待构造）。则当 n>N 时，⋯<ε。"
    />
    <text
      v-if="text"
      class="pg-layer__count pg-small"
      :class="{ 'pg-layer__count--near': nearLimit }"
      data-testid="layer2-count"
    >已写 {{ draft.length }} / {{ MAX_MATH_TEXT }} 字</text>

    <view v-if="text" class="pg-layer__preview" data-testid="layer2-preview">
      <text class="pg-layer__previewlabel pg-small">公式预览</text>
      <MathText :text="text" block />
    </view>

    <view v-if="props.view.feedback" class="pg-layer__feedback" data-testid="layer2-feedback" role="status">
      <text class="pg-layer__feedbackwho pg-small">助教</text>
      <MathText :text="props.view.feedback" block />
    </view>

    <PgButton block size="lg" data-testid="layer2-check" sound="tap" :loading="props.busy" :disabled="!canSubmit" @tap="submit">
      {{ props.busy ? '核对中…' : '核对' }}
    </PgButton>
    <view class="pg-layer__row">
      <PgButton variant="secondary" data-testid="layer2-template-btn" :disabled="props.busy" @tap="showTemplate">看通用骨架</PgButton>
      <PgButton variant="secondary" data-testid="layer2-skip" :disabled="props.busy" @tap="emit('skip')">跳过</PgButton>
    </view>
  </view>
</template>
