<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import MathTextView from '../components/MathTextView.vue';
import { autoChecksSummary, statusLabel, statusTheme } from '../utils/problems.ts';

interface ProblemItem {
  problemId: string;
  title: string;
  chapter?: string;
  kind: 'main' | 'transfer';
  version: number;
  status: string;
  autoChecks?: Record<string, unknown>;
  source?: string;
}

interface ProblemPackageView {
  id: string;
  version: number;
  kind: string;
  public: { title?: string; stem?: string; chapter?: string };
  secret: { keys?: unknown[]; routes?: unknown[] };
  review?: { status?: string; autoChecks?: Record<string, unknown> };
}

const items = ref<ProblemItem[]>([]);
const loading = ref(false);
const error = ref('');
const selected = ref<ProblemItem | null>(null);
const pkg = ref<ProblemPackageView | null>(null);
const pkgLoading = ref(false);
const pkgError = ref('');
const actionVisible = ref(false);
const actionDecision = ref<'approve' | 'return'>('approve');
const actionComments = ref('');
const actionMinutes = ref(10);
const acting = ref(false);
const actionError = ref('');

const columns = [
  { colKey: 'problemId', title: 'ID' },
  { colKey: 'title', title: '题目' },
  { colKey: 'chapter', title: '章节' },
  { colKey: 'kind', title: '类型' },
  { colKey: 'version', title: '版本' },
  { colKey: 'status', title: '审核状态' },
  { colKey: 'checks', title: '自动校验' },
];

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    items.value = await api.get<ProblemItem[]>('/api/v1/teacher/problems');
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '加载题库失败';
  } finally {
    loading.value = false;
  }
}

async function open(item: ProblemItem): Promise<void> {
  selected.value = item;
  pkg.value = null;
  pkgError.value = '';
  pkgLoading.value = true;
  try {
    pkg.value = await api.get<ProblemPackageView>(
      `/api/v1/teacher/problems/${item.problemId}/versions/${item.version}`,
    );
  } catch (caught) {
    pkgError.value = caught instanceof ApiError ? caught.message : '加载题目包失败';
  } finally {
    pkgLoading.value = false;
  }
}

function close(): void {
  selected.value = null;
  pkg.value = null;
}

const canReview = (): boolean => {
  const status = pkg.value?.review?.status ?? selected.value?.status ?? '';
  return status === 'draft' || status === 'pending' || status === 'returned';
};

function openAction(decision: 'approve' | 'return'): void {
  actionDecision.value = decision;
  actionComments.value = '';
  actionMinutes.value = 10;
  actionError.value = '';
  actionVisible.value = true;
}

