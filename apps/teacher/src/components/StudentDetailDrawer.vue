<script setup lang="ts">
import { ref, watch } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import type { HelpFlagItem, IntegrityItem, TeacherAttemptDetail, TeacherLine } from '../api/types.ts';
import MathTextView from './MathTextView.vue';

const props = defineProps<{ visible: boolean; attemptId: string | null }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; refresh: [] }>();

const detail = ref<TeacherAttemptDetail | null>(null);
const loading = ref(false);
const error = ref('');
const nudgeText = ref('');
const nudgeSending = ref(false);
const resolving = ref<string | null>(null);

const STATUS_LABEL: Record<string, string> = {
  active: '进行中',
  parked: '搁置',
  locked: '锁定',
  completed: '已完成',
  abandoned: '已放弃',
};
const PROVENANCE_LABEL: Record<string, string> = {
  ink: '✍ 手写',
  keyboard: '⌨ 键盘',
  photo: '📷 拍照',
  mixed: '✍⌨ 混合',
  paste: '📋 粘贴',
};

const lineColumns = [
  { colKey: 'layer', title: '层', width: 60 },
  { colKey: 'n', title: '行', width: 50 },
  { colKey: 'statement', title: '这一行' },
  { colKey: 'justification', title: '依据' },
  { colKey: 'keys', title: '关键步骤', width: 140 },
  { colKey: 'meta', title: '归类', width: 150 },
];

function messageOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : '请求失败';
}

async function load(): Promise<void> {
  const attemptId = props.attemptId;
  if (attemptId === null) return;
  loading.value = true;
  error.value = '';
  try {
    detail.value = await api.get<TeacherAttemptDetail>(`/api/v1/teacher/attempts/${attemptId}`);
  } catch (caught) {
    detail.value = null;
    error.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.visible, props.attemptId],
  () => {
    if (props.visible) void load();
  },
  { immediate: true },
);

function close(): void {
  emit('update:visible', false);
}

async function unlock(): Promise<void> {
  if (props.attemptId === null) return;
  try {
    detail.value = await api.post<TeacherAttemptDetail>(`/api/v1/teacher/attempts/${props.attemptId}/unlock`, {});
    MessagePlugin.success('已解锁（计数不清零，阈值 +1）');
    emit('refresh');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  }
}

async function sendNudge(): Promise<void> {
  if (props.attemptId === null || nudgeText.value.trim() === '') return;
  nudgeSending.value = true;
  try {
    const res = await api.post<{ shown: string; gated: boolean }>(
      `/api/v1/teacher/attempts/${props.attemptId}/nudge`,
      { text: nudgeText.value.trim() },
    );
    if (res.gated) MessagePlugin.warning('这句话包含学生尚未写出的步骤，未发送');
    else {
      MessagePlugin.success('已发送');
      nudgeText.value = '';
    }
    await load();
    emit('refresh');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    nudgeSending.value = false;
  }
}

async function resolve(flagId: string | undefined, disposition: 'dismissed' | 'noted' | 'talked'): Promise<void> {
  if (flagId === undefined) return;
  resolving.value = flagId;
  try {
    await api.post(`/api/v1/teacher/flags/${flagId}/resolve`, { disposition });
    MessagePlugin.success('已处理（只记录，不自动处罚）');
    await load();
    emit('refresh');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    resolving.value = null;
  }
}

function lineMeta(line: TeacherLine): string {
  const conf = line.conf === null ? '' : `conf ${line.conf.toFixed(2)}`;
  return [line.cls, line.path, conf].filter((item) => item !== '').join(' · ');
}
</script>

