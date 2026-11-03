<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import type { ExportFormat, ExportJob, ExportTable } from '../api/types.ts';

const props = defineProps<{ classId: string }>();

const format = ref<ExportFormat>('csv');
const tables = ref<ExportTable[]>(['attempts', 'lines', 'hints', 'help', 'recognitions', 'integrity', 'events']);
const anonymized = ref(true);
const submitting = ref(false);
const job = ref<ExportJob | null>(null);
const error = ref('');
let timer: number | undefined;

const formatOptions = [
  { label: 'CSV（UTF-8 BOM）', value: 'csv' },
  { label: 'Excel（.xlsx）', value: 'xlsx' },
  { label: 'JSONL（事件）', value: 'jsonl' },
];
const tableOptions: Array<{ label: string; value: ExportTable }> = [
  { label: '作答汇总 attempts', value: 'attempts' },
  { label: '证明行长表 lines', value: 'lines' },
  { label: '提示 hints', value: 'hints' },
  { label: '求助 help', value: 'help' },
  { label: '识别 recognitions', value: 'recognitions' },
  { label: '诚信 integrity', value: 'integrity' },
  { label: '事件 events.jsonl', value: 'events' },
];

async function submit(): Promise<void> {
  error.value = '';
  submitting.value = true;
  try {
    job.value = await api.post<ExportJob>('/api/v1/teacher/exports', {
      classId: props.classId,
      format: format.value,
      tables: tables.value,
      anonymized: anonymized.value,
    });
    MessagePlugin.success('导出任务已排队');
    startPolling();
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      error.value = '导出接口尚未上线（B 的 #32）；页面与请求体已按契约（06 §3.6 / 08 §5）就绪。';
    } else {
      error.value = caught instanceof ApiError ? caught.message : '导出失败';
    }
  } finally {
    submitting.value = false;
  }
}

function startPolling(): void {
  stopPolling();
  timer = window.setInterval(async () => {
    const current = job.value;
    if (current === null) return;
    try {
      job.value = await api.get<ExportJob>(`/api/v1/teacher/exports/${current.exportId}`);
      if (['done', 'failed', 'expired'].includes(job.value.status)) stopPolling();
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
      <div v-else-if="job.status === 'pending_approval'" class="page-sub">实名导出等待管理员审批。</div>
    </div>
    <div class="page-sub">说明：导出字段字典随文件提供（Excel 第二工作表 / CSV 同名 .dictionary.csv）。</div>
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
