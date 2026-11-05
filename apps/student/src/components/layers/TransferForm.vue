<script setup lang="ts">
/**
 * 第 5 层 · 迁移题入口（父作答，01 §L5）。
 *
 * 这里只有「开始迁移题」和「跳过」：点开始后服务端会创建子作答（kind=transfer），
 * 做题页切换到子作答 state，真正的多行作答见 components/layers/TransferAttempt.vue。
 * 开始前用 #47 的 TransferOutlineDiagram 展示两题的同构骨架（ε-N ↔ ε-δ）。
 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
import TransferOutlineDiagram from '@/components/diagrams/TransferOutlineDiagram.vue'
import type { TransferView } from '@/types/attempt'

const props = withDefaults(defineProps<{ view?: TransferView | null; busy?: boolean }>(), {
  view: null,
  busy: false,
})

const emit = defineEmits<{
  (e: 'start'): void
  (e: 'skip'): void
}>()

/** 开始前提示（MathText：含 ε / δ 的 LaTeX）。 */
const startHint =
  '换一道同类题：用 $\\varepsilon$-$\\delta$ 定义证明一个函数极限。检验你能不能把刚才的骨架用到新题上。'

const status = computed(() => props.view?.status ?? 'not_started')
</script>

<template>
  <view class="pg-layer" data-testid="transfer-form">
    <view class="pg-layer__head">
      <text class="pg-layer__title">第 5 层 · 迁移题</text>
      <text class="pg-layer__step pg-small">{{ status === 'completed' ? '已完成' : status === 'active' ? '作答中' : '待开始' }}</text>
    </view>

    <template v-if="status !== 'active' && status !== 'completed'">
      <view class="pg-layer__hint pg-small" data-testid="transfer-start-hint">
        <MathText :text="startHint" block />
      </view>
      <text class="pg-layer__note pg-sheet">迁移题是独立的完整题目包，透露预算更少；不会做可以跳过，不影响本题完成。</text>
      <view data-testid="transfer-outline-preview">
        <TransferOutlineDiagram />
      </view>
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
      <text class="pg-layer__hint pg-small">迁移题子作答已创建，正在加载题目……</text>
    </template>

    <template v-else>
      <text class="pg-layer__hint pg-small">迁移题已完成。回到本题完成页可以加入证明本。</text>
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
.pg-layer__title { font-size: 17px; font-weight: 900; color: var(--ink); }
.pg-layer__step { color: var(--ink-2); flex: 0 0 auto; }
.pg-layer__hint { color: var(--ink-2); }
.pg-layer__note { display: block; padding: var(--sp-2) var(--sp-3); color: var(--ink-2); font-size: 14px; line-height: 1.55; }
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 44px;
  margin: 0;
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
