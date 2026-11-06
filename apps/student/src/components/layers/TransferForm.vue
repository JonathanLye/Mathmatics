<script setup lang="ts">
/**
 * 第 5 层 · 换题试试入口（父作答，01 §L5）。
 *
 * 这里只有「开始迁移题」和「跳过」：点开始后服务端会创建子作答（kind=transfer），
 * 做题页切换到子作答 state，真正的多行作答见 components/layers/TransferAttempt.vue。
 * 开始前用 #47 的 TransferOutlineDiagram 展示两题的同构骨架（ε-N ↔ ε-δ）。
 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
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
      <text class="pg-layer__step pg-small">{{ status === 'completed' ? '已完成' : status === 'active' ? '作答中' : '待开始' }}</text>
    </view>

    <template v-if="status !== 'active' && status !== 'completed'">
      <view class="pg-layer__hint pg-small" data-testid="transfer-start-hint">
        <MathText :text="startHint" block />
      </view>
      <PgCard tone="soft" class="pg-layer__hint pg-small">这是一道独立的完整题目，提示额度更少；不会做可以跳过，不影响本题完成。</PgCard>
      <view data-testid="transfer-outline-preview">
        <TransferOutlineDiagram />
      </view>
      <PgButton variant="secondary" block data-testid="transfer-skip" :disabled="props.busy" @tap="emit('skip')">跳过</PgButton>
      <view class="pg-pin">
        <PgButton block size="lg" data-testid="transfer-start" sound="tap" :loading="props.busy" @tap="emit('start')">{{ props.busy ? '准备中…' : '开始换题' }}</PgButton>
      </view>
    </template>

    <template v-else-if="status === 'active'">
      <text class="pg-layer__hint pg-small">新题已经准备好，正在加载……</text>
    </template>

    <template v-else>
      <text class="pg-layer__hint pg-small">这道题已完成。回到本题完成页可以加入证明本。</text>
    </template>
  </view>
</template>
