<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import type { AssignmentCard, ClassSummary, LiveRow, LiveSnapshot, RosterImportResult } from '../api/types.ts';
import ExportPanel from '../components/ExportPanel.vue';
import MetricsPanel from '../components/MetricsPanel.vue';
import StudentDetailDrawer from '../components/StudentDetailDrawer.vue';

const route = useRoute();
const classId = computed(() => String(route.params.classId ?? ''));
const tab = ref('live');
const classInfo = ref<ClassSummary | null>(null);
const pageError = ref('');

// 学生详情抽屉（#35：解锁 / 发一句话 / 处理标记）
const drawerVisible = ref(false);
const selectedAttemptId = ref<string | null>(null);

function openAttempt(row: LiveRow): void {
  if (row.attemptId === null || row.attemptId === undefined) return;
  selectedAttemptId.value = row.attemptId;
  drawerVisible.value = true;
}

// 实时看板（#51 提供 /live；未上线时显示提示，不阻塞其他页签）
const live = ref<LiveSnapshot | null>(null);
const liveError = ref('');
const liveLoading = ref(false);
let pollTimer: number | undefined;
let stream: EventSource | undefined;
let retryTimer: number | undefined;
let retryDelay = 1000;
const streamConnected = ref(false);
const streamError = ref('');
const selectedAssignmentId = ref('');
const assignmentsError = ref('');
// 首屏由 onMounted 顺序加载；watch 只响应之后教师的切换，避免首屏重复请求。
let pageReady = false;

// 名单（04 §10）
const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importResult = ref<RosterImportResult | null>(null);
const rotating = ref(false);

// 布置（04 §7）
const createdAssignments = ref<AssignmentCard[]>([]);
const creating = ref(false);
const assignmentForm = ref({
  problemId: 'epsN',
  version: 1,
  mode: 'practice' as 'practice' | 'test',
  openAt: toLocalInput(new Date()),
  closeAt: '',
  revealBudget: 2,
});

const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  active: '活跃',
  idle: '空闲',
  away: '离开中',
  parked: '搁置',
  locked: '锁定',
  completed: '已完成',
};
const FLAG_LABEL: Record<string, string> = {
  help: '求助',
  integrity: '诚信',
  budget_exhausted: '额度用完',
  low_conf: '低置信',
};

const liveColumns = [
  { colKey: 'displayName', title: '学生' },
  { colKey: 'status', title: '状态' },
  { colKey: 'layer', title: '层' },
  { colKey: 'keysOwn', title: '自己写出' },
  { colKey: 'reveal', title: '透露' },
  { colKey: 'stuckSec', title: '无进展' },
  { colKey: 'flags', title: '标记' },
  { colKey: 'lastActiveAt', title: '最近活动' },
  { colKey: 'actions', title: '操作', width: 90 },
];

type LiveFilter = 'online' | 'started' | 'completed' | 'stuck' | 'flagged';
const liveFilter = ref<LiveFilter | null>(null);

const stats = computed(() => {
  const summary = live.value?.summary;
  return [
    { key: 'online' as const, label: '在线', value: summary?.online ?? 0 },
    { key: 'started' as const, label: '已开始', value: summary?.started ?? 0 },
    { key: 'completed' as const, label: '已完成', value: summary?.completed ?? 0 },
    { key: 'stuck' as const, label: '卡住', value: summary?.stuck ?? 0 },
    { key: 'flagged' as const, label: '标记', value: summary?.flagged ?? 0 },
  ];
});

function toggleFilter(key: LiveFilter): void {
  liveFilter.value = liveFilter.value === key ? null : key;
}