async function submitAction(): Promise<void> {
  if (selected.value === null) return;
  acting.value = true;
  actionError.value = '';
  try {
    const body =
      actionDecision.value === 'approve'
        ? { decision: 'approve', comments: actionComments.value, minutes: actionMinutes.value }
        : { decision: 'return', comments: actionComments.value };
    await api.post(
      `/api/v1/teacher/problems/${selected.value.problemId}/versions/${selected.value.version}/review`,
      body,
    );
    MessagePlugin.success(actionDecision.value === 'approve' ? '已通过并发布' : '已退回');
    actionVisible.value = false;
    await load();
    await open(selected.value);
  } catch (caught) {
    actionError.value = caught instanceof ApiError ? caught.message : '审核失败';
  } finally {
    acting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <h1>题库与审核</h1>
      <t-button size="small" :loading="loading" @click="load">刷新</t-button>
    </div>
    <div class="page-sub">审核屏（04 §8）：先看题目与自动校验；发布/退回结论接口下一 PR 接。</div>
    <t-alert v-if="error" theme="error" :message="error" style="margin: 12px 0" />

    <t-table
      :data="items"
      :columns="columns"
      :row-key="(row: ProblemItem) => `${row.problemId}@${row.version}`"
      :loading="loading"
      size="small"
      hover
      @row-click="(ctx: { row: ProblemItem }) => open(ctx.row)"
    >
      <template #title="{ row }"><MathTextView :text="row.title" /></template>
      <template #kind="{ row }">{{ row.kind === 'transfer' ? '迁移题' : '主题' }}</template>
      <template #status="{ row }">
        <t-tag :theme="statusTheme(row.status)" variant="light">{{ statusLabel(row.status) }}</t-tag>
      </template>
      <template #checks="{ row }">
        <t-tag v-if="autoChecksSummary(row.autoChecks).total === 0" variant="light">未提供</t-tag>
        <t-tag
          v-else
          :theme="autoChecksSummary(row.autoChecks).failed.length === 0 ? 'success' : 'danger'"
          variant="light"
        >
          {{ autoChecksSummary(row.autoChecks).failed.length === 0 ? '全过' : `失败 ${autoChecksSummary(row.autoChecks).failed.length}` }}
        </t-tag>
      </template>
      <template #empty><div class="empty">题库为空。导入流水线发布后会出现。</div></template>
    </t-table>

    <t-drawer :visible="selected !== null" size="720px" header="题目详情（含 secret，仅教师可见）" @close="close">
      <t-alert v-if="pkgError" theme="error" :message="pkgError" />
      <t-loading v-else-if="pkgLoading" />
      <div v-else-if="selected && pkg">
        <h3 style="margin-top: 0">{{ pkg.public.title ?? selected.title }} <span class="page-sub">v{{ pkg.version }}</span></h3>
        <div class="page-sub">{{ selected.problemId }} · {{ selected.chapter ?? '' }} · {{ pkg.kind === 'transfer' ? '迁移题' : '主题' }}</div>
        <t-alert
          v-if="(pkg.review?.autoChecks as Record<string, unknown> | undefined)"
          :theme="autoChecksSummary(pkg.review?.autoChecks).failed.length === 0 ? 'success' : 'warning'"
          :message="autoChecksSummary(pkg.review?.autoChecks).failed.length === 0 ? '自动校验全部通过' : `自动校验失败：${autoChecksSummary(pkg.review?.autoChecks).failed.join(', ')}`"
          style="margin: 8px 0"
        />
        <h4>题面</h4>
        <MathTextView :text="pkg.public.stem" />
        <h4>结构</h4>
        <div class="page-sub">关键步骤 {{ pkg.secret.keys?.length ?? 0 }} · 路线 {{ pkg.secret.routes?.length ?? 0 }}</div>
        <div v-if="canReview()" class="review-actions">
          <t-button theme="primary" @click="openAction('approve')">通过并发布</t-button>
          <t-button theme="danger" variant="outline" @click="openAction('return')">退回</t-button>
          <span class="page-sub">approve 要求四项自动校验全绿（S8 写入 auto_checks）</span>
        </div>
        <t-alert v-else theme="success" message="该版本已发布，无需再审核。" style="margin-top: 12px" />
        <details style="margin-top: 12px">
          <summary>原始题目包 JSON</summary>
          <pre class="pkg-json">{{ JSON.stringify(pkg, null, 2) }}</pre>
        </details>
      </div>
    </t-drawer>

    <t-dialog
      v-model:visible="actionVisible"
      :header="actionDecision === 'approve' ? '通过并发布' : '退回题目'"
      :confirm-btn="{ content: actionDecision === 'approve' ? '通过' : '退回', loading: acting }"
      @confirm="submitAction"
    >
      <t-alert v-if="actionError" theme="error" :message="actionError" style="margin-bottom: 8px" />
      <t-form label-width="70px">
        <t-form-item label="意见">
          <t-textarea v-model="actionComments" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="给导入同学的说明（可空）" />
        </t-form-item>
        <t-form-item v-if="actionDecision === 'approve'" label="用时">
          <t-input-number v-model="actionMinutes" :min="0" :max="100000" suffix="分钟" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.pkg-json {
  max-height: 360px;
  overflow: auto;
  background: var(--td-bg-color-container-hover, #f7f8fa);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
}
</style>
