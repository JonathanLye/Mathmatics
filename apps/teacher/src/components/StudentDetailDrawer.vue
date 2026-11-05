<script setup lang="ts">
import { ref, watch } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import type { HelpFlagItem, IntegrityItem, TeacherAttemptDetail, TeacherLine } from '../api/types.ts';
import { MIRROR_IFRAME_SANDBOX, isMirrorPageUrl } from '../utils/mirror.ts';
import ReplayDialog from './ReplayDialog.vue';
import MathTextView from './MathTextView.vue';

const props = defineProps<{ visible: boolean; attemptId: string | null }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; refresh: [] }>();

const detail = ref<TeacherAttemptDetail | null>(null);
const loading = ref(false);
const error = ref('');
const nudgeText = ref('');
const nudgeSending = ref(false);
const resolving = ref<string | null>(null);
const mirrorVisible = ref(false);
const replayVisible = ref(false);
const mirrorUrl = ref('');
const mirrorLoading = ref(false);
const reclassifyVisible = ref(false);
const reclassifyTarget = ref<TeacherLine | null>(null);
const reclassifyCls = ref<string>('match');
const reclassifyKeys = ref('');
const reclassifyErrorId = ref('');
const reclassifyNote = ref('');
const reclassifying = ref(false);
const reclassifyError = ref('');

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
  { colKey: 'actions', title: '改判', width: 70 },
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
    const loaded = await api.get<TeacherAttemptDetail>(`/api/v1/teacher/attempts/${attemptId}`);
    // 契约尚未命名 helpFlags/timeline 等字段（见 PR #106 缺口清单）：缺字段时按空数组兜底。
    detail.value = {
      ...loaded,
      helpFlags: loaded.helpFlags ?? [],
      integrity: loaded.integrity ?? [],
      hints: loaded.hints ?? [],
      lines: loaded.lines ?? [],
      timeline: loaded.timeline ?? [],
    };
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

function openReclassify(line: TeacherLine): void {
  reclassifyTarget.value = line;
  reclassifyCls.value = line.cls === 'lowconf' ? 'match' : line.cls || 'match';
  reclassifyKeys.value = line.keys.join(', ');
  reclassifyErrorId.value = '';
  reclassifyNote.value = '';
  reclassifyError.value = '';
  reclassifyVisible.value = true;
}

async function submitReclassify(): Promise<void> {
  if (reclassifyTarget.value === null || reclassifying.value) return;
  reclassifying.value = true;
  reclassifyError.value = '';
  try {
    const keys = reclassifyKeys.value.split(/[,，\s]+/).map((item) => item.trim()).filter((item) => item !== '');
    await api.post(`/api/v1/teacher/attempts/${props.attemptId}/lines/${reclassifyTarget.value.lineId}/reclassify`, {
      cls: reclassifyCls.value,
      ...(keys.length > 0 ? { keys } : {}),
      ...(reclassifyErrorId.value.trim() === '' ? {} : { errorId: reclassifyErrorId.value.trim() }),
      ...(reclassifyNote.value.trim() === '' ? {} : { note: reclassifyNote.value.trim() }),
    });
    MessagePlugin.success('已改判（写审计，不改学生已见内容）');
    reclassifyVisible.value = false;
    await load();
    emit('refresh');
  } catch (caught) {
    reclassifyError.value = messageOf(caught);
  } finally {
    reclassifying.value = false;
  }
}

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

// 软着陆（01 §4、11 §5.2）：学生额度用尽后，教师补发一条 H4（下一个未完成的步骤）。
// 服务端只在额度耗尽后接受；学生需补 ≥6 字依据，该步才计入；本题标记"含教师补发"。
async function grantHint(): Promise<void> {
  if (props.attemptId === null) return;
  try {
    detail.value = await api.post<TeacherAttemptDetail>(`/api/v1/teacher/attempts/${props.attemptId}/unlock`, { grantH4: '' });
    MessagePlugin.success('已补发一条 H4：学生补上依据后才计入，本题标记含教师补发');
    emit('refresh');
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  }
}

