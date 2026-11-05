<script setup lang="ts">
/**
 * 第 2 层 · 证明骨架（issue #11）。
 *
 * 显示骨架任务；"看通用骨架"把服务端下发的通用模板用 MathText 展开（不计透露量，02 §4.3）；
 * 输入框收集学生的形式框架并原样上抛。是否通过由服务端 state 判定，前端不做判定。
 * Props/Emits 与 #8 的占位版保持一致，practice 页不需要改契约。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
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

/** 通用骨架不计透露量；由父组件调 POST /framework/template，本组件只上抛 lesson 事件。 */
function showTemplate() {
  emit('lesson')
}
</script>

<template>
  <view class="pg-layer" data-testid="layer2-form">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 2 层 · 证明骨架</text>
      <text class="pg-layer__step pg-small">写出框架</text>
    </view>

    <view class="pg-layer__task" data-testid="layer2-task">
      <MathText :text="props.view.task || '写出这个证明的骨架。'" serif block />
    </view>
    <text class="pg-layer__hint pg-small">
      开头写什么、结尾落到什么、中间要构造的是什么；最后补一句「真正要解决的是什么」。不用写出构造本身。
    </text>

    <view v-if="templateVisible" class="pg-layer__template" data-testid="layer2-template">
      <text class="pg-layer__templatelabel pg-small">通用骨架（不计透露量）</text>
      <MathText :text="props.view.template || ''" serif block />
    </view>

    <textarea
      v-model="draft"
      class="pg-layer__input"
      data-testid="layer2-input"
      :maxlength="MAX_MATH_TEXT"
      :disabled="props.busy"
      placeholder="按骨架写：任取 ε>0。取 N=＿（待构造）。则当 n>N 时，⋯<ε。"
      placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
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

    <button
      class="pg-layer__btn pg-layer__btn--primary"
      data-testid="layer2-check"
      role="button"
      :disabled="!canSubmit"
      @tap="submit"
    >
      {{ props.busy ? '核对中…' : '核对' }}
    </button>
    <view class="pg-layer__row">
      <button class="pg-layer__btn" data-testid="layer2-template-btn" role="button" :disabled="props.busy" @tap="showTemplate">
        看通用骨架
      </button>
      <button class="pg-layer__btn" data-testid="layer2-skip" role="button" :disabled="props.busy" @tap="emit('skip')">
        跳过
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
  font-size: 17px;
  font-weight: 900;
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
.pg-layer__template {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2);
  border-left: 3px solid var(--hint);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  background: var(--hint-soft);
  font-family: var(--font-serif);
  color: var(--ink);
}
.pg-layer__templatelabel { color: var(--ink-2); font-family: var(--font-sans); }
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
  color: var(--on-accent);
}
.pg-layer__btn[disabled] { opacity: 0.45; }
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__row .pg-layer__btn { width: auto; flex: 1; }
</style>
