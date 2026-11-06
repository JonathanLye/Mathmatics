<script setup lang="ts">
/**
 * 实时看板（v2）：状态就是整块颜色。
 * 顶部 KPI 即筛选；中间学生瓦片按紧急度排序；右侧「需要你」队列 + 全班在哪一层。
 * 数据全部来自 LiveRow（服务端口径），这里只做分类、排序与展示，不下结论。
 */
import { computed } from 'vue';

import type { LiveRow } from '../api/types.ts';
import { boardStats, filterRows, footText, layerIndex, minutes, sortRows, toneOf, type BoardFilter, type Tone } from '../utils/liveBoard.ts';
import MathTextView from './MathTextView.vue';
import Icon from './ui/Icon.vue';

const props = withDefaults(defineProps<{ rows: LiveRow[]; revealMax?: number; filter: BoardFilter }>(), { revealMax: 2 });
const emit = defineEmits<{ (e: 'update:filter', value: BoardFilter): void; (e: 'open', row: LiveRow): void }>();

const stats = computed(() => boardStats(props.rows));
const kpis = computed(() => [
  { key: 'help' as const, label: '需要你', value: stats.value.needs },
  { key: 'stuck' as const, label: '卡住', value: stats.value.stuck },
  { key: 'write' as const, label: '在写', value: stats.value.write },
  { key: 'away' as const, label: '离开中', value: stats.value.away },
  { key: 'done' as const, label: '已完成', value: `${stats.value.done}/${stats.value.total}` },
  { key: 'idle' as const, label: '未开始', value: stats.value.idle },
]);
const ordered = computed(() => sortRows(filterRows(props.rows, props.filter)));
const queueAll = computed(() => sortRows(props.rows).filter((row) => ['help', 'stuck'].includes(toneOf(row))));
const queue = computed(() => queueAll.value.slice(0, 5));
const funnel = computed(() => {
  const counts = [1, 2, 3, 4, 5, 6].map((n) => props.rows.filter((row) => row.status !== 'completed' && layerIndex(row) === n).length);
  const max = Math.max(1, ...counts);
  return counts.map((n, i) => ({ label: `L${i + 1}`, n, pct: n === 0 ? 0 : Math.max(4, Math.round((n / max) * 100)) }));
});

const AVATAR: Record<Tone, string> = { help: '#ff4b4b', stuck: '#ff9600', away: '#afafaf', write: '#1cb0f6', done: '#58cc02', idle: '#afafaf' };
const STATUS: Record<Tone, string> = { help: '求助', stuck: '卡住', away: '离开', write: '在写', done: '已完成', idle: '未开始' };
const TAG: Record<Tone, string> = { help: '需要你', stuck: '卡住', away: '离开', write: '在写', done: '已完成', idle: '未开始' };