<template>
  <t-drawer :visible="visible" size="760px" header="学生作答详情" @close="close">
    <div v-if="error" class="drawer-error">
      <t-alert theme="error" :message="error" />
    </div>
    <div v-else-if="detail === null">
      <t-loading :loading="loading" />
      <div v-if="!loading" class="empty">暂无数据</div>
    </div>
    <div v-else>
      <div class="detail-head">
        <div>
          <b>{{ detail.displayName ?? detail.anonCode }}</b>
          <span class="page-sub"> {{ detail.anonCode }} · {{ detail.problem.title }} · {{ detail.mode === 'test' ? '测验' : '练习' }}</span>
        </div>
        <t-tag :theme="detail.status === 'locked' ? 'danger' : detail.status === 'completed' ? 'success' : 'default'">
          {{ STATUS_LABEL[detail.status] ?? detail.status }}
        </t-tag>
      </div>

      <div class="intervene">
        <t-popconfirm content="解锁后计数不清零、阈值 +1，确定解锁？" @confirm="unlock">
          <t-button size="small" :disabled="detail.status !== 'locked'">解锁</t-button>
        </t-popconfirm>
        <div class="nudge-box">
          <t-input v-model="nudgeText" placeholder="发给学生一句话（≤200 字，过闸门）" :maxlength="200" />
          <t-button size="small" theme="primary" :loading="nudgeSending" @click="sendNudge">发送</t-button>
        </div>
      </div>

      <h4>证明行</h4>
      <t-table :data="detail.lines" :columns="lineColumns" row-key="lineId" size="small">
        <template #statement="{ row }"><MathTextView :text="row.statement" /></template>
        <template #justification="{ row }"><MathTextView :text="row.justification" /></template>
        <template #keys="{ row }">
          <t-space v-if="row.keys.length">
            <t-tag v-for="key in row.keys" :key="key" size="small" variant="light">{{ key }}</t-tag>
          </t-space>
          <span v-else>—</span>
        </template>
        <template #meta="{ row }">
          <div class="line-meta">
            <span>{{ PROVENANCE_LABEL[row.provenance] ?? row.provenance }}</span>
            <span v-if="lineMeta(row)">{{ lineMeta(row) }}</span>
          </div>
        </template>
        <template #empty><div class="empty">还没有证明行。</div></template>
      </t-table>

      <h4>提示（{{ detail.hints.length }}）</h4>
      <div v-if="detail.hints.length === 0" class="empty">还没有领取提示。</div>
      <div v-for="hint in detail.hints" :key="hint.hintId" class="hint-item">
        <div class="hint-meta">{{ hint.level }} · 透露 {{ hint.cost }} · {{ new Date(hint.deliveredAt).toLocaleTimeString('zh-CN') }}</div>
        <MathTextView :text="hint.text" />
      </div>

      <h4>诚信信号（只记录，不自动处罚）</h4>
      <div v-if="detail.integrity.length === 0" class="empty">没有诚信信号。</div>
      <div v-for="(signal, index) in detail.integrity" :key="`${signal.signal}-${index}`" class="flag-item">
        <div>
          <b>{{ signal.signal }}</b>
          <span class="page-sub"> 分数 {{ signal.score.toFixed(2) }} · {{ signal.source ?? '' }}
            <template v-if="signal.disposition"> · 已处理：{{ signal.disposition }}</template>
          </span>
        </div>
        <t-space v-if="signal.flagId && !signal.disposition">
          <t-button size="small" variant="text" :loading="resolving === signal.flagId" @click="resolve(signal.flagId, 'dismissed')">忽略</t-button>
          <t-button size="small" variant="text" :loading="resolving === signal.flagId" @click="resolve(signal.flagId, 'noted')">已记录</t-button>
          <t-button size="small" variant="text" :loading="resolving === signal.flagId" @click="resolve(signal.flagId, 'talked')">已面谈</t-button>
        </t-space>
      </div>

      <h4>求助标记</h4>
      <div v-if="detail.helpFlags.length === 0" class="empty">没有待处理的求助标记。</div>
      <div v-for="flag in detail.helpFlags" :key="flag.flagId" class="flag-item">
        <div>
          <b>求助</b>
          <span class="page-sub"> {{ flag.layer ?? '' }} · {{ new Date(flag.at).toLocaleTimeString('zh-CN') }}
            <template v-if="flag.resolved"> · 已处理</template>
          </span>
        </div>
        <t-space v-if="!flag.resolved">
          <t-button size="small" variant="text" :loading="resolving === flag.flagId" @click="resolve(flag.flagId, 'noted')">已记录</t-button>
          <t-button size="small" variant="text" :loading="resolving === flag.flagId" @click="resolve(flag.flagId, 'talked')">已面谈</t-button>
        </t-space>
      </div>

      <h4>时间线（最近 100 条）</h4>
      <div class="timeline">
        <div v-for="item in detail.timeline.slice(0, 100)" :key="item.seq" class="timeline-item">
          <span class="timeline-time">{{ new Date(item.at).toLocaleTimeString('zh-CN') }}</span>
          <span class="mono">{{ item.type }}</span>
          <span class="page-sub">{{ item.layer ?? '' }}</span>
        </div>
      </div>
    </div>
  </t-drawer>
</template>

<style scoped>
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.intervene {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--td-bg-color-container-hover, #f7f8fa);
  border-radius: 8px;
  margin-bottom: 8px;
}
.nudge-box {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 260px;
}
.line-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--td-text-color-secondary, #5e6670);
}
.hint-item {
  padding: 8px 12px;
  border-left: 3px solid var(--td-brand-color, #006eff);
  margin-bottom: 8px;
  background: var(--td-bg-color-container-hover, #f7f8fa);
}
.hint-meta {
  font-size: 12px;
  color: var(--td-text-color-secondary, #5e6670);
  margin-bottom: 4px;
}
.flag-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 8px;
  margin-bottom: 8px;
}
.timeline {
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 8px;
  padding: 8px 12px;
}
.timeline-item {
  display: flex;
  gap: 12px;
  padding: 3px 0;
  font-size: 12px;
}
.timeline-time {
  color: var(--td-text-color-secondary, #5e6670);
  min-width: 72px;
}
.drawer-error {
  padding: 8px 0;
}
</style>
