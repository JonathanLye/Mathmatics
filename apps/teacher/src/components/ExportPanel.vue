<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import { session } from '../stores/session.ts';
import type { AssignmentCard, ExportFormat, ExportJob, ExportTable } from '../api/types.ts';

const props = defineProps<{ classId: string }>();

const format = ref<ExportFormat>('csv');
const tables = ref<ExportTable[]>(['attempts', 'lines', 'hints', 'help', 'recognitions', 'integrity', 'events']);
const anonymized = ref(true);
const assignments = ref<AssignmentCard[]>([]);
const selectedAssignmentIds = ref<string[]>([]);
const assignmentsLoading = ref(false);
const approving = ref(false);
const submitting = ref(false);
const job = ref<ExportJob | null>(null);
const error = ref('');
let timer: number | undefined;

const formatOptions = [
  { label: 'CSV（UTF-8 BOM）', value: 'csv' },
  { label: 'Excel（.xlsx）', value: 'xlsx' },
  { label: 'JSONL（每表 .jsonl）', value: 'jsonl' },
];
// 08 §5 字段字典（与 server 导出列一致）；页面展示，便于教师核对下载内容。
const FIELD_DICT: Record<ExportTable, string[]> = {
  attempts: ['anon_id', 'attempt_id', 'class_code', 'arm', 'arm_order', 'grade', 'problem_id', 'problem_version', 'chapter', 'tags', 'difficulty', 'role', 'mode', 'kind', 'parent_attempt_id', 'started_at', 'completed_at', 'duration_s', 'active_s', 'submissions', 'layers_done', 'layers_skipped', 'def_attempts', 'lesson_opened', 'lines', 'keys_total', 'keys_own', 'keys_autonomous', 'reveal', 'independence', 'hints_total', 'hint_max_level', 'first_error', 'first_help_latency_s', 'post_hint_dwell_med_s', 'rapid_locks', 'stuck_offers', 'pressure_count', 'help_stuck', 'help_concept', 'help_check', 'help_free', 'input_ink', 'input_kbd', 'input_photo', 'input_paste', 'recog_requests', 'recog_edit_rate', 'recog_disagree_rate', 'away_count', 'away_s', 'integrity_max_score', 'integrity_signals', 'completed', 'summary_missing_points', 'model_versions', 'prompt_version'],
  lines: ['anon_id', 'attempt_id', 'layer', 'role', 'idx', 'slot', 'statement', 'justification', 'statement_canon', 'provenance', 'cls', 'keys', 'new_keys', 'error_id', 'conf', 'classifier_path', 'created_at', 'edited_at', 'deleted_at'],
  hints: ['anon_id', 'attempt_id', 'help_id', 'key_id', 'level', 'cost', 'reveal_before', 'reveal_after', 'text_shown', 'delivered_at'],
  help: ['anon_id', 'attempt_id', 'layer', 'intent', 'routed', 'routed_by', 'conf', 'text', 'outcome', 'created_at'],
  recognitions: ['anon_id', 'attempt_id', 'kind', 'provider', 'cross_provider', 'confidence', 'agree', 'latency_ms', 'queue_ms', 'status', 'edited', 'edit_distance', 'cost_cny', 'created_at'],
  integrity: ['anon_id', 'attempt_id', 'signal', 'score', 'evidence', 'source', 'disposition', 'created_at'],
  events: ['id', 'seq', 'type', 'source', 'ts_server', 'ts_client', 'session_id', 'device_id', 'client_seq', 'user_anon', 'role', 'class_id', 'assignment_id', 'attempt_id', 'problem_id', 'problem_version', 'layer', 'mode', 'arm', 'app_version', 'platform', 'prompt_version', 'model_versions', 'payload'],
};
const FIELD_DICT_ROWS = Object.entries(FIELD_DICT).map(([table, fields]) => ({
  table,
  fields: fields.join(', '),
}));

const tableOptions: Array<{ label: string; value: ExportTable }> = [
  { label: '作答汇总 attempts', value: 'attempts' },
  { label: '证明行长表 lines', value: 'lines' },
  { label: '提示 hints', value: 'hints' },
  { label: '求助 help', value: 'help' },
  { label: '识别 recognitions', value: 'recognitions' },
  { label: '诚信 integrity', value: 'integrity' },
  { label: '事件 events.jsonl', value: 'events' },
];

async function loadAssignments(): Promise<void> {
  assignmentsLoading.value = true;
  try {
    assignments.value = await api.get<AssignmentCard[]>(`/api/v1/teacher/assignments?classId=${encodeURIComponent(props.classId)}`);
  } catch {
    assignments.value = [];
  } finally {
    assignmentsLoading.value = false;
  }
}

onMounted(loadAssignments);