const filteredRows = computed(() => {
  const rows = live.value?.rows ?? [];
  switch (liveFilter.value) {
    case 'online':
      return rows.filter((row) => row.status === 'active');
    case 'started':
      return rows.filter((row) => row.attemptId !== null);
    case 'completed':
      return rows.filter((row) => row.status === 'completed');
    case 'stuck':
      return rows.filter((row) => (row.stuckSec ?? 0) >= 180);
    case 'flagged':
      return rows.filter((row) => (row.flags?.length ?? 0) > 0);
    default:
      return rows;
  }
});

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function messageOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : '请求失败';
}

async function loadClassInfo(): Promise<void> {
  try {
    const list = await api.get<ClassSummary[]>('/api/v1/teacher/classes');
    classInfo.value = list.find((item) => item.classId === classId.value) ?? null;
    if (classInfo.value === null) pageError.value = '班级不存在或不属于你';
  } catch (caught) {
    pageError.value = messageOf(caught);
  }
}

// #48 C 侧：看板 SSE（06 §6 row/flag/ping）；失败时保留 5s 轮询兜底。
function mergeLiveRow(row: LiveRow): void {
  const current = live.value;
  if (current === null) return;
  const rows = [...current.rows];
  const index = rows.findIndex((item) => item.anonCode === row.anonCode);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  // summary 口径以服务端 /live 为准（08 §4）；SSE 只更新行，5s 轮询覆盖 summary。
  live.value = { ...current, rows };
}

function scheduleRetry(): void {
  if (retryTimer !== undefined || document.hidden) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    connectStream();
  }, navigator.onLine ? retryDelay : 30_000);
  retryDelay = Math.min(30_000, retryDelay * 2);
}

function connectStream(): void {
  if (typeof EventSource === 'undefined' || classId.value === '' || document.hidden) return;
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  stream?.close();
  const query = selectedAssignmentId.value === '' ? '' : `?assignmentId=${encodeURIComponent(selectedAssignmentId.value)}`;
  stream = new EventSource(`/api/v1/teacher/classes/${classId.value}/stream${query}`);
  stream.onopen = () => {
    streamConnected.value = true;
    streamError.value = '';
    retryDelay = 1000;
  };
  stream.addEventListener('row', (event) => {
    try {
      mergeLiveRow(JSON.parse((event as MessageEvent).data) as LiveRow);
    } catch {
      // 忽略坏帧，轮询会补齐
    }
  });
  stream.addEventListener('flag', (event) => {
    try {
      const flag = JSON.parse((event as MessageEvent).data) as { type: string; anonCode: string };
      MessagePlugin.warning(`${flag.anonCode}：${FLAG_LABEL[flag.type] ?? flag.type}标记`);
    } catch {
      // ignore
    }
  });
  stream.onerror = () => {
    streamConnected.value = false;
    streamError.value = '实时连接断开，已回退 5s 轮询，正在重连…';
    stream?.close();
    stream = undefined;
    scheduleRetry();
  };
}

function disconnectStream(): void {
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  stream?.close();
  stream = undefined;
  streamConnected.value = false;
}

async function loadAssignments(): Promise<void> {
  if (classId.value === '') return;
  try {
    createdAssignments.value = await api.get<AssignmentCard[]>(
      `/api/v1/teacher/assignments?classId=${encodeURIComponent(classId.value)}`,
    );
    if (selectedAssignmentId.value === '' || !createdAssignments.value.some((item) => item.assignmentId === selectedAssignmentId.value)) {
      // 列表按开放时间倒序，第一条可能是还没开放的布置（看板是空的）；优先选进行中的。
      const current = createdAssignments.value.find((item) => item.status === 'open') ?? createdAssignments.value[0];
      selectedAssignmentId.value = current?.assignmentId ?? '';
    }
    assignmentsError.value = '';
  } catch (caught) {
    // 列表失败不阻塞看板，但要让教师知道，而不是误以为没有布置。
    assignmentsError.value = messageOf(caught);
  }
}