function initial(row: LiveRow): string {
  return (row.displayName ?? row.anonCode).replace(/^S-/, '').slice(0, 1);
}
function nameOf(row: LiveRow): string {
  return row.displayName ?? row.anonCode;
}
function statusText(row: LiveRow): string {
  const tone = toneOf(row);
  return tone === 'stuck' ? `卡住 ${minutes(row.stuckSec)} 分` : tone === 'away' && row.awayCount ? `离开 ${row.awayCount} 次` : STATUS[tone];
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
function bulbOff(row: LiveRow, i: number): boolean {
  return i < Math.round(row.reveal ?? 0);
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
          class="stat-card lb__kpi clickable"
          :class="['lb__kpi--' + item.key, { selected: filter === item.key }]"
          role="button"
          tabindex="0"
          :aria-pressed="filter === item.key"
          :title="`筛选：${item.label}（再次点击取消）`"
          @click="toggle(item.key)"
          @keydown.enter="toggle(item.key)"
          @keydown.space.prevent="toggle(item.key)"
        >
          <div class="value">{{ item.value }}</div>
          <div class="label">{{ item.label }}</div>
        </div>
      </div>

      <div v-if="ordered.length === 0" class="empty">
        {{ filter ? '当前筛选下没有学生。' : '暂无作答数据：学生用邀请码登录并开始练习后会出现在这里。' }}
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
            <span class="pg-avatar" :style="{ width: '36px', height: '36px', fontSize: '15px', background: AVATAR[toneOf(row)] }">{{ initial(row) }}</span>
            <b class="lb__name">{{ nameOf(row) }}</b>
            <span class="pg-pill lb__tag">{{ statusText(row) }}</span>
          </span>
          <span class="lb__seg" aria-label="层进度"><i v-for="n in 6" :key="n" :class="segState(row, n)" /></span>
          <span class="lb__row2">
            <span class="lb__pips" aria-label="自己写出的关键步骤"><i v-for="(p, i) in keyPips(row)" :key="i" :class="p"><Icon v-if="p === 'own'" name="check" :size="12" /></i></span>
            <span class="lb__bulbs" aria-label="透露额度"><Icon v-for="i in Math.max(1, revealMax)" :key="i" name="bulb" :size="16" :tone="bulbOff(row, i - 1) ? 'off' : 'on'" /></span>
          </span>
          <span class="lb__foot"><MathTextView :text="footText(row)" /></span>
        </button>
      </div>
    </div>

    <aside class="lb__rail">
      <div class="lb__railhead"><span class="pg-kicker lb__needs">优先处理</span><span class="pg-pill lb__count">{{ queueAll.length }}</span></div>
      <div v-if="queue.length === 0" class="pg-card lb__ok">现在没有人需要你。</div>
      <div v-else-if="queueAll.length > queue.length" class="pg-kicker">按紧急度显示前 {{ queue.length }} 位，另有 {{ queueAll.length - queue.length }} 位在左侧卡片里</div>
      <button v-for="row in queue" :key="'q-' + row.anonCode" class="pg-card lb__q" type="button" :disabled="!row.attemptId" @click="emit('open', row)">
        <span class="lb__qtop">
          <span class="pg-avatar" :style="{ width: '30px', height: '30px', fontSize: '13px', background: AVATAR[toneOf(row)] }">{{ initial(row) }}</span>
          <b>{{ nameOf(row) }}</b>
          <span class="pg-pill lb__qtag" :class="'lb__qtag--' + toneOf(row)">{{ TAG[toneOf(row)] }}</span>
        </span>
        <span class="lb__qtext"><MathTextView :text="footText(row)" /></span>
        <span class="lb__qgo">打开详情，补发提示或发一句话 <Icon name="fwd" :size="16" /></span>
      </button>
      <div class="pg-card lb__funnel">
        <div class="pg-kicker">全班在哪一层</div>
        <div v-for="item in funnel" :key="item.label" class="lb__frow">
          <b>{{ item.label }}</b><span class="lb__fbar"><i :style="{ width: item.pct + '%' }" /></span><b class="lb__fn">{{ item.n }}</b>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.lb { display: flex; gap: 22px; align-items: flex-start; }
.lb__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.lb__rail { width: 352px; flex: none; display: flex; flex-direction: column; gap: 12px; }
.lb__kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.lb__kpi { cursor: pointer; padding: 8px 14px; user-select: none; }
.lb__kpi--help { background: var(--pg-chili); border-color: var(--pg-chili-lip); color: #14290a; }
.lb__kpi--help .label { color: #14290a; }
.lb__kpi--stuck { background: var(--pg-fox-soft); border-color: var(--pg-fox); border-bottom-color: var(--pg-fox-lip); color: var(--pg-fox-text); }
.lb__kpi--write { background: var(--pg-sea-soft); border-color: var(--pg-sea); border-bottom-color: var(--pg-sea-lip); color: var(--pg-sea-text); }
.lb__kpi--away { background: var(--pg-soft); }
.lb__kpi--done { background: var(--pg-grass-soft); border-color: var(--pg-grass); border-bottom-color: var(--pg-grass-lip); color: var(--pg-grass-text); }
.lb__kpi--idle { color: var(--pg-ink-3); }
.lb__kpi.selected { outline: 3px solid var(--pg-sea); outline-offset: 2px; }
.lb__kpi--stuck .label, .lb__kpi--write .label, .lb__kpi--done .label { color: inherit; }
.lb__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 14px; }
.lb__tile {
  display: flex; flex-direction: column; gap: 12px; min-height: 172px; padding: 12px 14px; text-align: left; font: inherit; color: var(--pg-ink);
  border: 2px solid var(--pg-rule); border-bottom: 5px solid var(--pg-rule); border-radius: 16px; background: var(--pg-surface); cursor: pointer;
}
.lb__tile:disabled { cursor: default; }
.lb__tile:not(:disabled):active { transform: translateY(2px); border-bottom-width: 3px; }
.lb__tile--help { background: var(--pg-chili-soft); border-color: var(--pg-chili); border-bottom-color: var(--pg-chili-lip); }
.lb__tile--stuck { background: var(--pg-fox-soft); border-color: var(--pg-fox); border-bottom-color: var(--pg-fox-lip); }
.lb__tile--away { background: var(--pg-soft); }
.lb__tile--done { background: var(--pg-grass-soft); border-color: var(--pg-grass); border-bottom-color: var(--pg-grass-lip); }
.lb__tile--idle { border-style: dashed; border-bottom-width: 2px; opacity: 0.85; }
.lb__top { display: flex; align-items: center; gap: 10px; }
.lb__name { font-size: 17px; font-weight: 900; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb__tag { margin-left: auto; height: 26px; background: var(--pg-sea-soft); color: var(--pg-sea-text); }
.lb__tile--help .lb__tag { background: var(--pg-chili-face); color: #fff; }
.lb__tile--stuck .lb__tag { background: var(--pg-fox-text); color: #fff; }
.lb__tile--away .lb__tag, .lb__tile--idle .lb__tag { background: var(--pg-rule); color: var(--pg-ink-2); }
.lb__tile--done .lb__tag { background: var(--pg-grass-text); color: #fff; }
.lb__seg { display: flex; gap: 3px; }
.lb__seg i { flex: 1; height: 10px; border-radius: 5px; background: var(--pg-rule); position: relative; overflow: hidden; }
.lb__seg i.d { background: var(--pg-grass); }
.lb__seg i.c::after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 55%; background: var(--pg-sea); border-radius: 5px; }
.lb__row2 { display: flex; align-items: center; justify-content: space-between; }
.lb__pips { display: flex; gap: 5px; }
.lb__pips i { width: 20px; height: 20px; border-radius: 10px; border: 2px solid var(--pg-rule); display: inline-flex; align-items: center; justify-content: center; }
.lb__pips i.own { background: var(--pg-grass); border-color: var(--pg-grass); color: #14290a; }
.lb__bulbs { display: inline-flex; gap: 2px; }
.lb__foot { font-size: 13px; font-weight: 800; line-height: 1.35; color: var(--pg-ink-2); }
.lb__tile--help .lb__foot { color: var(--pg-chili-text); }
.lb__tile--stuck .lb__foot { color: var(--pg-fox-text); }
.lb__tile--done .lb__foot { color: var(--pg-grass-text); }
.lb__railhead { display: flex; align-items: center; gap: 8px; }
.lb__needs { color: var(--pg-chili-text); }
.lb__count { height: 22px; padding: 0 8px; background: var(--pg-chili-face); color: #fff; }
.lb__ok { padding: 14px; font-weight: 800; color: var(--pg-ink-2); }
.lb__q { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; text-align: left; font: inherit; color: var(--pg-ink); cursor: pointer; }
.lb__q:active { transform: translateY(2px); border-bottom-width: 2px; }
.lb__qtop { display: flex; align-items: center; gap: 10px; font-size: 16px; }
.lb__qtag { margin-left: auto; height: 24px; }
.lb__qtag--help { background: var(--pg-chili-face); color: #fff; }
.lb__qtag--stuck { background: var(--pg-fox-text); color: #fff; }
.lb__qtext { font-size: 13px; font-weight: 700; line-height: 1.45; color: var(--pg-ink-2); }
.lb__qgo { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 900; letter-spacing: 0.3px; color: var(--pg-sea-text); }
.lb__funnel { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.lb__frow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--pg-ink-2); }
.lb__frow b:first-child { width: 22px; }
.lb__fbar { flex: 1; height: 12px; border-radius: 6px; background: var(--pg-soft); position: relative; }
.lb__fbar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: var(--pg-sea); }
.lb__fn { width: 20px; text-align: right; color: var(--pg-ink); }
@media (max-width: 1100px) { .lb { flex-direction: column; } .lb__rail { width: 100%; } .lb__kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
