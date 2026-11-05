<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import type { AssignmentCard, ClassSummary, LiveRow, LiveSnapshot, RosterImportResult } from '../api/types.ts';
import ExportPanel from '../components/ExportPanel.vue';
import MetricsPanel from '../components/MetricsPanel.vue';
import StudentDetailDrawer from '../components/StudentDetailDrawer.vue';
import { defaultsForMode, normalizeAssignmentSettings, parseProofIds } from '../utils/assignments.ts';

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
interface PublishedProblem {
  problemId: string;
  title: string;
  chapter?: string;
  version: number;
}
const publishedProblems = ref<PublishedProblem[]>([]);
const selectedProblem = ref('');
const problemsLoading = ref(false);
const problemsError = ref('');
const problemKey = (item: PublishedProblem): string => `${item.problemId}@${item.version}`;

const closingId = ref<string | null>(null);
const assignmentForm = ref({
  mode: 'practice' as 'practice' | 'test',
  openAt: toLocalInput(new Date()),
  closeAt: '',
  revealBudget: 2,
  photoEnabled: true,
  hintsEnabled: true,
  maxSwitches: 3,
  durationMin: 0,
});

// 04 §7：切模式时重置默认（测验求助/拍照默认关）。
watch(
  () => assignmentForm.value.mode,
  (mode) => {
    Object.assign(assignmentForm.value, defaultsForMode(mode));
  },
);

// 04 §6：关闭布置后发布参考证明与讲评（A/B 组同时发布）
const publishVisible = ref(false);
const publishTarget = ref<AssignmentCard | null>(null);
const publishProofIds = ref('');
const publishNote = ref('');
const publishError = ref('');
const publishing = ref(false);

function openPublish(card: AssignmentCard): void {
  publishTarget.value = card;
  publishProofIds.value = '';
  publishNote.value = '';
  publishError.value = '';
  publishVisible.value = true;
}

async function submitPublish(): Promise<void> {
  if (publishTarget.value === null || publishing.value) return;
  publishing.value = true;
  publishError.value = '';
  try {
    const proofIds = parseProofIds(publishProofIds.value);
    await api.post<AssignmentCard>(
      `/api/v1/teacher/assignments/${publishTarget.value.assignmentId}/publish-review`,
      { ...(proofIds.length > 0 ? { proofIds } : {}), ...(publishNote.value.trim() === '' ? {} : { note: publishNote.value.trim() }) },
    );
    await loadAssignments();
    MessagePlugin.success('讲评已发布');
    publishVisible.value = false;
  } catch (caught) {
    publishError.value =
      caught instanceof ApiError && caught.status === 409 ? '布置尚未关闭，不能发布讲评：请先关闭该布置' : messageOf(caught);
  } finally {
    publishing.value = false;
  }
}

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

async function loadPublishedProblems(): Promise<void> {
  problemsLoading.value = true;
  problemsError.value = '';
  try {
    publishedProblems.value = await api.get<PublishedProblem[]>('/api/v1/teacher/problems?status=published');
    if (!publishedProblems.value.some((item) => problemKey(item) === selectedProblem.value)) {
      const first = publishedProblems.value[0];
      selectedProblem.value = first === undefined ? '' : problemKey(first);
    }
  } catch (caught) {
    publishedProblems.value = [];
    problemsError.value = messageOf(caught);
  } finally {
    problemsLoading.value = false;
  }
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
  const problem = publishedProblems.value.find((item) => problemKey(item) === selectedProblem.value);
  if (problem === undefined) {
    MessagePlugin.warning('请选择已发布的题目（无已发布题目请先在题库发布）');
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
      problemId: problem.problemId,
      version: problem.version,
      mode: assignmentForm.value.mode,
      openAt: openAt.toISOString(),
      closeAt: closeAt === null ? null : closeAt.toISOString(),
      settings: normalizeAssignmentSettings(assignmentForm.value),
    });
    await loadAssignments();
    MessagePlugin.success('布置已创建');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    creating.value = false;
  }
}