async function loadLive(): Promise<void> {
  liveLoading.value = true;
  try {
    const query = selectedAssignmentId.value === '' ? '' : `?assignmentId=${encodeURIComponent(selectedAssignmentId.value)}`;
    live.value = await api.get<LiveSnapshot>(`/api/v1/teacher/classes/${classId.value}/live${query}`);
    liveError.value = '';
  } catch (caught) {
    live.value = null;
    liveError.value =
      caught instanceof ApiError && (caught.status === 404 || caught.status === 501)
        ? '实时看板接口尚未上线（#51），上线后自动生效。'
        : caught instanceof ApiError
          ? caught.message
          : '看板加载失败，请检查网络后重试';
  } finally {
    liveLoading.value = false;
  }
}

function startPolling(): void {
  stopPolling();
  // 04 §2.2：P0 每 5 秒轮询；页面不可见时暂停。
  pollTimer = window.setInterval(() => {
    // 只在看板页签且页面可见时轮询（A 复审 P3-11）。
    if (!document.hidden && tab.value === 'live') void loadLive();
  }, 5000);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    const result = await api.postCsv<RosterImportResult>(`/api/v1/teacher/classes/${classId.value}/roster`, file);
    importResult.value = result;
    MessagePlugin.success(`导入完成：新增 ${result.added}，重复 ${result.duplicates}，非法 ${result.invalid.length}`);
    await loadClassInfo();
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    importing.value = false;
    input.value = '';
  }
}

async function rotateInvite(): Promise<void> {
  rotating.value = true;
  try {
    const updated = await api.post<ClassSummary>(`/api/v1/teacher/classes/${classId.value}/invite-code`);
    classInfo.value = updated;
    MessagePlugin.success(`新邀请码：${updated.inviteCode}`);
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    rotating.value = false;
  }
}

async function copyInvite(): Promise<void> {
  if (classInfo.value === null) return;
  try {
    await navigator.clipboard.writeText(classInfo.value.inviteCode);
    MessagePlugin.success('邀请码已复制');
  } catch {
    MessagePlugin.warning('复制失败，请手动选中邀请码复制');
  }
}

