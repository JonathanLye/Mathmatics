<script setup lang="ts">
/**
 * 解题思路（独立组件，做题页也可以挂）。三步：
 * 没看过 → 看解题思路（一句话说清之后关键步骤经验会少）；
 * 看过思路 → 思路、关键想法，再往下是看完整证明（要确认：这次作答的关键步骤不再有经验）；
 * 完整 → 参考证明。题做完之后全部免费，不再有任何提醒。
 *
 * 测验和老师布置永远不显示：examMode=true 时什么都不渲染、不发请求；服务端也会拒绝。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import AiGeneratedTag from '@/components/AiGeneratedTag.vue'
import { errorMessage, getPracticeSolution, revealPracticeSolution } from '@/api/client'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgDialog from '@/components/ui/PgDialog.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { SOLUTION_COPY } from '@/copy'
import { playSfx } from '@/motion/sfx'
import type { PracticeSolution } from '@/types/path'
import { nextReveal, solutionStep } from './zoneLogic'

const props = withDefaults(defineProps<{ open: boolean; problemId: string | null; examMode?: boolean }>(), { examMode: false })
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'revealed', solution: PracticeSolution): void }>()

const solution = ref<PracticeSolution | null>(null)
const loading = ref(false)
const failure = ref('')
const revealing = ref(false)
const revealError = ref('')
const confirmFull = ref(false)
let ticket = 0

const visible = computed(() => props.open && !props.examMode && props.problemId !== null)
const step = computed(() => (solution.value ? solutionStep(solution.value) : null))
const next = computed(() => (solution.value ? nextReveal(solution.value) : null))

async function load(): Promise<void> {
  const id = props.problemId
  if (!id || props.examMode) return
  const mine = ++ticket
  loading.value = true
  failure.value = ''
  revealError.value = ''
  try {
    const result = await getPracticeSolution(id)
    if (mine === ticket) solution.value = result
  } catch (e) {
    if (mine === ticket) {
      solution.value = null
      failure.value = errorMessage(e)
    }
  } finally {
    if (mine === ticket) loading.value = false
  }
}

watch(visible, (now) => {
  if (now) void load()
  else confirmFull.value = false
})
watch(
  () => props.problemId,
  () => {
    solution.value = null
    if (visible.value) void load()
  },
)

async function reveal(level: 'approach' | 'full'): Promise<void> {
  const id = props.problemId
  if (!id || revealing.value || props.examMode) return
  revealing.value = true
  revealError.value = ''
  try {
    solution.value = await revealPracticeSolution(id, level)
    playSfx('hint')
    emit('revealed', solution.value)
  } catch (e) {
    revealError.value = errorMessage(e)
  } finally {
    revealing.value = false
    confirmFull.value = false
  }
}

function askFull(): void {
  confirmFull.value = true
}
</script>

<template>
  <template v-if="!examMode">
    <PgSheet :open="visible" :persistent="revealing" :z-index="70" data-testid="solution-sheet" :aria-label="SOLUTION_COPY.title" @update:open="$emit('update:open', $event)">
      <text class="pg-solution__title">{{ SOLUTION_COPY.title }}</text>

      <view v-if="loading && !solution" data-testid="solution-loading" aria-busy="true"><PgSkeleton :count="4" /></view>

      <view v-else-if="failure" data-testid="solution-error" role="alert">
        <PgEmpty :title="SOLUTION_COPY.loadFailed" :body="failure" expr="oops" :motion="null" :size="72" :action="SOLUTION_COPY.retry" action-testid="solution-retry" @action="load" />
      </view>

      <template v-else-if="solution">
        <!-- 还没开始做 / 没有整理好的内容 -->
        <PgCard v-if="step === 'locked'" tone="soft" class="pg-solution__note" data-testid="solution-locked">
          <PgIcon name="lock" :size="20" class="pg-solution__noteicon" />
          <text class="pg-solution__notetext">{{ SOLUTION_COPY.lockedBody }}</text>
        </PgCard>
        <PgCard v-else-if="step === 'unavailable'" tone="soft" class="pg-solution__note" data-testid="solution-unavailable">
          <text class="pg-solution__notetext">{{ SOLUTION_COPY.noneBody }}</text>
        </PgCard>

        <!-- 第一步：还没看。金色 = 要花点代价 -->
        <PgCard v-else-if="step === 'offer'" tone="bee" class="pg-solution__offer" data-testid="solution-offer">
          <text class="pg-solution__offertext">{{ SOLUTION_COPY.offerBody }}</text>
          <PgButton
            v-if="next === 'approach'"
            variant="hint"
            block
            sound="tap"
            data-testid="solution-reveal-approach"
            :loading="revealing"
            @tap="reveal('approach')"
          >
            {{ SOLUTION_COPY.offerAction }}
          </PgButton>
          <PgButton v-else-if="next === 'full'" variant="hint" block sound="tap" data-testid="solution-reveal-full" :loading="revealing" @tap="askFull">
            {{ SOLUTION_COPY.fullAction }}
          </PgButton>
        </PgCard>

        <!-- 思路和关键想法 -->
        <view v-if="solution.approach" class="pg-solution__block" data-testid="solution-approach">
          <text class="pg-solution__label">{{ SOLUTION_COPY.approach }}</text>
          <MathText class="pg-solution__body" :text="solution.approach" block />
        </view>
        <view v-if="solution.keyIdeas?.length" class="pg-solution__block" data-testid="solution-keyideas">
          <text class="pg-solution__label">{{ SOLUTION_COPY.keyIdeas }}</text>
          <view v-for="(idea, i) in solution.keyIdeas" :key="i" class="pg-solution__idea">
            <text class="pg-solution__ideanum">{{ i + 1 }}</text>
            <MathText class="pg-solution__body" :text="idea" block />
          </view>
        </view>
        <view v-if="solution.pitfalls?.length" class="pg-solution__block" data-testid="solution-pitfalls">
          <text class="pg-solution__label">{{ SOLUTION_COPY.pitfalls }}</text>
          <MathText v-for="(pit, i) in solution.pitfalls" :key="i" class="pg-solution__body" :text="pit" block />
        </view>

        <!-- 第二步：看过思路，还能再看完整证明 -->
        <view v-if="step === 'approach' && next === 'full'" class="pg-solution__more">
          <PgButton variant="hint" block sound="tap" data-testid="solution-reveal-full" :loading="revealing" @tap="askFull">{{ SOLUTION_COPY.fullAction }}</PgButton>
        </view>

        <!-- 第三步：完整证明 -->
        <view v-if="solution.referenceProof" class="pg-solution__proof" data-testid="solution-full">
          <text class="pg-solution__label">{{ SOLUTION_COPY.reference }}</text>
          <MathText class="pg-solution__proofbody" :text="solution.referenceProof" block serif />
        </view>
        <text v-else-if="step === 'full'" class="pg-solution__muted" data-testid="solution-nofull">{{ SOLUTION_COPY.noFull }}</text>

        <AiGeneratedTag v-if="solution.aiGenerated && (solution.approach || solution.referenceProof)" />
        <text v-if="revealError" class="pg-solution__error" role="alert" data-testid="solution-reveal-error">{{ revealError }}</text>
      </template>
    </PgSheet>

    <PgDialog
      v-model:open="confirmFull"
      :title="SOLUTION_COPY.confirmTitle"
      :body="SOLUTION_COPY.confirmBody"
      :confirm-text="SOLUTION_COPY.confirmGo"
      :busy="revealing"
      data-testid="solution-confirm"
      confirm-testid="solution-confirm-go"
      cancel-testid="solution-confirm-cancel"
      @confirm="reveal('full')"
    />
  </template>
</template>

<style scoped>
.pg-solution__title { margin-top: var(--sp-1); color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-solution__note { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3); }
.pg-solution__noteicon { flex: none; color: var(--ink-2); }
.pg-solution__notetext { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-solution__offer { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3); }
.pg-solution__offertext { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-solution__block { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-solution__label { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-solution__body { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); min-width: 0; }
.pg-solution__idea { display: flex; align-items: flex-start; gap: var(--sp-2); }
.pg-solution__ideanum {
  flex: none;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
}
.pg-solution__more { margin-top: var(--sp-1); }
.pg-solution__proof { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-12); background: var(--paper-2); }
.pg-solution__proofbody { color: var(--ink); font-size: var(--fs-16); line-height: var(--lh-body); }
.pg-solution__muted { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-solution__error { padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--fox-soft); color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.5; }
</style>
