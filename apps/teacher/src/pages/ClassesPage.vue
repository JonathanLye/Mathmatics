<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import type { ClassSummary } from '../api/types.ts';
import Mascot from '../components/ui/Mascot.vue';

const router = useRouter();

const classes = ref<ClassSummary[]>([]);
const loading = ref(false);
const error = ref('');
const dialogVisible = ref(false);
const creating = ref(false);
const form = ref({ name: '', term: '2026 秋' });

const TONES = ['sea', 'grass', 'bee', 'fox', 'chili'] as const;
const EXPRESSIONS = ['idle', 'happy', 'think', 'cheer', 'idle'] as const;
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

function tone(index: number): (typeof TONES)[number] {
  return TONES[index % TONES.length] as (typeof TONES)[number];
}
function claimedShare(c: ClassSummary): number {
  return c.students > 0 ? Math.min(1, (c.claimed ?? 0) / c.students) : 0;
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    classes.value = await api.get<ClassSummary[]>('/api/v1/teacher/classes');
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '加载班级失败';
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (form.value.name.trim() === '' || form.value.term.trim() === '') {
    MessagePlugin.warning('请填写班级名和学期');
    return;
  }
  creating.value = true;
  try {
    const created = await api.post<ClassSummary>('/api/v1/teacher/classes', {
      name: form.value.name.trim(),
      term: form.value.term.trim(),
    });
    MessagePlugin.success(`已建班，邀请码 ${created.inviteCode}`);
    dialogVisible.value = false;
    form.value.name = '';
    await refresh();
  } catch (caught) {
    MessagePlugin.error(caught instanceof ApiError ? caught.message : '建班失败');
  } finally {
    creating.value = false;
  }
}

function openClass(row: ClassSummary): void {
  void router.push(`/classes/${row.classId}`);
}

onMounted(refresh);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>我的班级</h2>
      <t-button theme="primary" @click="dialogVisible = true">建班</t-button>
    </div>
    <div class="page-sub">建班后把邀请码发给学生；名单导入在班级页的“名单”标签。</div>

    <t-alert v-if="error" theme="error" :message="error" />

    <div v-if="classes.length > 0" class="class-grid" data-testid="class-grid">
      <button
        v-for="(c, i) in classes"
        :key="c.classId"
        type="button"
        class="class-card"
        :class="`class-card--${tone(i)}`"
        :data-testid="`class-card-${c.classId}`"
        @click="openClass(c)"
      >
        <span class="class-card__top">
          <Mascot :expr="EXPRESSIONS[i % EXPRESSIONS.length]" :size="64" />
          <span class="class-card__term">{{ c.term }}</span>
        </span>
        <span class="class-card__body">
          <span class="class-card__name">{{ c.name }}</span>
          <span class="class-card__row">
            <svg class="class-card__ring" viewBox="0 0 56 56" width="56" height="56" role="img" :aria-label="`已认领 ${c.claimed} / ${c.students}`">
              <circle cx="28" cy="28" :r="RING_R" class="class-card__ring-bg" />
              <circle
                cx="28"
                cy="28"
                :r="RING_R"
                class="class-card__ring-fg"
                :stroke-dasharray="`${claimedShare(c) * RING_C} ${RING_C}`"
                transform="rotate(-90 28 28)"
              />
            </svg>
            <span class="class-card__stat">
              <b>{{ c.claimed }}<span class="class-card__of">/{{ c.students }}</span></b>
              <span class="pg-kicker">已认领 · 名单 {{ c.students }} 人</span>
            </span>
          </span>
          <span class="class-card__code"><span class="pg-kicker">邀请码</span><code class="mono">{{ c.inviteCode }}</code></span>
        </span>
      </button>
    </div>
    <div v-else-if="!loading" class="empty">还没有班级。点右上角“建班”，10 分钟走通“建班 → 导名单 → 布置”。</div>
    <t-loading v-else />

    <t-dialog
      v-model:visible="dialogVisible"
      header="建班"
      :confirm-btn="{ content: '创建', loading: creating }"
      @confirm="create"
    >
      <t-form label-width="70px">
        <t-form-item label="班级名">
          <t-input v-model="form.name" placeholder="如：数分 1 班" />
        </t-form-item>
        <t-form-item label="学期">
          <t-input v-model="form.term" placeholder="如：2026 秋" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.class-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; margin-top: 16px; }
.class-card {
  --c: var(--pg-sea); --c-lip: var(--pg-sea-lip);
  appearance: none; padding: 0; text-align: left; cursor: pointer; font: inherit; color: var(--pg-text);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--pg-surface); border: 2px solid var(--pg-border); border-bottom-width: 5px; border-radius: 20px;
  transition: transform 0.12s ease-out, border-bottom-width 0.12s ease-out;
}
.class-card:hover { transform: translateY(-2px); }
.class-card:active { transform: translateY(2px); border-bottom-width: 3px; }
.class-card:focus-visible { outline: 3px solid var(--pg-sea); outline-offset: 2px; }
.class-card--grass { --c: var(--pg-grass); --c-lip: var(--pg-grass-lip); }
.class-card--bee { --c: var(--pg-bee); --c-lip: var(--pg-bee-lip); }
.class-card--fox { --c: var(--pg-fox); --c-lip: var(--pg-fox-lip); }
.class-card--chili { --c: var(--pg-chili); --c-lip: var(--pg-chili-lip); }
.class-card__top { display: flex; align-items: flex-end; justify-content: space-between; padding: 14px 16px 0; background: var(--c); box-shadow: inset 0 -5px 0 var(--c-lip); height: 92px; }
.class-card__term { margin-bottom: 14px; padding: 2px 10px; border-radius: 12px; background: rgba(0, 0, 0, 0.22); color: #fff; font-size: 12px; font-weight: 900; letter-spacing: 0.4px; }
.class-card__body { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 16px; }
.class-card__name { font-size: 20px; font-weight: 900; line-height: 1.2; }
.class-card__row { display: flex; align-items: center; gap: 12px; }
.class-card__ring-bg { fill: none; stroke: rgba(127, 127, 127, 0.2); stroke-width: 8; }
.class-card__ring-fg { fill: none; stroke: var(--pg-grass); stroke-width: 8; stroke-linecap: round; }
.class-card__stat { display: flex; flex-direction: column; }
.class-card__stat b { font-size: 24px; font-weight: 900; line-height: 1.1; }
.class-card__of { font-size: 14px; color: var(--pg-text-secondary); }
.class-card__code { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 2px solid var(--pg-border); }
.class-card__code code { font-weight: 900; font-size: 15px; color: var(--pg-sea-text); }
@media (prefers-reduced-motion: reduce) { .class-card { transition: none; } }
</style>