async function createAssignment(): Promise<void> {
  if (assignmentForm.value.problemId.trim() === '') {
    MessagePlugin.warning('请填写题目 ID');
    return;
  }
  creating.value = true;
  try {
    const openAt = new Date(assignmentForm.value.openAt);
    if (Number.isNaN(openAt.getTime())) throw new Error('开放时间格式不对');
    const closeAt = assignmentForm.value.closeAt === '' ? null : new Date(assignmentForm.value.closeAt);
    if (closeAt !== null && Number.isNaN(closeAt.getTime())) throw new Error('截止时间格式不对');

    await api.post<AssignmentCard>('/api/v1/teacher/assignments', {
      classId: classId.value,
      problemId: assignmentForm.value.problemId.trim(),
      version: Number(assignmentForm.value.version),
      mode: assignmentForm.value.mode,
      openAt: openAt.toISOString(),
      closeAt: closeAt === null ? null : closeAt.toISOString(),
      settings: { revealBudget: Number(assignmentForm.value.revealBudget) },
    });
    await loadAssignments();
    MessagePlugin.success('布置已创建');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    creating.value = false;
  }
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function flagLabel(flag: string): string {
  return FLAG_LABEL[flag] ?? flag;
}

watch(selectedAssignmentId, () => {
  if (!pageReady) return;
  void loadLive();
  connectStream();
});

onMounted(async () => {
  await loadClassInfo();
  await loadAssignments();
  await loadLive();
  connectStream();
  startPolling();
  pageReady = true;
});

function onVisibility(): void {
  if (!document.hidden && tab.value === 'live') void loadLive();
}

document.addEventListener('visibilitychange', onVisibility);

function onVisibilityChange(): void {
  if (document.hidden) disconnectStream();
  else if (stream === undefined) connectStream();
}

function onOnline(): void {
  retryDelay = 1000;
  if (stream === undefined) connectStream();
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('online', onOnline);
  disconnectStream();
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>{{ classInfo?.name ?? '班级' }}</h2>
      <span v-if="classInfo" class="page-sub" style="margin: 0">
        邀请码 <span class="mono">{{ classInfo.inviteCode }}</span> · 名单 {{ classInfo.students }} 人 · 已认领 {{ classInfo.claimed }}
      </span>
    </div>
    <t-alert v-if="pageError" theme="error" :message="pageError" />

    <t-tabs v-model="tab">
      <t-tab-panel value="live" label="实时看板">
        <t-alert v-if="liveError" theme="warning" :message="liveError" style="margin: 12px 0" />
        <div v-if="createdAssignments.length > 0" class="live-toolbar">
          <span class="page-sub">布置</span>
          <t-select
            v-model="selectedAssignmentId"
            :options="createdAssignments.map((item) => ({ label: `${item.title}（${statusLabel(item.status)}）`, value: item.assignmentId }))"
            style="width: 320px"
          />
        </div>
        <div class="stat-cards">
          <div
            v-for="item in stats"
            :key="item.key"
            class="stat-card clickable"
            :class="{ selected: liveFilter === item.key }"
            :title="`筛选：${item.label}（再次点击取消）`"
            @click="toggleFilter(item.key)"
          >
            <div class="value">{{ item.value }}</div>
            <div class="label">{{ item.label }}</div>
          </div>
        </div>
        <div v-if="liveFilter" class="page-sub" style="margin: 4px 0 8px">
          筛选：{{ stats.find((item) => item.key === liveFilter)?.label }}（{{ filteredRows.length }} 人）
          <t-link theme="primary" @click="liveFilter = null">清除</t-link>
        </div>
        <t-table
          :data="filteredRows"
          :columns="liveColumns"
          row-key="anonCode"
          :loading="liveLoading"
          size="small"
          hover
          @row-click="(ctx: { row: LiveRow }) => openAttempt(ctx.row)"
        >
          <template #status="{ row }">
            <t-tag :theme="row.status === 'completed' ? 'success' : row.status === 'locked' ? 'danger' : 'default'">
              {{ statusLabel(row.status) }}
            </t-tag>
          </template>
          <template #flags="{ row }">
            <t-space v-if="row.flags && row.flags.length">
              <t-tag v-for="flag in row.flags" :key="flag" size="small" variant="light">
                {{ flagLabel(flag) }}
              </t-tag>
            </t-space>
            <span v-else>—</span>
          </template>
          <template #lastActiveAt="{ row }">
            <span>{{ row.lastActiveAt ? new Date(row.lastActiveAt).toLocaleTimeString('zh-CN') : '—' }}</span>
          </template>
          <template #actions="{ row }">
            <t-link theme="primary" :disabled="!row.attemptId" @click.stop="openAttempt(row)">详情</t-link>
          </template>
          <template #empty>
            <div class="empty">
              {{ liveError ? (liveError.includes('尚未上线') ? '看板接口待上线。' : '加载失败，请重试。') : '暂无作答数据：学生用邀请码登录并开始练习后会出现在这里。' }}
            </div>
          </template>
        </t-table>
        <div class="page-sub" style="margin-top: 8px">每 5 秒自动刷新；页面不可见时暂停（04 §2.2）。{{ streamConnected ? ' SSE 已连接。' : '' }}{{ streamError ? ` ${streamError}` : '' }}</div>
      </t-tab-panel>

      <t-tab-panel value="roster" label="名单">
        <t-alert
          theme="info"
          message="当前契约没有 GET 名单列表接口（见 #50 PR 的缺口说明）；本页提供导入与认领人数，列表待 B 补契约后展示。"
          style="margin: 12px 0"
        />
        <div class="inline-actions" style="margin-bottom: 16px">
          <span>邀请码 <b class="mono">{{ classInfo?.inviteCode ?? '—' }}</b></span>
          <t-button size="small" variant="outline" @click="copyInvite">复制</t-button>
          <t-button size="small" :loading="rotating" @click="rotateInvite">重置邀请码</t-button>
          <t-button size="small" theme="primary" :loading="importing" @click="fileInput?.click()">导入名单 CSV</t-button>
          <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="onFileChange" />
        </div>
        <div class="page-sub">CSV：<code>学号,姓名</code>（姓名可空）；UTF-8/GBK 自动识别；重复学号合并；非法行会给出原因。</div>
        <t-table
          v-if="importResult"
          :data="importResult.invalid"
          :columns="[
            { colKey: 'row', title: '行号' },
            { colKey: 'reason', title: '原因' },
          ]"
          row-key="row"
          size="small"
        >
          <template #empty><div class="empty">没有非法行。</div></template>
        </t-table>
        <div v-if="importResult" class="page-sub" style="margin-top: 8px">
          本次导入：新增 {{ importResult.added }}，重复 {{ importResult.duplicates }}，非法 {{ importResult.invalid.length }}。
        </div>
      </t-tab-panel>

      <t-tab-panel value="assignments" label="布置">
        <t-form label-width="90px" style="max-width: 560px; margin-top: 12px">
          <t-form-item label="题目 ID">
            <t-input v-model="assignmentForm.problemId" placeholder="如：epsN" />
          </t-form-item>
          <t-form-item label="版本">
            <t-input-number v-model="assignmentForm.version" :min="1" theme="normal" />
          </t-form-item>
          <t-form-item label="模式">
            <t-select v-model="assignmentForm.mode" :options="[{ label: '练习', value: 'practice' }, { label: '测验', value: 'test' }]" />
          </t-form-item>
          <t-form-item label="开放时间">
            <input v-model="assignmentForm.openAt" class="native-input" type="datetime-local" />
          </t-form-item>
          <t-form-item label="截止时间">
            <input v-model="assignmentForm.closeAt" class="native-input" type="datetime-local" />
          </t-form-item>
          <t-form-item label="透露预算">
            <t-input-number v-model="assignmentForm.revealBudget" :min="0" :max="10" theme="normal" />
          </t-form-item>
          <t-form-item label=" ">
            <t-button theme="primary" :loading="creating" @click="createAssignment">布置</t-button>
          </t-form-item>
        </t-form>

        <t-alert v-if="assignmentsError" theme="warning" :message="`布置列表加载失败：${assignmentsError}`" style="margin: 12px 0" />
        <t-table
          :data="createdAssignments"
          :columns="[
            { colKey: 'title', title: '题目' },
            { colKey: 'mode', title: '模式' },
            { colKey: 'status', title: '状态' },
            { colKey: 'openAt', title: '开放' },
          ]"
          row-key="assignmentId"
          size="small"
        >
          <template #empty><div class="empty">还没有创建布置。</div></template>
        </t-table>
      </t-tab-panel>

      <t-tab-panel value="metrics" label="指标">
        <MetricsPanel :class-id="classId" :assignment-id="selectedAssignmentId === '' ? undefined : selectedAssignmentId" />
      </t-tab-panel>

      <t-tab-panel value="export" label="导出">
        <ExportPanel :class-id="classId" />
      </t-tab-panel>
    </t-tabs>

    <StudentDetailDrawer
      v-model:visible="drawerVisible"
      :attempt-id="selectedAttemptId"
      @refresh="loadLive"
    />
  </div>
</template>

<style scoped>
.live-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
.stat-card.clickable {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.stat-card.clickable:hover {
  border-color: var(--td-brand-color, #0052d9);
}
.stat-card.selected {
  border-color: var(--td-brand-color, #0052d9);
  background: var(--td-brand-color-light, #ecf2fe);
}
.native-input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 4px;
  background: var(--td-bg-color-container, #fff);
  color: var(--td-text-color-primary, #1f2329);
  font: inherit;
}
</style>
