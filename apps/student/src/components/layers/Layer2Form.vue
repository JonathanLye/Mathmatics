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
/** 本机展开过通用骨架；服务端 templateShown=true 时直接展开。 */
const localTemplateShown = ref(false)

watch(
  () => props.view.last,
  (last) => {
    if (typeof last === 'string') draft.value = last
  },
  { immediate: true },
)
watch(
  () => props.view.templateShown,
  (shown) => {
    if (shown) localTemplateShown.value = true
  },
  { immediate: true },
)

const text = computed(() => draft.value.trim())
const canSubmit = computed(() => text.value.length > 0 && !props.busy)
const templateVisible = computed(() => Boolean(props.view.template) && localTemplateShown.value)

function submit() {
  if (!canSubmit.value) return
  emit('submit', text.value)
}

/** 通用骨架不计透露量；同时把"讲解入口"交给父级（微课 #26 接入）。 */
function showTemplate() {
  localTemplateShown.value = true
  emit('lesson')
}
</script>

<template>
  <view class="pg-layer">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 2 层 · 证明骨架</text>
      <text class="pg-layer__step pg-small">写出框架</text>
    </view>

    <view class="pg-layer__task">
      <MathText :text="props.view.task || '写出这个证明的骨架。'" serif block />
    </view>
    <text class="pg-layer__hint pg-small">
      开头写什么、结尾落到什么、中间要构造的是什么；最后补一句「真正要解决的是什么」。不用写出构造本身。
    </text>

    <view v-if="templateVisible" class="pg-layer__template">
      <text class="pg-layer__templatelabel pg-small">通用骨架（不计透露量）</text>
      <MathText :text="props.view.template || ''" serif block />
    </view>

    <textarea
      v-model="draft"
      class="pg-layer__input"
      :maxlength="-1"
      :disabled="props.busy"
      placeholder="按骨架写：任取 ε>0。取 N=＿（待构造）。则当 n>N 时，⋯<ε。"
      placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
    />

    <view v-if="text" class="pg-layer__preview">
      <text class="pg-layer__previewlabel pg-small">公式预览</text>
      <MathText :text="text" block />
    </view>

    <button class="pg-layer__btn pg-layer__btn--primary" :disabled="!canSubmit" @tap="submit">
      {{ props.busy ? '核对中…' : '核对' }}
    </button>
    <view class="pg-layer__row">
      <button class="pg-layer__btn" :disabled="props.busy" @tap="showTemplate">看通用骨架</button>
      <button class="pg-layer__btn" :disabled="props.busy" @tap="emit('skip')">跳过</button>
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
  color: #fff;
}
.pg-layer__btn[disabled] { opacity: 0.45; }
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__row .pg-layer__btn { width: auto; flex: 1; }
</style>
