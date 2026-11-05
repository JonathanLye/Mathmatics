<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import MathTextView from '../components/MathTextView.vue';
import { autoChecksSummary, canReviewStatus, statusLabel, statusTheme } from '../utils/problems.ts';

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
  public: {
    title?: string;
    stem?: string;
    chapter?: string;
    def?: { task?: string; conceptId?: string };
    frame?: { task?: string; template?: string };
    budget?: { reveal?: number };
    layers?: Record<string, { enabled?: boolean; skippable?: boolean }>;
  };
  secret: { keys?: unknown[]; routes?: unknown[] };
  review?: {
    status?: string;
    autoChecks?: Record<string, unknown>;
    reviewer?: string;
    reviewedAt?: string;
    comments?: string;
  };
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
const editVisible = ref(false);
const editJson = ref('');
const editError = ref('');
const editing = ref(false);

const columns = [
  { colKey: 'problemId', title: 'ID' },
  { colKey: 'title', title: '题目' },
  { colKey: 'chapter', title: '章节' },
  { colKey: 'kind', title: '类型' },
  { colKey: 'version', title: '版本' },
  { colKey: 'status', title: '审核状态' },
  { colKey: 'checks', title: '自动校验' },
  { colKey: 'actions', title: '操作', width: 90 },
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

const canReview = (): boolean => canReviewStatus(pkg.value?.review?.status ?? selected.value?.status);

const reviewStatus = (): string => pkg.value?.review?.status ?? selected.value?.status ?? '';

const pkgChecks = (): { total: number; failed: string[] } => autoChecksSummary(pkg.value?.review?.autoChecks);

// 04 §8.2：四项自动校验逐项展示（与 #128 approve 门禁一致）；lean 有值时附加。
const CHECK_LABELS: Array<{ key: string; label: string }> = [
  { key: 'schema', label: 'JSON Schema' },
  { key: 'katex', label: 'KaTeX 渲染' },
  { key: 'leakExhaustive', label: '穷举泄题' },
  { key: 'patternSelfTest', label: '规则/结构自测' },
];
const checkItems = (): Array<{ key: string; label: string; ok: boolean }> => {
  const checks = pkg.value?.review?.autoChecks;
  return CHECK_LABELS.map(({ key, label }) => ({ key, label, ok: checks?.[key] === true }));
};
const leanCheck = (): string | null => {
  const lean = pkg.value?.review?.autoChecks?.lean;
  return typeof lean === 'string' ? lean : null;
};
const previewTab = ref('L1');
const hasStudentPreview = (): boolean =>
  (pkg.value?.public.def?.task ?? '') !== '' ||
  (pkg.value?.public.frame?.task ?? '') !== '' ||
  pkg.value?.public.layers !== undefined;
const layerLabel = (layer: string): string => {
  const config = pkg.value?.public.layers?.[layer];
  if (config === undefined) return '未配置';
  return `${config.enabled === false ? '未启用' : '启用'}${config.skippable === true ? ' · 可跳过' : ' · 不可跳过'}`;
};

function openAction(decision: 'approve' | 'return'): void {
  actionDecision.value = decision;
  actionComments.value = '';
  actionMinutes.value = 10;
  actionError.value = '';
  actionVisible.value = true;
}

function openEdit(): void {
  if (pkg.value === null) return;
  editJson.value = JSON.stringify(pkg.value, null, 2);
  editError.value = '';
  editVisible.value = true;
}

async function submitEdit(): Promise<void> {
  if (selected.value === null || editing.value) return;
  editing.value = true;
  editError.value = '';
  try {
    const edited = JSON.parse(editJson.value) as Record<string, unknown>;
    const item = await api.post<ProblemItem>(
      `/api/v1/teacher/problems/${selected.value.problemId}/versions/${selected.value.version}/review`,
      { decision: 'edit', edited, comments: actionComments.value },
    );
    MessagePlugin.success(`已保存并发布新版本 v${item.version}`);
    editVisible.value = false;
    await load();
    await open(item);
  } catch (caught) {
    editError.value = caught instanceof ApiError ? caught.message : caught instanceof SyntaxError ? 'JSON 格式不合法' : '保存失败';
  } finally {
    editing.value = false;
  }
}

async function submitAction(): Promise<void> {
  if (selected.value === null || acting.value) return;
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
    <div class="page-sub">审核屏（04 §8）：看题目、四项自动校验与审核记录；支持通过 / 退回 / 编辑 JSON。</div>
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
      <template #actions="{ row }">
        <t-link theme="primary" @click.stop="open(row)">审核</t-link>
      </template>
      <template #empty><div class="empty">题库为空。导入流水线发布后会出现。</div></template>
    </t-table>

    <t-drawer :visible="selected !== null" size="720px" header="题目详情（含 secret，仅教师可见）" @close="close">
      <t-alert v-if="pkgError" theme="error" :message="pkgError" />
      <t-loading v-else-if="pkgLoading" />
      <div v-else-if="selected && pkg">
        <h3 style="margin-top: 0">{{ pkg.public.title ?? selected.title }} <span class="page-sub">v{{ pkg.version }}</span></h3>
        <div class="page-sub">{{ selected.problemId }} · {{ selected.chapter ?? '' }} · {{ pkg.kind === 'transfer' ? '迁移题' : '主题' }}</div>
        <div class="check-card">
          <div class="check-head">
            <b>自动校验</b>
            <t-tag v-if="pkgChecks().total === 0" variant="light">未提供</t-tag>
            <t-tag v-else :theme="pkgChecks().failed.length === 0 ? 'success' : 'danger'" variant="light">
              {{ pkgChecks().failed.length === 0 ? '全绿' : `失败 ${pkgChecks().failed.length}` }}
            </t-tag>
            <t-tag v-if="leanCheck()" variant="light">Lean: {{ leanCheck() }}</t-tag>
          </div>
          <div class="check-grid">
            <div v-for="item in checkItems()" :key="item.key" class="check-item">
              <span :class="item.ok ? 'check-ok' : 'check-bad'">{{ item.ok ? '✓' : '✗' }}</span>
              <span>{{ item.label }}</span>
            </div>
          </div>
          <div v-if="pkgChecks().total === 0" class="page-sub">auto_checks 为空：不能通过，只能退回或补跑 S8。</div>
          <div v-if="pkg.review?.reviewer || pkg.review?.reviewedAt || pkg.review?.comments" class="review-meta">
            <span v-if="pkg.review?.reviewer">审核人：{{ pkg.review.reviewer }}</span>
            <span v-if="pkg.review?.reviewedAt">时间：{{ new Date(pkg.review.reviewedAt).toLocaleString('zh-CN') }}</span>
            <span v-if="pkg.review?.comments">意见：{{ pkg.review.comments }}</span>
          </div>
        </div>
        <h4>题面</h4>
        <MathTextView :text="pkg.public.stem" />
        <h4>结构</h4>
        <div class="page-sub">关键步骤 {{ pkg.secret.keys?.length ?? 0 }} · 路线 {{ pkg.secret.routes?.length ?? 0 }}</div>
        <div v-if="canReview()" class="review-actions">
          <t-button theme="primary" @click="openAction('approve')">通过并发布</t-button>
          <t-button theme="danger" variant="outline" @click="openAction('return')">退回</t-button>
          <t-button variant="outline" @click="openEdit">编辑 JSON</t-button>
          <span class="page-sub">approve 要求四项自动校验全绿（S8 写入 auto_checks）</span>
        </div>
        <t-alert
          v-else
          :theme="reviewStatus() === 'published' ? 'success' : 'default'"
          :message="reviewStatus() === 'published' ? '该版本已发布，无需再审核。' : reviewStatus() === 'retired' ? '该版本已下线。' : '当前状态无需审核。'"
          style="margin-top: 12px"
        />
        <details v-if="hasStudentPreview()" style="margin-top: 12px">
          <summary>学生视角预览（L1 / L3 / 额度用完 / L6）</summary>
          <t-tabs v-model="previewTab" size="small" style="margin-top: 8px">
            <t-tab-panel value="L1" label="L1 定义">
              <div class="preview-block">
                <MathTextView v-if="pkg.public.def?.task" :text="pkg.public.def.task" />
                <span v-else class="page-sub">题目包未配置 L1 定义任务。</span>
              </div>
            </t-tab-panel>
            <t-tab-panel value="L3" label="L3 骨架">
              <div class="preview-block">
                <MathTextView v-if="pkg.public.frame?.task" :text="pkg.public.frame.task" />
                <MathTextView v-if="pkg.public.frame?.template" :text="pkg.public.frame.template" />
                <span v-if="!pkg.public.frame?.task" class="page-sub">题目包未配置 L3 骨架任务。</span>
              </div>
            </t-tab-panel>
            <t-tab-panel value="budget" label="额度用完">
              <div class="preview-block">
                <b>透露预算：{{ pkg.public.budget?.reveal ?? '—' }}</b>
                <span class="page-sub">学生看到的软着陆出口（09 §3）：回看定义 / 打开微课 / 标记老师 / 先做下一题。</span>
              </div>
            </t-tab-panel>
            <t-tab-panel value="L6" label="L6 总结">
              <div class="preview-block">
                <b>L6：{{ layerLabel('L6') }}</b>
                <span class="page-sub">学生提交总结后完成作答；总结缺失点会写入 summary_missing_points（导出可见）。</span>
              </div>
            </t-tab-panel>
          </t-tabs>
          <div class="page-sub">仅题目包 public 字段；完整学生视图（受层/预算/事件影响）由引擎在作答时投影。</div>
        </details>
        <details style="margin-top: 12px">
          <summary>原始题目包 JSON</summary>
          <pre class="pkg-json">{{ JSON.stringify(pkg, null, 2) }}</pre>
        </details>
      </div>
    </t-drawer>

    <t-dialog
      v-model:visible="actionVisible"
      :header="actionDecision === 'approve' ? '通过并发布' : '退回题目'"
      :footer="false"
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
      <div class="dialog-actions">
        <t-button variant="outline" :disabled="acting" @click="actionVisible = false">取消</t-button>
        <t-button theme="primary" :loading="acting" @click="submitAction">
          {{ actionDecision === 'approve' ? '确认通过并发布' : '确认退回' }}
        </t-button>
      </div>
      <div class="page-sub" v-if="actionDecision === 'approve'" style="margin-top: 8px">
        通过即发布到学生端，不可撤销；要求四项自动校验全绿。
      </div>
    </t-dialog>

    <t-dialog v-model:visible="editVisible" header="编辑题目包并发布新版本" width="820px" :footer="false">
      <t-alert v-if="editError" theme="error" :message="editError" style="margin-bottom: 8px" />
      <t-alert
        theme="warning"
        message="保存会重跑 S8；全绿则发布为新版本（v+1）并切 current_version，不覆盖原版本；参考证明未提供时沿用源版本。"
        style="margin-bottom: 8px"
      />
      <t-textarea v-model="editJson" :autosize="{ minRows: 16, maxRows: 28 }" style="font-family: monospace" />
      <div class="dialog-actions">
        <t-button variant="outline" :disabled="editing" @click="editVisible = false">取消</t-button>
        <t-button theme="primary" :loading="editing" @click="submitEdit">保存并发布</t-button>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.check-card {
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
}
.check-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px 12px;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.check-ok { color: var(--td-success-color, #2ba471); font-weight: 600; }
.check-bad { color: var(--td-error-color, #d54941); font-weight: 600; }
.review-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--td-text-color-secondary, #5e6670);
}
.preview-block {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--td-bg-color-container-hover, #f7f8fa);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
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
