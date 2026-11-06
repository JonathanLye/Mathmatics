<script setup lang="ts">
/**
 * 实时看板：每个学生一张白色小卡，状态只用左侧色条和一枚标签表示，整张卡不上色。
 * 顶部数字即筛选；右侧是“优先处理”队列和全班在哪一层。
 * 数据全部来自服务端的看板行，这里只做分类、排序与展示，不下结论。
 */
import { computed } from 'vue';

import type { LiveRow } from '../api/types.ts';
import { boardStats, filterRows, flagChips, footText, layerIndex, sortRows, statusLabel, toneOf, type BoardFilter, type Tone } from '../utils/liveBoard.ts';
import { layerName } from '../utils/layers.ts';
import MathTextView from './MathTextView.vue';
import Icon from './ui/Icon.vue';

const props = withDefaults(defineProps<{ rows: LiveRow[]; revealMax?: number; filter: BoardFilter }>(), { revealMax: 2 });
const emit = defineEmits<{ (e: 'update:filter', value: BoardFilter): void; (e: 'open', row: LiveRow): void }>();

const stats = computed(() => boardStats(props.rows));
const kpis = computed(() => [
  { key: 'help' as const, label: '需要你', value: stats.value.needs, hint: '求助老师、提示额度用完或作答被锁定' },
  { key: 'stuck' as const, label: '卡住', value: stats.value.stuck, hint: '写证明时 3 分钟没有新的关键步骤' },
  { key: 'write' as const, label: '在写', value: stats.value.write, hint: '' },
  { key: 'away' as const, label: '离开中', value: stats.value.away, hint: '' },
  { key: 'done' as const, label: '已完成', value: `${stats.value.done}/${stats.value.total}`, hint: '' },
  { key: 'idle' as const, label: '未开始', value: stats.value.idle, hint: '' },
]);
const ordered = computed(() => sortRows(filterRows(props.rows, props.filter)));
const queueAll = computed(() => sortRows(props.rows).filter((row) => ['help', 'stuck'].includes(toneOf(row))));
const queue = computed(() => queueAll.value.slice(0, 5));
const funnel = computed(() => {
  const counts = [1, 2, 3, 4, 5, 6].map((n) => props.rows.filter((row) => row.status !== 'completed' && layerIndex(row) === n).length);
  const max = Math.max(1, ...counts);
  return counts.map((n, i) => ({ label: layerName(`L${i + 1}`), n, pct: n === 0 ? 0 : Math.max(4, Math.round((n / max) * 100)) }));
});

function initial(row: LiveRow): string {
  return (row.displayName ?? row.anonCode).replace(/^S-/, '').slice(0, 1);
}
function nameOf(row: LiveRow): string {
  return row.displayName ?? row.anonCode;
}
function keyPips(row: LiveRow): Array<'own' | 'empty'> {
  const total = Math.max(0, Math.min(8, row.keysTotal ?? 4));
  const own = Math.min(total, row.keysOwn ?? 0);
  return Array.from({ length: total }, (_, i) => (i < own ? 'own' : 'empty'));
}
function segState(row: LiveRow, n: number): 'd' | 'c' | '' {
  const cur = layerIndex(row);
  return n < cur ? 'd' : n === cur ? 'c' : '';
}
function revealText(row: LiveRow): string {
  const used = Math.round((row.reveal ?? 0) * 10) / 10;
  return `提示额度 ${used} / ${props.revealMax}`;
}
function toggle(key: Tone): void {
  emit('update:filter', props.filter === key ? null : key);
}
</script>

