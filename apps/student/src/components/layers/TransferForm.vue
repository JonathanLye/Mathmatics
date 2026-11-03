<script setup lang="ts">
/**
 * 第 5 层 · 迁移题（01 §L5 / 02 §4.3）。
 *
 * 状态全部来自服务端：transfer.status 决定显示「开始迁移题」还是题面 + 输入区。
 * 「开始迁移题」= POST /attempts/{id}/transfer（服务端创建子作答，返回迁移题 state）；
 * 「提交迁移题」= 完成子作答（mock：/transfer 完成后推进到第 6 层）。
 */
import { computed, ref } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { TransferView } from '@/types/attempt'

const props = withDefaults(defineProps<{ view?: TransferView | null; busy?: boolean }>(), {
  view: null,
  busy: false,
})

const emit = defineEmits<{
  (e: 'start'): void
  (e: 'submit', text: string): void
  (e: 'skip'): void
}>()

/** 开始前提示（MathText：含 ε / δ 的 LaTeX）。 */
const startHint =
  '换一道同类题：用 $\\varepsilon$-$\\delta$ 定义证明一个函数极限。检验你能不能把刚才的骨架用到新题上。'

const draft = ref('')
const status = computed(() => props.view?.status ?? 'not_started')
const canSubmit = computed(() => draft.value.trim().length > 0 && !props.busy)

function submit() {
  if (!canSubmit.value) return
  emit('submit', draft.value.trim())
}
</script>

<template>
  <view class="pg-layer" data-testid="transfer-form">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 5 层 · 迁移题</text>
      <text class="pg-layer__step pg-small">{{ status === 'completed' ? '已完成' : status === 'active' ? '作答中' : '待开始' }}</text>
    </view>

    <template v-if="status === 'not_started'">
      <view class="pg-layer__hint pg-small" data-testid="transfer-start-hint">
        <MathText :text="startHint" block />
      </view>
      <text class="pg-layer__note pg-sheet">
        迁移题是独立的完整题目包，透露预算更少；不会做可以跳过，不影响本题完成。
      </text>
      <view class="pg-layer__row">
        <button class="pg-layer__btn pg-layer__btn--primary" role="button" data-testid="transfer-start" :disabled="props.busy" @tap="emit('start')">
          {{ props.busy ? '准备中…' : '开始迁移题' }}
        </button>
        <button class="pg-layer__btn" role="button" data-testid="transfer-skip" :disabled="props.busy" @tap="emit('skip')">
          跳过
        </button>
      </view>
    </template>

    <template v-else-if="status === 'active'">
      <view class="pg-layer__task pg-sheet" data-testid="transfer-task">
        <text class="pg-layer__tasklabel pg-small">迁移题</text>
        <MathText :text="props.view?.stem || '（迁移题题面未下发）'" serif block />
      </view>
      <text class="pg-layer__hint pg-small">和第 3 层一样：写一行「结论 + 依据」。提交后进入第 6 层总结。</text>
      <textarea
        v-model="draft"
        class="pg-layer__input"
        data-testid="transfer-input"
        :maxlength="2000"
        :disabled="props.busy"
        placeholder="例如：任取 ε>0，取 δ=ε/2。则当 0<|x-1|<δ 时，……<ε。"
        placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
      />
      <button
        class="pg-layer__btn pg-layer__btn--primary"
        role="button"
        data-testid="transfer-submit"
        :disabled="!canSubmit"
        @tap="submit"
      >
        {{ props.busy ? '提交中…' : '提交迁移题' }}
      </button>
      <view class="pg-layer__row">
        <button class="pg-layer__btn" role="button" data-testid="transfer-skip" :disabled="props.busy" @tap="emit('skip')">
          跳过（推荐下一题）
        </button>
      </view>
    </template>

    <template v-else>
      <text class="pg-layer__hint pg-small">迁移题已完成，正在等待服务端推进到第 6 层……</text>
    </template>
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
.pg-layer__note { display: block; padding: var(--sp-2) var(--sp-3); color: var(--ink-2); font-size: 14px; line-height: 1.55; }
.pg-layer__task { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-3); font-family: var(--font-serif); color: var(--ink); }
.pg-layer__tasklabel { color: var(--ink-2); font-family: var(--font-sans); }
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
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__row .pg-layer__btn { flex: 1; }
</style>
