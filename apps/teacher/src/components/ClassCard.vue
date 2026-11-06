<script setup lang="ts">
/** 班级列表里的一张卡：班名、学期、已认领进度、邀请码。沉稳的白卡，不带插画。 */
import { computed } from 'vue';

import type { ClassSummary } from '../api/types.ts';

const props = defineProps<{ item: ClassSummary }>();
defineEmits<{ (e: 'open', item: ClassSummary): void }>();

const share = computed(() => (props.item.students > 0 ? Math.min(1, (props.item.claimed ?? 0) / props.item.students) : 0));
const percent = computed(() => Math.round(share.value * 100));
</script>

<template>
  <button type="button" class="cc" :data-testid="`class-card-${item.classId}`" @click="$emit('open', item)">
    <span class="cc__head">
      <b class="cc__name">{{ item.name }}</b>
      <span class="pg-pill">{{ item.term }}</span>
    </span>
    <span class="cc__stat">
      <span class="cc__num">{{ item.claimed }}<span class="cc__of"> / {{ item.students }}</span></span>
      <span class="pg-kicker">人已认领账号（名单 {{ item.students }} 人）</span>
    </span>
    <span class="cc__bar" role="img" :aria-label="`已认领 ${item.claimed} / ${item.students}`"><i :style="{ width: percent + '%' }" /></span>
    <span class="cc__code"><span class="pg-kicker">邀请码</span><code class="mono">{{ item.inviteCode }}</code></span>
  </button>
</template>

<style scoped>
.cc {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  text-align: left;
  font: inherit;
  color: var(--pg-text);
  cursor: pointer;
  background: var(--pg-surface);
  border: 1px solid var(--pg-border);
  border-radius: var(--pg-radius);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.cc:hover { border-color: var(--accent); box-shadow: 0 1px 6px rgb(0 0 0 / 0.06); }
.cc:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.cc__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cc__name { font-size: 16px; font-weight: 700; line-height: 1.3; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc__stat { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cc__num { font-size: 22px; font-weight: 700; line-height: 1.2; }
.cc__of { font-size: 14px; font-weight: 600; color: var(--pg-text-secondary); }
.cc__bar { display: block; height: 6px; border-radius: 3px; background: var(--pg-soft); overflow: hidden; }
.cc__bar i { display: block; height: 100%; background: var(--pg-accent); border-radius: 3px; }
.cc__code { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--pg-border); }
.cc__code code { font-weight: 700; font-size: 14px; color: var(--pg-accent-text); }
@media (prefers-reduced-motion: reduce) { .cc { transition: none; } }
</style>