<template>
  <div class="lb">
    <div class="lb__main">
      <div class="lb__kpis">
        <div
          v-for="item in kpis"
          :key="item.key"
          class="stat-card lb__kpi"
          :class="['lb__kpi--' + item.key, { selected: filter === item.key }]"
          role="button"
          tabindex="0"
          :aria-pressed="filter === item.key"
          :title="`筛选：${item.label}${item.hint ? '（' + item.hint + '）' : ''}；再次点击取消`"
          @click="toggle(item.key)"
          @keydown.enter="toggle(item.key)"
          @keydown.space.prevent="toggle(item.key)"
        >
          <div class="value">{{ item.value }}</div>
          <div class="label"><i class="lb__dot" />{{ item.label }}</div>
        </div>
      </div>

      <div v-if="ordered.length === 0" class="empty">
        {{ filter ? '当前筛选下没有学生。' : '还没有作答：学生用邀请码登录并开始练习后，会出现在这里。' }}
      </div>
      <div v-else class="lb__grid">
        <button
          v-for="row in ordered"
          :key="row.anonCode"
          class="lb__tile live-tile"
          :class="'lb__tile--' + toneOf(row)"
          :data-testid="'live-tile-' + row.anonCode"
          :disabled="!row.attemptId"
          type="button"
          @click="emit('open', row)"
        >
          <span class="lb__top">
            <span class="pg-avatar lb__av">{{ initial(row) }}</span>
            <b class="lb__name">{{ nameOf(row) }}</b>
            <span class="lb__tag" :data-testid="'live-status-' + row.anonCode">{{ statusLabel(row) }}</span>
          </span>
          <span v-if="flagChips(row).length > 0" class="lb__chips">
            <span v-for="chip in flagChips(row)" :key="chip.text" class="pg-pill" :class="'pg-pill--' + chip.tone">{{ chip.text }}</span>
          </span>
          <span class="lb__seg" role="img" :aria-label="'进度：' + (layerName(row.layer) || '未开始')"><i v-for="n in 6" :key="n" :class="segState(row, n)" /></span>
          <span class="lb__row2">
            <span class="lb__pips" role="img" :aria-label="`自己写出 ${row.keysOwn ?? 0} / ${row.keysTotal ?? 0} 个关键步骤`">
              <i v-for="(p, i) in keyPips(row)" :key="i" :class="p"><Icon v-if="p === 'own'" name="check" :size="11" /></i>
            </span>
            <span class="lb__reveal">{{ revealText(row) }}</span>
          </span>
          <span class="lb__foot"><MathTextView :text="footText(row)" /></span>
        </button>
      </div>
    </div>

    <aside class="lb__rail">
      <div class="lb__railhead"><span class="pg-kicker">优先处理</span><span class="pg-pill lb__count">{{ queueAll.length }}</span></div>
      <div v-if="queue.length === 0" class="pg-card lb__ok">现在没有人需要你。</div>
      <div v-else-if="queueAll.length > queue.length" class="pg-kicker">按紧急度显示前 {{ queue.length }} 位，另有 {{ queueAll.length - queue.length }} 位在左侧的卡片里</div>
      <button
        v-for="row in queue"
        :key="'q-' + row.anonCode"
        class="pg-card lb__q"
        :class="'lb__q--' + toneOf(row)"
        type="button"
        :disabled="!row.attemptId"
        @click="emit('open', row)"
      >
        <span class="lb__qtop">
          <b>{{ nameOf(row) }}</b>
          <span class="lb__tag">{{ statusLabel(row) }}</span>
        </span>
        <span class="lb__qtext"><MathTextView :text="footText(row)" /></span>
        <span class="lb__qgo">打开详情，补发提示或发一句话 <Icon name="fwd" :size="14" /></span>
      </button>
      <div class="pg-card lb__funnel">
        <div class="pg-kicker">全班在哪一层</div>
        <div v-for="item in funnel" :key="item.label" class="lb__frow">
          <span class="lb__fname">{{ item.label }}</span><span class="lb__fbar"><i :style="{ width: item.pct + '%' }" /></span><b class="lb__fn">{{ item.n }}</b>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.lb { display: flex; gap: 20px; align-items: flex-start; }
.lb__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.lb__rail { width: 320px; flex: none; display: flex; flex-direction: column; gap: 10px; }

/* 顶部数字：白底细边的小按钮，选中时描青绿边；只有数字前的小圆点带状态色 */
.lb__kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.lb__kpi { cursor: pointer; user-select: none; padding: 8px 12px; }
.lb__kpi:hover { border-color: var(--pg-rule-2); }
.lb__kpi.selected { border-color: var(--pg-accent); box-shadow: 0 0 0 1px var(--pg-accent); }
.lb__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--pg-ink-3); }
.lb__kpi--help .lb__dot { background: var(--pg-chili); }
.lb__kpi--stuck .lb__dot { background: var(--pg-fox); }
.lb__kpi--write .lb__dot { background: var(--pg-accent); }
.lb__kpi--done .lb__dot { background: var(--pg-grass); }
.lb__kpi--help .value { color: var(--pg-chili-text); }

.lb__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 12px; }