// PATCH 要完整字段（04 §7）：用列表卡片重建，刷新页面后同样能关闭；只有进行中的布置能关（未开放的 closeAt 会早于 openAt）。
async function closeAssignment(card: AssignmentCard): Promise<void> {
  if (closingId.value !== null) return;
  closingId.value = card.assignmentId;
  try {
    await api.patch<AssignmentCard>(`/api/v1/teacher/assignments/${card.assignmentId}`, {
      classId: classId.value,
      problemId: card.problemId,
      version: card.version,
      mode: card.mode,
      openAt: card.openAt,
      closeAt: new Date().toISOString(),
      settings: card.settings ?? {},
    });
    await loadAssignments();
    MessagePlugin.success('布置已关闭');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    closingId.value = null;
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
  void loadPublishedProblems();
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
            role="button"
            tabindex="0"
            :aria-pressed="liveFilter === item.key"
            :title="`筛选：${item.label}（再次点击取消）`"
            @click="toggleFilter(item.key)"
            @keydown.enter="toggleFilter(item.key)"
            @keydown.space.prevent="toggleFilter(item.key)"
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
          <t-form-item label="题目">
            <t-select
              v-model="selectedProblem"
              :loading="problemsLoading"
              placeholder="选择已发布的题目版本"
              style="width: 360px"
              filterable
              :options="publishedProblems.map((item) => ({
                label: `${item.title}${item.chapter ? ' · ' + item.chapter : ''} · v${item.version}`,
                value: problemKey(item),
              }))"
            />
          </t-form-item>
          <t-form-item v-if="publishedProblems.length === 0 && !problemsLoading" label=" ">
            <t-alert theme="warning" :message="problemsError === '' ? '没有已发布题目：请先在题库完成审核发布。' : `题目列表加载失败：${problemsError}`" />
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
            <t-alert theme="warning" message="下面的拍照/求助/切出/限时目前只随布置保存，学生端尚未按它们生效；测验模式本身的关提示与切出锁定已生效。" />
          </t-form-item>
          <t-form-item label="拍照">
            <t-switch v-model="assignmentForm.photoEnabled" />
          </t-form-item>
          <t-form-item label="求助">
            <t-switch v-model="assignmentForm.hintsEnabled" />
          </t-form-item>
          <t-form-item v-if="assignmentForm.mode === 'test'" label="切出锁定">
            <t-input-number v-model="assignmentForm.maxSwitches" :min="0" :max="10" theme="normal" suffix="次" />
          </t-form-item>
          <t-form-item v-if="assignmentForm.mode === 'test'" label="限时">
            <t-input-number v-model="assignmentForm.durationMin" :min="0" :max="300" theme="normal" suffix="分钟" />
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
            { colKey: 'actions', title: '操作', width: 160 },
          ]"
          row-key="assignmentId"
          size="small"
        >
          <template #actions="{ row }">
            <t-space size="small">
              <t-link theme="primary" :disabled="row.reviewPublished" @click="openPublish(row as AssignmentCard)">
                {{ row.reviewPublished ? '已发布讲评' : '发布讲评' }}
              </t-link>
              <t-link v-if="row.status === 'open'" theme="danger" :disabled="closingId !== null" @click="closeAssignment(row as AssignmentCard)">关闭</t-link>
            </t-space>
          </template>
          <template #empty><div class="empty">还没有创建布置。</div></template>
        </t-table>

        <t-dialog v-model:visible="publishVisible" header="发布讲评（参考证明 + 说明）" :footer="false">
          <t-alert v-if="publishError" theme="error" :message="publishError" style="margin-bottom: 8px" />
          <t-alert theme="info" message="布置关闭后才可发布；A/B 两组同时可见。P0 会发布该版本全部可发布参考证明；下方 ID 仅用于审计校验，不改变发布选择。" style="margin-bottom: 8px" />
          <t-form label-width="90px">
            <t-form-item label="参考证明 ID">
              <t-input v-model="publishProofIds" placeholder="可空，多个用逗号分隔；仅审计校验，不改变发布选择" />
            </t-form-item>
            <t-form-item label="讲评">
              <t-textarea v-model="publishNote" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="讲评说明（MathText，可空）" />
            </t-form-item>
          </t-form>
          <div class="dialog-actions">
            <t-button variant="outline" :disabled="publishing" @click="publishVisible = false">取消</t-button>
            <t-button theme="primary" :loading="publishing" @click="submitPublish">发布讲评</t-button>
          </div>
        </t-dialog>
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
.live-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
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