async function submit(): Promise<void> {
  error.value = '';
  submitting.value = true;
  try {
    job.value = await api.post<ExportJob>('/api/v1/teacher/exports', {
      classId: props.classId,
      format: format.value,
      tables: tables.value,
      anonymized: anonymized.value,
      ...(selectedAssignmentIds.value.length > 0 ? { assignmentIds: selectedAssignmentIds.value } : {}),
    });
    MessagePlugin.success('导出任务已排队');
    startPolling();
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      error.value = '导出接口不可用（404）：请确认 server 版本包含 /teacher/exports。';
    } else {
      error.value = caught instanceof ApiError ? caught.message : '导出失败';
    }
  } finally {
    submitting.value = false;
  }
}

async function approveJob(): Promise<void> {
  const current = job.value;
  if (current === null || approving.value) return;
  approving.value = true;
  try {
    job.value = await api.post<ExportJob>(`/api/v1/teacher/exports/${current.exportId}/approve`);
    MessagePlugin.success('已审批，正在生成实名导出');
    startPolling();
  } catch (caught) {
    MessagePlugin.error(caught instanceof ApiError ? caught.message : '审批失败');
  } finally {
    approving.value = false;
  }
}

async function refreshJob(): Promise<void> {
  const current = job.value;
  if (current === null) return;
  try {
    job.value = await api.get<ExportJob>(`/api/v1/teacher/exports/${current.exportId}`);
    if (job.value.status === 'done') startPolling();
  } catch (caught) {
    MessagePlugin.error(caught instanceof ApiError ? caught.message : '刷新失败');
  }
}

function startPolling(): void {
  stopPolling();
  timer = window.setInterval(async () => {
    const current = job.value;
    if (current === null) return;
    try {
      job.value = await api.get<ExportJob>(`/api/v1/teacher/exports/${current.exportId}`);
      if (['done', 'failed', 'expired', 'pending_approval'].includes(job.value.status)) stopPolling();
    } catch {
      stopPolling();
    }
  }, 2000);
}

function stopPolling(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

onBeforeUnmount(stopPolling);
</script>

<template>
  <div>
    <h3 style="margin: 12px 0 8px">导出</h3>
    <t-alert
      theme="info"
      message="默认匿名（只含匿名码）；实名导出需管理员审批并写 audit_log（04 §9、05 §7）。字段与 08 §5 一致，每个文件附字段字典。"
      style="margin-bottom: 12px"
    />
    <t-alert v-if="error" theme="warning" :message="error" style="margin-bottom: 12px" />

    <t-form label-width="90px" style="max-width: 620px">
      <t-form-item label="班级">
        <span class="mono">{{ classId }}</span>
      </t-form-item>
      <t-form-item label="布置">
        <t-select
          v-model="selectedAssignmentIds"
          :options="assignments.map((item) => ({ label: `${item.title} · ${item.mode === 'test' ? '测验' : '练习'} · ${item.status}`, value: item.assignmentId }))"
          :loading="assignmentsLoading"
          multiple
          clearable
          placeholder="默认全班全部布置"
          style="width: 320px"
        />
      </t-form-item>
      <t-form-item label="格式">
        <t-select v-model="format" :options="formatOptions" style="width: 220px" />
      </t-form-item>
      <t-form-item label="数据表">
        <t-checkbox-group v-model="tables" :options="tableOptions" />
      </t-form-item>
      <t-form-item label="匿名">
        <t-switch v-model="anonymized" />
      </t-form-item>
      <t-form-item label=" ">
        <t-button theme="primary" :loading="submitting" @click="submit">创建导出任务</t-button>
      </t-form-item>
    </t-form>

    <div v-if="job" class="export-status">
      <div>任务 <span class="mono">{{ job.exportId }}</span>：状态 <b>{{ job.status }}</b></div>
      <div v-if="job.rows !== null && job.rows !== undefined">行数：{{ job.rows }}</div>
      <t-link v-if="job.url" theme="primary" :href="job.url" target="_blank">下载</t-link>
      <div v-else-if="job.status === 'pending_approval'" class="page-sub">
        实名导出等待管理员审批。
        <t-button v-if="session.me?.role === 'admin'" size="small" theme="primary" :loading="approving" @click="approveJob">审批并生成</t-button>
        <t-button size="small" variant="outline" @click="refreshJob">刷新</t-button>
      </div>
    </div>
    <div class="page-sub">说明：导出字段字典随文件提供（Excel 第二工作表 / CSV 同名 .dictionary.csv）。文件 24 小时后删除，过期请重新导出。</div>
    <h4 style="margin: 18px 0 6px">字段字典（08 §5）</h4>
    <t-table :data="FIELD_DICT_ROWS" :columns="[{ colKey: 'table', title: '表' }, { colKey: 'fields', title: '字段' }]" row-key="table" size="small" />
  </div>
</template>

<style scoped>
.export-status {
  margin-top: 12px;
  padding: 12px 16px;
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 8px;
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
</style>
