<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import type { AssignmentCard, ClassSettings, ClassSummary, LiveRow, LiveSnapshot, RosterEntry, RosterImportResult } from '../api/types.ts';
import ExportPanel from '../components/ExportPanel.vue';
import LiveBoard from '../components/LiveBoard.vue';
import MetricsPanel from '../components/MetricsPanel.vue';
import ProblemSelect from '../components/ProblemSelect.vue';
import SelfStudyPanel from '../components/SelfStudyPanel.vue';
import StudentDetailDrawer from '../components/StudentDetailDrawer.vue';
import { defaultsForMode, normalizeAssignmentSettings } from '../utils/assignments.ts';
import { assignmentStatusLabel } from '../utils/labels.ts';
import { layerName } from '../utils/layers.ts';
import { filterRows, sortRows, type BoardFilter } from '../utils/liveBoard.ts';
import type { ProblemRow } from '../utils/problemSearch.ts';

const route = useRoute();
const classId = computed(() => String(route.params.classId ?? ''));
const tab = ref('live');
const classInfo = ref<ClassSummary | null>(null);
const pageError = ref('');
const classSettings = ref({
  photoEnabled: true,
  lessonGenerated: false,
  revealBudget: 2,
  integrityPractice: 'log_and_notice',
  testMaxSwitches: 3,
});
const savingSettings = ref(false);

// 学生详情抽屉（解锁、发一句话、处理求助和提醒）
const drawerVisible = ref(false);
const selectedAttemptId = ref<string | null>(null);

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function openAttempt(row: LiveRow): void {
  if (row.attemptId === null || row.attemptId === undefined) return;
  selectedAttemptId.value = row.attemptId;
  drawerVisible.value = true;
}

// 实时看板（失败时只在看板里提示，不影响其他页签）
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

// 名单
const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importResult = ref<RosterImportResult | null>(null);
const rotating = ref(false);
const rosterEntries = ref<RosterEntry[]>([]);
const rosterLoading = ref(false);
const rosterError = ref('');
const unclaiming = ref<string | null>(null);
const resetting = ref<string | null>(null);

// 布置
const createdAssignments = ref<AssignmentCard[]>([]);
const creating = ref(false);
// 远程搜索选中的题（含题号和版本）；没选时为空
const selectedProblem = ref('');
const pickedProblem = ref<ProblemRow | null>(null);
function onProblemSelect(item: ProblemRow | null): void {
  pickedProblem.value = item;
}

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

// 切模式时重置默认（测验的求助、拍照默认关）。
watch(
  () => assignmentForm.value.mode,
  (mode) => {
    Object.assign(assignmentForm.value, defaultsForMode(mode));
  },
);

// 关闭布置后发布参考证明与讲评
const publishVisible = ref(false);
const publishTarget = ref<AssignmentCard | null>(null);
const publishNote = ref('');
const publishError = ref('');
const publishing = ref(false);

function openPublish(card: AssignmentCard): void {
  publishTarget.value = card;
  publishNote.value = '';
  publishError.value = '';
  publishVisible.value = true;
}