// 04 §5.1：取 5 分钟只读令牌，iframe 打开学生镜像页（/s/mirror，A 侧页面）。
async function openMirror(): Promise<void> {
  if (props.attemptId === null) return;
  mirrorLoading.value = true;
  try {
    const res = await api.post<{ token: string; url: string; expiresAt: string }>(
      `/api/v1/teacher/attempts/${props.attemptId}/mirror-token`,
      {},
    );
    const url = new URL(res.url, window.location.origin).toString();
    if (!isMirrorPageUrl(url)) throw new Error('镜像地址不合法（必须 /s/mirror + attempt + token）');
    mirrorUrl.value = url;
    mirrorVisible.value = true;
  } catch (caught) {
    MessagePlugin.error(messageOf(caught));
  } finally {
    mirrorLoading.value = false;
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
        <t-popconfirm content="学生额度用尽时才可用：补发一条 H4（下一个未完成的步骤），学生需补依据才计入，本题不再算独立完成。确定补发？" @confirm="grantHint">
          <t-button size="small" :disabled="detail.status === 'completed'" data-testid="grant-h4">补发提示（额度用尽）</t-button>
        </t-popconfirm>
        <t-button size="small" :loading="mirrorLoading" @click="openMirror">镜像预览</t-button>
        <t-button size="small" @click="replayVisible = true">回放</t-button>
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
        <template #actions="{ row }">
          <t-link theme="primary" @click="openReclassify(row as TeacherLine)">改判</t-link>
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

    <ReplayDialog v-model:visible="replayVisible" :attempt-id="attemptId" />

    <t-dialog v-model:visible="mirrorVisible" header="镜像预览（只读）" width="900px" :footer="false">
      <div class="page-sub" style="margin-bottom: 8px">
        学生端镜像页（<code>/s/mirror</code>）由 A 侧提供；未上线前 iframe 会显示 404。只读由镜像页自身实现，
        iframe 只用 <code>allow-scripts</code>，不加 <code>allow-same-origin</code>（04 §5.1 / PR #100 安全结论）。
      </div>
      <iframe
        v-if="mirrorUrl"
        :src="mirrorUrl"
        class="mirror-frame"
        title="学生作答镜像"
        :sandbox="MIRROR_IFRAME_SANDBOX"
        referrerpolicy="no-referrer"
        allow="fullscreen"
      />
    </t-dialog>
  </t-drawer>

    <t-dialog v-model:visible="reclassifyVisible" header="改判该行归类" :footer="false" width="560px">
      <t-alert v-if="reclassifyError" theme="error" :message="reclassifyError" style="margin-bottom: 8px" />
      <t-alert theme="info" message="改判只更新教师侧归类并写 audit_log，不改变学生已看到的批注/事件。" style="margin-bottom: 8px" />
      <t-form label-width="90px">
        <t-form-item label="归类">
          <t-select
            v-model="reclassifyCls"
            :options="[
              { label: '命中 match', value: 'match' },
              { label: '错误 error', value: 'error' },
              { label: '未知 unknown', value: 'unknown' },
              { label: '低置信 lowconf', value: 'lowconf' },
              { label: '通过 pass', value: 'pass' },
              { label: '失败 fail', value: 'fail' },
            ]"
            style="width: 200px"
          />
        </t-form-item>
        <t-form-item label="关键步骤">
          <t-input v-model="reclassifyKeys" placeholder="K1, K2（可空；逗号分隔）" />
        </t-form-item>
        <t-form-item label="错误 ID">
          <t-input v-model="reclassifyErrorId" placeholder="如 E1（可空）" />
        </t-form-item>
        <t-form-item label="备注">
          <t-input v-model="reclassifyNote" placeholder="改判理由（可空，≤200 字）" :maxlength="200" />
        </t-form-item>
      </t-form>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px">
        <t-button variant="outline" :disabled="reclassifying" @click="reclassifyVisible = false">取消</t-button>
        <t-button theme="primary" :loading="reclassifying" @click="submitReclassify">保存改判</t-button>
      </div>
    </t-dialog>
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
.mirror-frame {
  width: 100%;
  height: 70vh;
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 8px;
  background: #fff;
}
.drawer-error {
  padding: 8px 0;
}
</style>
