<script setup lang="ts">
/** 自学进度：学生在“路径”和“练习”里自己做的题，按学习路径的单元汇总。这些不进实时看板、班级指标和导出。 */
import { computed, onMounted, ref, watch } from 'vue';

import { api, ApiError } from '../api/client.ts';
import type { SelfStudyView } from '../api/types.ts';
import { sortStudents, summarizeSelfStudy } from '../utils/selfStudy.ts';

const props = defineProps<{ classId: string; active: boolean }>();

const view = ref<SelfStudyView | null>(null);
const loading = ref(false);
const error = ref('');
let loadedFor = '';

const summary = computed(() => summarizeSelfStudy(view.value));
const students = computed(() => sortStudents(view.value?.students ?? []));

async function load(): Promise<void> {
  if (props.classId === '') return;
  loading.value = true;
  error.value = '';
  try {
    view.value = await api.get<SelfStudyView>(`/api/v1/teacher/classes/${props.classId}/self-study`);
    loadedFor = props.classId;
  } catch (caught) {
    view.value = null;
    error.value = caught instanceof ApiError ? caught.message : '自学进度加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

// 切到这个页签时才加载（第一次或换了班级）；回到页签再看一次最新的
watch(
  () => props.active,
  (active) => {
    if (active) void load();
  },
);
onMounted(() => {
  if (props.active && loadedFor !== props.classId) void load();
});

function timeText(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="ss" data-testid="self-study-panel">
    <div class="ss__head">
      <div>
        <h3 class="ss__title">自学进度</h3>
        <div class="page-sub ss__sub">同学们在“路径”和“练习”里自己选的题。这些不会出现在实时看板、班级指标和导出里。</div>
      </div>
      <t-button size="small" variant="outline" :loading="loading" @click="load">刷新</t-button>
    </div>

    <t-alert v-if="error" theme="warning" :message="error" style="margin-bottom: 12px">
      <template #operation><t-link theme="primary" @click="load">重试</t-link></template>
    </t-alert>

    <div v-if="view && view.students.length > 0" class="ss__cards">
      <div class="stat-card"><div class="value">{{ summary.studying }}</div><div class="label">位同学做过自学题</div></div>
      <div class="stat-card"><div class="value">{{ summary.doneTotal }}</div><div class="label">道题已做完</div></div>
      <div class="stat-card"><div class="value">{{ summary.active }}</div><div class="label">道题正在做</div></div>
      <div class="stat-card"><div class="value">{{ summary.revealed }}</div><div class="label">道题看过解答</div></div>
    </div>

    <div v-if="view && view.students.length > 0" class="ss__scroll">
      <table class="ss__table">
        <thead>
          <tr>
            <th class="ss__sticky">学生</th>
            <th>做完</th>
            <th>正在做</th>
            <th>看过解答</th>
            <th v-for="unit in view.units" :key="unit.id" class="ss__unit" :title="`第 ${unit.chapterNo} 章 第 ${unit.unitNo} 单元`">{{ unit.title }}<span class="ss__total"> 共 {{ unit.total }} 题</span></th>
            <th>最近活动</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="student in students" :key="student.anonCode" :data-testid="`self-study-${student.anonCode}`">
            <td class="ss__sticky"><b>{{ student.displayName ?? student.anonCode }}</b></td>
            <td class="ss__num">{{ student.doneTotal }}</td>
            <td class="ss__num">{{ student.active }}</td>
            <td class="ss__num">{{ student.revealed }}</td>
            <td v-for="unit in view.units" :key="unit.id" class="ss__cell">
              <span class="ss__bar" role="img" :aria-label="`${student.displayName ?? student.anonCode} 在「${unit.title}」做完 ${summary.doneIn(student, unit.id)} / ${unit.total}`">
                <i :style="{ width: unit.total > 0 ? Math.min(100, (summary.doneIn(student, unit.id) / unit.total) * 100) + '%' : '0%' }" />
              </span>
              <span class="ss__frac">{{ summary.doneIn(student, unit.id) }}/{{ unit.total }}</span>
            </td>
            <td class="ss__time">{{ timeText(student.lastActiveAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!loading && !error" class="empty">
      还没有同学做自学题。<br />
      同学们在“路径”里选一道题开始后，他们的进度会出现在这里。
    </div>
    <t-loading v-else-if="loading" style="margin-top: 16px" />
  </div>
</template>

<style scoped>
.ss { padding-top: 12px; }
.ss__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ss__title { margin: 0; font-size: 16px; font-weight: 700; }
.ss__sub { margin: 4px 0 12px; }
.ss__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.ss__scroll { overflow-x: auto; border: 1px solid var(--pg-border); border-radius: var(--pg-radius); background: var(--pg-surface); }
.ss__table { border-collapse: collapse; width: 100%; font-size: 13px; }
.ss__table th, .ss__table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--pg-border); white-space: nowrap; }
.ss__table th { background: var(--pg-soft); font-weight: 700; color: var(--pg-ink-2); }
.ss__table tbody tr:last-child td { border-bottom: 0; }
.ss__sticky { position: sticky; left: 0; background: var(--pg-surface); z-index: 1; }
.ss__table th.ss__sticky { background: var(--pg-soft); }
.ss__num { font-variant-numeric: tabular-nums; }
.ss__unit { min-width: 150px; }
.ss__total { font-weight: 400; color: var(--pg-ink-3); }
.ss__cell { min-width: 150px; }
.ss__bar { display: inline-block; vertical-align: middle; width: 80px; height: 6px; border-radius: 3px; background: var(--pg-soft); overflow: hidden; margin-right: 8px; }
.ss__bar i { display: block; height: 100%; background: var(--pg-accent); }
.ss__frac { font-variant-numeric: tabular-nums; color: var(--pg-ink-2); }
.ss__time { color: var(--pg-ink-2); }
</style>
