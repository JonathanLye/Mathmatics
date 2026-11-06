<script setup lang="ts">
/** 完成页：主作答的完成卡，或迁移题子作答的完成卡（给出回到本题 / 加入证明本的出口，01 §L5）。 */
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgFold from '@/components/ui/PgFold.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { COPY, independenceCopy } from '@/copy'
import type { AttemptState } from '@/types/attempt'

defineProps<{ state: AttemptState; child?: boolean }>()
defineEmits<{
  (e: 'back-to-parent'): void
  (e: 'proofbook'): void
  (e: 'make-transfer'): void
  (e: 'home'): void
}>()
</script>

<template>
  <view v-if="child" class="pg-practice__done pg-sheet" data-testid="transfer-complete-card">
    <text class="pg-practice__donetitle" data-testid="transfer-complete-title">这道题也完成了</text>
    <view class="pg-practice__donebody pg-small">
      <MathText :text="state.problem.title" />：你把 $\varepsilon$-$N$ 的骨架用到了 $\varepsilon$-$\delta$ 上。
    </view>
    <text class="pg-practice__donebody pg-small">{{ independenceCopy(state.budget.keysOwn, state.budget.keysTotal) }}。</text>
    <PgFold :title="COPY.extensionFold" class="pg-practice__donebody">
      <text>mathlib4 对照（只列定理名）：{{ state.completion?.leanCard?.theorems?.join('、') ?? '—' }}</text>
    </PgFold>
    <view class="pg-practice__donerow">
      <PgButton variant="secondary" data-testid="back-to-parent" @tap="$emit('back-to-parent')">回到本题完成页</PgButton>
      <PgButton data-testid="transfer-add-to-notebook" @tap="$emit('proofbook')">加入证明本</PgButton>
    </view>
  </view>

  <view v-else class="pg-practice__done pg-practice__done--win" data-testid="completion-card">
    <view class="pg-win__paper" aria-hidden="true">
      <view class="pg-win__sk" style="width: 82%" /><view class="pg-win__sk" style="width: 64%" /><view class="pg-win__sk" style="width: 73%" />
      <view class="pg-win__stamp"><PgIcon name="qed" :size="44" color="currentColor" /></view>
    </view>
    <view class="pg-win__mascot"><PgMascot expr="cheer" :size="84" /></view>
    <text class="pg-practice__donetitle" data-testid="completion-title">本题完成</text>
    <text class="pg-win__big" data-testid="completion-independence">{{ independenceCopy(state.budget.keysOwn, state.budget.keysTotal) }}</text>
    <view class="pg-win__keys" aria-hidden="true">
      <view
        v-for="k in state.budget.keysTotal"
        :key="k"
        class="pg-win__key"
        :class="{ 'pg-win__key--hint': k > state.budget.keysOwn }"
      >
        <PgIcon :name="k > state.budget.keysOwn ? 'bulb' : 'check'" :size="26" tone="ink" />
      </view>
    </view>
    <text class="pg-practice__donebody pg-small">
      自己写出 {{ state.budget.keysOwn }} / {{ state.budget.keysTotal }} 个关键步骤；{{ COPY.hintBudget }}用了 {{ state.budget.revealUsed }} / {{ state.budget.revealMax }}。
    </text>
    <text v-if="state.completion?.leanCard?.steps?.length" class="pg-practice__donebody pg-small">
      你写出的关键步骤：{{ state.completion?.leanCard?.steps?.map((s) => s.label).join('、') }}
    </text>
    <text class="pg-practice__donebody pg-small">{{ COPY.honestNote }}。</text>
    <PgFold :title="COPY.extensionFold" class="pg-practice__donebody">
      <text>mathlib4 对照（只列定理名）：{{ state.completion?.leanCard?.theorems?.join('、') ?? '—' }}</text>
    </PgFold>
    <view class="pg-practice__donerow pg-practice__donerow--win">
      <PgButton class="pg-win__btn" variant="secondary" block size="lg" data-testid="add-to-notebook" @tap="$emit('proofbook')">加入证明本</PgButton>
      <PgButton class="pg-win__btn pg-win__btn--ghost" variant="ghost" block data-testid="make-transfer" @tap="$emit('make-transfer')">再换一道题试试</PgButton>
      <PgButton class="pg-win__btn pg-win__btn--ghost" variant="ghost" block data-testid="back-home" @tap="$emit('home')">回首页</PgButton>
    </view>
  </view>
</template>

<style scoped>
.pg-practice__done { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-practice__donetitle { font-size: var(--fs-22); font-weight: var(--fw-black); }
.pg-practice__donebody { color: var(--ink-2); font-weight: var(--fw-bold); }
.pg-practice__donerow { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
/* 完成页：整块主色 + ∎ 落章。文字用 on-accent，深浅主题都够对比度。 */
.pg-practice__done--win {
  position: relative;
  margin: var(--sp-3) calc(-1 * var(--sp-3)) 0;
  padding: 150px var(--sp-4) var(--sp-6);
  align-items: center;
  gap: var(--sp-2);
  background: var(--accent);
  color: var(--on-accent);
  border-radius: var(--radius-24);
  margin-bottom: var(--sp-6);
  text-align: center;
}
.pg-win__paper { position: absolute; left: 32px; right: 32px; top: 36px; height: 120px; padding: 20px 22px; border-radius: var(--radius-16); background: var(--sheet); box-shadow: 0 var(--lip) 0 var(--accent-lip); }
.pg-win__sk { height: 10px; margin-bottom: var(--sp-3); border-radius: var(--radius-pill); background: var(--rule); }
.pg-win__stamp { position: absolute; right: 14px; bottom: -34px; width: 80px; height: 80px; border-radius: var(--radius-24); background: var(--accent); color: var(--on-accent); border: 5px solid var(--sheet); box-shadow: 0 var(--lip) 0 var(--accent-lip); display: flex; align-items: center; justify-content: center; transform: rotate(-8deg); animation: pg-stamp 700ms var(--ease-spring) both; }
.pg-win__mascot { position: absolute; right: 18px; top: -34px; }
.pg-practice__done--win .pg-practice__donetitle { margin-top: var(--sp-3); font-size: var(--fs-15); opacity: 0.95; }
.pg-win__big { font-size: var(--fs-28); line-height: var(--lh-tight); font-weight: var(--fw-black); }
.pg-win__keys { display: flex; gap: var(--sp-2); justify-content: center; margin: var(--sp-2) 0; }
.pg-win__key { width: 44px; height: 44px; border-radius: var(--radius-12); background: var(--sheet); color: var(--ink); box-shadow: 0 var(--lip) 0 var(--accent-lip); display: flex; align-items: center; justify-content: center; animation: pg-pop 380ms var(--ease-spring) both; }
.pg-win__key--hint { background: var(--bee); color: var(--on-bee); box-shadow: 0 var(--lip) 0 var(--bee-lip); }
.pg-practice__done--win .pg-practice__donebody { color: var(--on-accent); opacity: 0.95; }
.pg-practice__donerow--win { flex-direction: column; align-self: stretch; margin-top: var(--sp-3); gap: var(--sp-3); }
.pg-win__btn--ghost.pg-button { color: var(--on-accent); }
</style>