/* 学生卡：白底细边，左侧 4px 色条表示状态；整张卡不上色 */
.lb__tile {
  --tone: var(--pg-ink-3);
  display: flex; flex-direction: column; gap: 10px; min-height: 150px; padding: 12px 14px; text-align: left; font: inherit; color: var(--pg-ink);
  border: 1px solid var(--pg-border); border-left: 4px solid var(--tone); border-radius: var(--pg-radius); background: var(--pg-surface); cursor: pointer;
}
.lb__tile:hover:not(:disabled) { border-color: var(--pg-rule-2); border-left-color: var(--tone); }
.lb__tile:disabled { cursor: default; }
.lb__tile--help { --tone: var(--pg-chili); }
.lb__tile--stuck { --tone: var(--pg-fox); }
.lb__tile--write { --tone: var(--pg-accent); }
.lb__tile--done { --tone: var(--pg-grass); }
.lb__tile--away { --tone: var(--pg-ink-3); }
.lb__tile--idle { --tone: transparent; border-style: dashed; border-left-width: 1px; }
.lb__top { display: flex; align-items: center; gap: 8px; }
.lb__av { width: 28px; height: 28px; font-size: 13px; }
.lb__name { font-size: 15px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb__tag {
  margin-left: auto; flex: none; height: 22px; padding: 0 8px; border-radius: 6px; font-size: 12px; font-weight: 600; line-height: 22px; white-space: nowrap;
  background: var(--pg-soft); color: var(--pg-ink-2);
}
.lb__tile--help .lb__tag, .lb__q--help .lb__tag { background: var(--pg-chili-soft); color: var(--pg-chili-text); }
.lb__tile--stuck .lb__tag, .lb__q--stuck .lb__tag { background: var(--pg-fox-soft); color: var(--pg-fox-text); }
.lb__tile--write .lb__tag { background: var(--pg-accent-soft); color: var(--pg-accent-text); }
.lb__tile--done .lb__tag { background: var(--pg-grass-soft); color: var(--pg-grass-text); }
.lb__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.lb__seg { display: flex; gap: 3px; }
.lb__seg i { flex: 1; height: 6px; border-radius: 3px; background: var(--pg-rule); position: relative; overflow: hidden; }
.lb__seg i.d { background: var(--pg-grass); }
.lb__seg i.c { background: var(--pg-accent); }
.lb__row2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lb__pips { display: flex; gap: 4px; }
.lb__pips i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--pg-rule-2); display: inline-flex; align-items: center; justify-content: center; }
.lb__pips i.own { background: var(--pg-grass); border-color: var(--pg-grass); color: #fff; }
:root[data-theme='dark'] .lb__pips i.own { color: var(--on-ok); }
.lb__reveal { font-size: 12px; color: var(--pg-ink-2); white-space: nowrap; }
.lb__foot { font-size: 13px; line-height: 1.45; color: var(--pg-ink-2); }
.lb__tile--help .lb__foot { color: var(--pg-chili-text); }
.lb__tile--stuck .lb__foot { color: var(--pg-fox-text); }

.lb__railhead { display: flex; align-items: center; gap: 8px; }
.lb__count { background: var(--pg-chili-soft); color: var(--pg-chili-text); }
.lb__ok { padding: 12px 14px; color: var(--pg-ink-2); }
.lb__q {
  --tone: var(--pg-ink-3);
  display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; text-align: left; font: inherit; color: var(--pg-ink); cursor: pointer;
  border-left: 4px solid var(--tone);
}
.lb__q--help { --tone: var(--pg-chili); }
.lb__q--stuck { --tone: var(--pg-fox); }
.lb__q:disabled { cursor: default; }
.lb__qtop { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.lb__qtext { font-size: 13px; line-height: 1.45; color: var(--pg-ink-2); }
.lb__qgo { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--pg-accent-text); }
.lb__funnel { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.lb__frow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--pg-ink-2); }
.lb__fname { width: 56px; flex: none; }
.lb__fbar { flex: 1; height: 8px; border-radius: 4px; background: var(--pg-soft); position: relative; overflow: hidden; }
.lb__fbar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--pg-accent); }
.lb__fn { width: 20px; text-align: right; color: var(--pg-ink); }
@media (max-width: 1100px) { .lb { flex-direction: column; } .lb__rail { width: 100%; } .lb__kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