async function submitPublish(): Promise<void> {
  if (publishTarget.value === null || publishing.value) return;
  publishing.value = true;
  publishError.value = '';
  try {
    await api.post<AssignmentCard>(
      `/api/v1/teacher/assignments/${publishTarget.value.assignmentId}/publish-review`,
      publishNote.value.trim() === '' ? {} : { note: publishNote.value.trim() },
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
  active: '正在做',
  idle: '暂停中',
  away: '离开中',
  parked: '先搁置',
  locked: '已锁定',
  completed: '已完成',
};
const FLAG_LABEL: Record<string, string> = {
  help: '求助老师',
  integrity: '诚信提醒',
  budget_exhausted: '提示额度用完',
  low_conf: '识别把握不大',
};

const liveColumns = [
  { colKey: 'displayName', title: '学生' },
  { colKey: 'status', title: '状态' },
  { colKey: 'layer', title: '所在层' },
  { colKey: 'keysOwn', title: '自己写出' },
  { colKey: 'reveal', title: '提示额度' },
  { colKey: 'stuckSec', title: '无进展' },
  { colKey: 'flags', title: '标记' },
  { colKey: 'lastActiveAt', title: '最近活动' },
  { colKey: 'actions', title: '操作', width: 90 },
];

// 筛选键即看板状态，点顶部的数字切换；同一份筛选同时作用于卡片与表格视图。
const liveFilter = ref<BoardFilter>(null);
const liveView = ref<'tiles' | 'table'>('tiles');
const FILTER_LABEL: Record<string, string> = { help: '需要你', stuck: '卡住', write: '在写', away: '离开中', done: '已完成', idle: '未开始' };

const filteredRows = computed(() => sortRows(filterRows(live.value?.rows ?? [], liveFilter.value)));

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function messageOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : '请求失败';
}

// 班级默认设置作为新布置表单的初值，老师仍可逐次修改。
function applyClassDefaultsToForm(): void {
  assignmentForm.value.revealBudget = classSettings.value.revealBudget;
  assignmentForm.value.maxSwitches = classSettings.value.testMaxSwitches;
  if (assignmentForm.value.mode === 'practice') assignmentForm.value.photoEnabled = classSettings.value.photoEnabled;
}

async function loadClassInfo(): Promise<void> {
  try {
    const list = await api.get<ClassSummary[]>('/api/v1/teacher/classes');
    classInfo.value = list.find((item) => item.classId === classId.value) ?? null;
    if (classInfo.value === null) pageError.value = '班级不存在或不属于你';
    const settings = classInfo.value?.settings as ClassSettings | undefined;
    if (settings !== undefined) {
      Object.assign(classSettings.value, {
        photoEnabled: settings.photoEnabled ?? true,
        lessonGenerated: settings.lessonGenerated ?? false,
        revealBudget: settings.revealBudget ?? 2,
        integrityPractice: settings.integrityPractice ?? 'log_and_notice',
        testMaxSwitches: settings.testMaxSwitches ?? 3,
      });
      applyClassDefaultsToForm();
    }
  } catch (caught) {
    pageError.value = messageOf(caught);
  }
}

// 实时推送：某个学生的行有变化就合并进看板；断线时保留每 5 秒刷新兜底。
function mergeLiveRow(row: LiveRow): void {
  const current = live.value;
  if (current === null) return;
  const rows = [...current.rows];
  const index = rows.findIndex((item) => item.anonCode === row.anonCode);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  // 汇总数字以服务端的完整快照为准；实时推送只更新行，5 秒一次的刷新会覆盖汇总。
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
      const who = live.value?.rows.find((row) => row.anonCode === flag.anonCode)?.displayName ?? flag.anonCode;
      MessagePlugin.warning(flag.type === 'help' ? `${who} 点了「求助老师」` : `${who}：${FLAG_LABEL[flag.type] ?? '有新的提醒'}`);
    } catch {
      // ignore
    }
  });
  stream.onerror = () => {
    streamConnected.value = false;
    streamError.value = '实时连接断开，改为每 5 秒刷新一次，正在重连…';
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

async function saveClassSettings(): Promise<void> {
  savingSettings.value = true;
  try {
    const updated = await api.patch<ClassSummary>(`/api/v1/teacher/classes/${classId.value}/settings`, classSettings.value);
    classInfo.value = updated;
    applyClassDefaultsToForm();
    MessagePlugin.success('班级默认设置已保存');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    savingSettings.value = false;
  }
}

async function loadRoster(): Promise<void> {
  if (classId.value === '') return;
  rosterLoading.value = true;
  rosterError.value = '';
  try {
    rosterEntries.value = await api.get<RosterEntry[]>(`/api/v1/teacher/classes/${classId.value}/roster`);
  } catch (caught) {
    rosterEntries.value = [];
    rosterError.value = caught instanceof ApiError ? caught.message : '名单加载失败，请重试';
  } finally {
    rosterLoading.value = false;
  }
}

async function unclaim(rosterId: string): Promise<void> {
  if (unclaiming.value !== null) return;
  unclaiming.value = rosterId;
  try {
    await api.delete(`/api/v1/teacher/classes/${classId.value}/roster/${rosterId}`);
    MessagePlugin.success('已解除认领');
    await Promise.all([loadRoster(), loadClassInfo()]);
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    unclaiming.value = null;
  }
}

// 重置学生密码。学生之后用邀请码 + 学号重新激活并设新密码；该生所有设备上的登录立即失效。
async function resetPassword(rosterId: string): Promise<void> {
  if (resetting.value !== null) return;
  resetting.value = rosterId;
  try {
    await api.post(`/api/v1/teacher/classes/${classId.value}/roster/${rosterId}/reset-password`);
    MessagePlugin.success('已重置密码：请告诉学生用邀请码重新激活，并设一个新密码');
    await loadRoster();
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    resetting.value = null;
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
        ? '实时看板暂时不可用，稍后会自动重试。'
        : caught instanceof ApiError
          ? caught.message
          : '看板加载失败，请检查网络后重试';
  } finally {
    liveLoading.value = false;
  }
}

function startPolling(): void {
  stopPolling();
  // 每 5 秒刷新一次；页面不在前台时暂停。
  pollTimer = window.setInterval(() => {
    // 只在看板页签且页面可见时刷新。
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
    await Promise.all([loadClassInfo(), loadRoster()]);
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
  const problem = pickedProblem.value;
  if (problem === null) {
    MessagePlugin.warning('请先选一道已发布的题目；没有可选的题，请先在题库里发布。');
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
    selectedProblem.value = '';
    pickedProblem.value = null;
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    creating.value = false;
  }
}

// 关闭布置要提交完整字段：用列表卡片重建，刷新页面后同样能关闭；只有进行中的布置能关（未开放的布置截止时间会早于开放时间）。
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
  return STATUS_LABEL[status] ?? '其他';
}

function flagLabel(flag: string): string {
  return FLAG_LABEL[flag] ?? '其他提醒';
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
  await loadRoster();
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
          <span class="page-sub">看哪次布置</span>
          <t-select
            v-model="selectedAssignmentId"
            :options="createdAssignments.map((item) => ({ label: `${item.title}（${assignmentStatusLabel(item.status)}）`, value: item.assignmentId }))"
            style="width: 320px; max-width: 100%"
          />
        </div>
        <div v-if="liveFilter" class="page-sub" style="margin: 4px 0 8px">
          筛选：{{ FILTER_LABEL[liveFilter] }}（{{ filteredRows.length }} 人）
          <t-link theme="primary" @click="liveFilter = null">清除</t-link>
        </div>
        <div class="live-viewtoggle">
          <t-radio-group v-model="liveView" variant="default-filled" size="small">
            <t-radio-button value="tiles">卡片</t-radio-button>
            <t-radio-button value="table">表格</t-radio-button>
          </t-radio-group>
          <span class="page-sub" style="margin: 0">需要你处理的同学排在前面</span>
        </div>
        <LiveBoard
          v-if="liveView === 'tiles'"
          v-model:filter="liveFilter"
          :rows="live?.rows ?? []"
          :reveal-max="classSettings.revealBudget"
          @open="openAttempt"
        />
        <t-table
          v-else
          :data="filteredRows"
          :columns="liveColumns"
          row-key="anonCode"
          :loading="liveLoading"
          size="small"
          hover
          @row-click="(ctx: { row: LiveRow }) => openAttempt(ctx.row)"
        >
          <template #layer="{ row }">{{ layerName(row.layer) || '—' }}</template>
          <template #reveal="{ row }">{{ Math.round((row.reveal ?? 0) * 10) / 10 }} / {{ classSettings.revealBudget }}</template>
          <template #status="{ row }">
            <t-tag :theme="row.status === 'completed' ? 'success' : row.status === 'locked' ? 'danger' : 'default'" variant="light">
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
              {{ liveFilter ? '当前筛选下没有学生。' : liveError ? '加载失败，请稍后重试。' : '还没有作答：学生用邀请码登录并开始练习后，会出现在这里。' }}
            </div>
          </template>
        </t-table>
        <div class="page-sub" style="margin-top: 8px">每 5 秒自动刷新，页面不在前台时暂停。{{ streamConnected ? ' 实时连接正常。' : '' }}{{ streamError ? ` ${streamError}` : '' }}</div>
      </t-tab-panel>

      <t-tab-panel value="roster" label="名单">
        <h4 style="margin: 16px 0 8px">名单列表</h4>
        <t-alert v-if="rosterError" theme="warning" :message="rosterError" style="margin-bottom: 8px">
          <template #operation><t-link theme="primary" @click="loadRoster">重试</t-link></template>
        </t-alert>
        <t-table
          :data="rosterEntries"
          :columns="[
            { colKey: 'name', title: '姓名' },
            { colKey: 'claimed', title: '认领' },
            { colKey: 'claimedAt', title: '认领时间' },
            { colKey: 'claimedByAnon', title: '匿名码' },
            { colKey: 'passwordSet', title: '已设密码', width: 100 },
            { colKey: 'actions', title: '操作', width: 200 },
          ]"
          :loading="rosterLoading"
          row-key="rosterId"
          size="small"
        >
          <template #name="{ row }">{{ row.name ?? '未提供' }}</template>
          <template #claimed="{ row }">
            <t-tag :theme="row.claimed ? 'success' : 'default'" variant="light">{{ row.claimed ? '已认领' : '未认领' }}</t-tag>
          </template>
          <template #claimedAt="{ row }">{{ row.claimedAt ? new Date(row.claimedAt).toLocaleString('zh-CN') : '—' }}</template>
          <template #claimedByAnon="{ row }">{{ row.claimedByAnon ?? '—' }}</template>
          <template #passwordSet="{ row }">
            <t-tag v-if="!row.claimed" theme="default" variant="light">—</t-tag>
            <t-tag v-else :theme="row.passwordSet ? 'success' : 'warning'" variant="light" data-testid="roster-password-set">{{ row.passwordSet ? '已设置' : '未设置' }}</t-tag>
          </template>
          <template #actions="{ row }">
            <t-popconfirm
              v-if="row.claimed && row.passwordSet"
              content="重置后该学生所有设备上的登录会失效，需要用邀请码重新激活并设新密码。确定重置？"
              @confirm="resetPassword(row.rosterId)"
            >
              <t-link theme="primary" data-testid="roster-reset-password" :disabled="resetting !== null">重置密码</t-link>
            </t-popconfirm>
            <t-popconfirm v-if="row.claimed" content="解除后学生需重新用邀请码认领，确定？" @confirm="unclaim(row.rosterId)">
              <t-link theme="danger" style="margin-left: 8px" :disabled="unclaiming !== null">解除认领</t-link>
            </t-popconfirm>
            <span v-else class="page-sub">—</span>
          </template>
          <template #empty><div class="empty">名单为空，先导入 CSV。</div></template>
        </t-table>
        <div class="inline-actions invite-bar">
          <span>邀请码 <b class="mono">{{ classInfo?.inviteCode ?? '—' }}</b></span>
          <t-button size="small" variant="outline" @click="copyInvite">复制</t-button>
          <t-button size="small" :loading="rotating" @click="rotateInvite">重置邀请码</t-button>
          <t-button size="small" theme="primary" :loading="importing" @click="fileInput?.click()">导入名单</t-button>
          <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="onFileChange" />
        </div>
        <div class="page-sub">名单文件（CSV）每行两列：<code>学号,姓名</code>，姓名可以不填。编码自动识别，重复的学号会合并，不合格的行会列出原因。</div>
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
            <ProblemSelect v-model="selectedProblem" @select="onProblemSelect" />
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
          <t-form-item label="提示额度">
            <t-input-number v-model="assignmentForm.revealBudget" :min="0" :max="10" theme="normal" />
          </t-form-item>
          <t-form-item label=" ">
            <t-alert theme="info" message="拍照、求助、切出锁定和限时这几项目前只随布置保存，学生端还没有全部照着执行；测验模式本身会关闭提示，多次切出页面后锁定作答。" />
          </t-form-item>
          <t-form-item label="拍照">
            <t-switch v-model="assignmentForm.photoEnabled" />
          </t-form-item>
          <t-form-item label="允许求助">
            <t-switch v-model="assignmentForm.hintsEnabled" />
          </t-form-item>
          <t-form-item v-if="assignmentForm.mode === 'test'" label="切出锁定">
            <t-input-number v-model="assignmentForm.maxSwitches" :min="0" :max="10" theme="normal" suffix="次" />
          </t-form-item>
          <t-form-item v-if="assignmentForm.mode === 'test'" label="限时">
            <t-input-number v-model="assignmentForm.durationMin" :min="0" :max="300" theme="normal" suffix="分钟" />
          </t-form-item>
          <t-form-item label=" ">
            <t-button theme="primary" :loading="creating" data-testid="assign-submit" @click="createAssignment">布置</t-button>
          </t-form-item>
        </t-form>

        <h4>已布置的题</h4>
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
          <template #mode="{ row }">{{ row.mode === 'test' ? '测验' : '练习' }}</template>
          <template #status="{ row }">
            <span class="pg-pill" :class="`pg-pill--${row.status === 'open' ? 'grass' : row.status === 'scheduled' ? 'sea' : ''}`">{{ assignmentStatusLabel(row.status) }}</span>
          </template>
          <template #openAt="{ row }">{{ formatWhen(row.openAt) }}</template>
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

        <t-dialog v-model:visible="publishVisible" header="发布讲评" :footer="false">
          <t-alert v-if="publishError" theme="error" :message="publishError" style="margin-bottom: 8px" />
          <t-alert theme="info" message="布置关闭后才能发布讲评。发布后，学生可以看到这道题的参考证明和你写的讲评。" style="margin-bottom: 8px" />
          <t-form label-width="90px">
            <t-form-item label="讲评">
              <t-textarea v-model="publishNote" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="讲评说明（可不填；公式请用 $…$ 包起来）" />
            </t-form-item>
          </t-form>
          <div class="dialog-actions">
            <t-button variant="outline" :disabled="publishing" @click="publishVisible = false">取消</t-button>
            <t-button theme="primary" :loading="publishing" @click="submitPublish">发布讲评</t-button>
          </div>
        </t-dialog>
      </t-tab-panel>

      <t-tab-panel value="selfstudy" label="自学进度">
        <SelfStudyPanel :class-id="classId" :active="tab === 'selfstudy'" />
      </t-tab-panel>

      <t-tab-panel value="metrics" label="指标">
        <MetricsPanel :class-id="classId" :assignment-id="selectedAssignmentId === '' ? undefined : selectedAssignmentId" />
      </t-tab-panel>

      <t-tab-panel value="export" label="导出">
        <ExportPanel :class-id="classId" :class-name="classInfo?.name" />
      </t-tab-panel>

      <t-tab-panel value="settings" label="设置">
        <t-alert theme="info" message="这些默认值会作为新建布置表单的初始值；目前只是保存下来，学生端还没有全部照着执行。" style="margin: 12px 0" />
        <t-form label-width="140px" style="max-width: 560px; margin-top: 12px">
          <t-form-item label="拍照">
            <t-switch v-model="classSettings.photoEnabled" />
          </t-form-item>
          <t-form-item label="生成补充讲解">
            <t-switch v-model="classSettings.lessonGenerated" />
            <span class="page-sub" style="margin-left: 8px">默认关闭</span>
          </t-form-item>
          <t-form-item label="默认提示额度">
            <t-input-number v-model="classSettings.revealBudget" :min="0" :max="10" theme="normal" />
          </t-form-item>
          <t-form-item label="诚信策略">
            <t-select
              v-model="classSettings.integrityPractice"
              :options="[
                { label: '记录 + 轻提醒', value: 'log_and_notice' },
                { label: '仅记录', value: 'log_only' },
              ]"
              style="width: 200px"
            />
          </t-form-item>
          <t-form-item label="测验切出锁定">
            <t-input-number v-model="classSettings.testMaxSwitches" :min="0" :max="10" theme="normal" suffix="次" />
          </t-form-item>
          <t-form-item label=" ">
            <t-button theme="primary" :loading="savingSettings" @click="saveClassSettings">保存</t-button>
          </t-form-item>
        </t-form>
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
.live-viewtoggle {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0 12px;
  flex-wrap: wrap;
}
.live-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  flex-wrap: wrap;
}
.invite-bar { margin: 16px 0 8px; padding: 10px 14px; border: 1px solid var(--pg-border); border-radius: var(--pg-radius); background: var(--pg-surface); }
:deep(.t-form__controls .t-select),
:deep(.t-form__controls .t-input) { max-width: 360px; }
.native-input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--pg-rule-2);
  border-radius: 8px;
  background: var(--pg-surface);
  color: var(--pg-text);
  font: inherit;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
@media (max-width: 768px) {
  :deep(.t-form__label) { width: 76px !important; }
  :deep(.t-form__controls) { margin-left: 76px !important; }
}
</style>
