<script setup lang="ts">
import { drawerSize } from '../utils/viewport.ts';
import { onMounted, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { api, ApiError } from '../api/client.ts';
import MathTextView from '../components/MathTextView.vue';
import { layerName } from '../utils/layers.ts';
import { PAGE_SIZE, autoChecksSummary, buildListQuery, canReviewStatus, sourceLabel, statusLabel, statusTheme } from '../utils/problems.ts';
import type { ProblemListItem } from '../api/types.ts';

type ProblemItem = ProblemListItem;

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
const statusFilter = ref<string>('');
const sourceFilter = ref<string>('');
const keyword = ref('');
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref('');
const hiding = ref<string | null>(null);
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
  { colKey: 'title', title: '题目', minWidth: 220 },
  { colKey: 'chapter', title: '章节' },
  { colKey: 'kind', title: '类型', width: 80 },
  { colKey: 'version', title: '版本', width: 70 },
  { colKey: 'status', title: '审核状态', width: 100 },
  { colKey: 'source', title: '来源', width: 120 },
  { colKey: 'reviewed', title: '最近审核' },
  { colKey: 'checks', title: '自动校验', width: 100 },
  { colKey: 'actions', title: '操作', width: 150 },
];

// 快速切换筛选时只认最后一次请求，避免慢响应覆盖新结果。
let loadSeq = 0;

// reset=true：按当前筛选从头加载；false：接着上一页往下加载
async function load(reset = true): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const query = buildListQuery({
      status: statusFilter.value,
      reviewSource: sourceFilter.value,
      q: keyword.value,
      cursor: reset ? null : nextCursor.value,
      limit: PAGE_SIZE,
    });
    const page = await api.getPage<ProblemItem[]>(`/api/v1/teacher/problems?${query}`);
    if (seq !== loadSeq) return;
    items.value = reset ? page.data : [...items.value, ...page.data];
    nextCursor.value = page.nextCursor;
  } catch (caught) {
    if (seq === loadSeq) error.value = caught instanceof ApiError ? caught.message : '加载题库失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function resetFilters(): void {
  statusFilter.value = '';
  sourceFilter.value = '';
  keyword.value = '';
  void load();
}

// 下架 / 恢复上架：只改这道题是否出现在学生的路径和练习区，不动题目内容、已有作答和已布置的任务。
async function setHidden(item: ProblemItem, hidden: boolean): Promise<void> {
  if (hiding.value !== null) return;
  hiding.value = item.problemId;
  try {
    const result = await api.patch<{ problemId: string; hiddenAt: string | null }>(
      `/api/v1/teacher/problems/${encodeURIComponent(item.problemId)}/visibility`,
      { hidden },
    );
    // 同一道题可能有多个版本行，一起更新
    items.value = items.value.map((row) => {
      if (row.problemId !== item.problemId) return row;
      const { hiddenAt: _drop, ...rest } = row;
      return result.hiddenAt === null ? rest : { ...rest, hiddenAt: result.hiddenAt };
    });
    if (selected.value?.problemId === item.problemId) {
      const { hiddenAt: _drop, ...rest } = selected.value;
      selected.value = result.hiddenAt === null ? rest : { ...rest, hiddenAt: result.hiddenAt };
    }
    MessagePlugin.success(hidden ? '已下架：学生的路径和练习区里不再出现这道题' : '已恢复上架');
  } catch (caught) {
    MessagePlugin.error(caught instanceof ApiError ? caught.message : '操作失败，请重试');
  } finally {
    hiding.value = null;
  }
}

async function open(item: ProblemItem): Promise<void> {
  selected.value = item;
  pkg.value = null;
  previewTab.value = 'L1';
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

// 四项自动校验逐项展示，必须全过才能通过审核；有形式化验证结果时附加显示。
const CHECK_LABELS: Array<{ key: string; label: string }> = [
  { key: 'schema', label: '题目格式完整' },
  { key: 'katex', label: '公式都能渲染' },
  { key: 'leakExhaustive', label: '提示不会泄露答案' },
  { key: 'patternSelfTest', label: '识别规则自测通过' },
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
    MessagePlugin.success(`已保存并发布为第 ${item.version} 版`);
    editVisible.value = false;
    await load();
    await open(item);
  } catch (caught) {
    editError.value = caught instanceof ApiError ? caught.message : caught instanceof SyntaxError ? '内容不是合法的 JSON，请检查括号和引号' : '保存失败';
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

onMounted(() => void load());
</script>

<template>
  <div>
    <div class="page-head">
      <h1>题库</h1>
      <t-button size="small" variant="outline" :loading="loading" @click="load()">刷新</t-button>
    </div>
    <div class="page-sub">看题目、自动校验和审核记录，可以通过、退回或修改；也可以把不合适的题下架，学生就不会再看到它。</div>
    <t-alert v-if="error" theme="error" :message="error" style="margin: 12px 0" />

    <div class="problem-filters">
      <t-select
        v-model="statusFilter"
        :options="[
          { label: '全部状态', value: '' },
          { label: '草稿', value: 'draft' },
          { label: '待审核', value: 'pending' },
          { label: '已退回', value: 'returned' },
          { label: '已发布', value: 'published' },
          { label: '已停用', value: 'retired' },
        ]"
        style="width: 130px"
        aria-label="审核状态"
        @change="load()"
      />
      <t-select
        v-model="sourceFilter"
        :options="[
          { label: '全部来源', value: '' },
          { label: '老师审核', value: 'teacher' },
          { label: 'AI 整理', value: 'auto' },
        ]"
        style="width: 130px"
        aria-label="来源"
        data-testid="source-filter"
        @change="load()"
      />
      <t-input v-model="keyword" placeholder="搜索题名、章节或题号" clearable style="width: 240px" aria-label="搜索题目" @enter="load()" @clear="load()" />
      <t-button size="small" theme="primary" @click="load()">查询</t-button>
      <t-button size="small" variant="outline" @click="resetFilters">重置</t-button>
      <span class="page-sub problem-count" data-testid="problem-count">已显示 {{ items.length }} 道题{{ nextCursor !== null ? '，还有更多' : '' }}</span>
    </div>

    <t-table
      class="problem-table"
      :data="items"
      :columns="columns"
      :row-key="(row: ProblemItem) => `${row.problemId}@${row.version}`"
      :loading="loading"
      :row-class-name="({ row }: { row: ProblemItem }) => (row.hiddenAt ? 'is-hidden-row' : '')"
      size="small"
      hover
      @row-click="(ctx: { row: ProblemItem }) => open(ctx.row)"
    >
      <template #title="{ row }">
        <div class="problem-title"><MathTextView :text="row.title" /></div>
        <div class="page-sub problem-id">{{ row.problemId }}</div>
      </template>
      <template #kind="{ row }">{{ row.kind === 'transfer' ? '迁移题' : '主题' }}</template>
      <template #version="{ row }">第 {{ row.version }} 版</template>
      <template #status="{ row }">
        <t-tag :theme="statusTheme(row.status)" variant="light">{{ statusLabel(row.status) }}</t-tag>
        <t-tag v-if="row.hiddenAt" theme="default" variant="outline" class="hidden-tag" data-testid="hidden-tag">已下架</t-tag>
      </template>
      <template #source="{ row }">
        <span class="pg-pill" :class="row.reviewSource === 'auto' ? 'pg-pill--sea' : 'pg-pill--accent'" data-testid="source-badge">{{ sourceLabel(row.reviewSource) }}</span>
      </template>
      <template #reviewed="{ row }">
        <div v-if="row.reviewedBy" class="page-sub reviewed">
          {{ row.reviewedBy }}<br />
          <span v-if="row.reviewedAt">{{ new Date(row.reviewedAt).toLocaleString('zh-CN') }}</span>
        </div>
        <span v-else>—</span>
      </template>
      <template #checks="{ row }">
        <t-tag v-if="autoChecksSummary(row.autoChecks).total === 0" variant="light">没有记录</t-tag>
        <t-tag
          v-else
          :theme="autoChecksSummary(row.autoChecks).failed.length === 0 ? 'success' : 'danger'"
          variant="light"
        >
          {{ autoChecksSummary(row.autoChecks).failed.length === 0 ? '全部通过' : `${autoChecksSummary(row.autoChecks).failed.length} 项未过` }}
        </t-tag>
      </template>
      <template #actions="{ row }">
        <t-space size="small">
          <t-link theme="primary" @click.stop="open(row)">审核</t-link>
          <t-popconfirm
            v-if="!row.hiddenAt"
            content="下架后，这道题不会再出现在学生的路径和练习区；已经布置的任务和学生已有的作答不受影响。确定下架？"
            @confirm="setHidden(row, true)"
          >
            <t-link theme="danger" :disabled="hiding !== null" data-testid="hide-problem" @click.stop>下架</t-link>
          </t-popconfirm>
          <t-link v-else theme="primary" :disabled="hiding !== null" data-testid="unhide-problem" @click.stop="setHidden(row, false)">恢复上架</t-link>
        </t-space>
      </template>
      <template #empty><div class="empty">{{ keyword || statusFilter || sourceFilter ? '没有符合条件的题目，换个条件试试。' : '题库还是空的。题目导入并通过审核后会出现在这里。' }}</div></template>
    </t-table>
    <div v-if="nextCursor !== null" class="problem-more">
      <t-button variant="outline" :loading="loading" data-testid="load-more-problems" @click="load(false)">加载更多</t-button>
    </div>

    <t-drawer :footer="false" :visible="selected !== null" :size="drawerSize" header="题目详情（含参考答案信息，仅老师可见）" @close="close">
      <t-alert v-if="pkgError" theme="error" :message="pkgError" />
      <t-loading v-else-if="pkgLoading" />
      <div v-else-if="selected && pkg">
        <h3 style="margin-top: 0">{{ pkg.public.title ?? selected.title }} <span class="page-sub">第 {{ pkg.version }} 版</span></h3>
        <div class="page-sub">{{ selected.problemId }} · {{ selected.chapter ?? '' }} · {{ pkg.kind === 'transfer' ? '迁移题' : '主题' }} · {{ sourceLabel(selected.reviewSource) }}<template v-if="selected.hiddenAt"> · 已下架</template></div>
        <div class="takedown">
          <t-popconfirm
            v-if="!selected.hiddenAt"
            content="下架后，这道题不会再出现在学生的路径和练习区；已经布置的任务和学生已有的作答不受影响。确定下架？"
            @confirm="setHidden(selected, true)"
          >
            <t-button size="small" theme="danger" variant="outline" :disabled="hiding !== null">下架这道题</t-button>
          </t-popconfirm>
          <t-button v-else size="small" variant="outline" :disabled="hiding !== null" @click="setHidden(selected, false)">恢复上架</t-button>
        </div>
        <div class="check-card">
          <div class="check-head">
            <b>自动校验</b>
            <t-tag v-if="pkgChecks().total === 0" variant="light">没有记录</t-tag>
            <t-tag v-else :theme="pkgChecks().failed.length === 0 ? 'success' : 'danger'" variant="light">
              {{ pkgChecks().failed.length === 0 ? '全部通过' : `${pkgChecks().failed.length} 项未过` }}
            </t-tag>
            <t-tag v-if="leanCheck()" variant="light">形式化验证：{{ leanCheck() }}</t-tag>
          </div>
          <div class="check-grid">
            <div v-for="item in checkItems()" :key="item.key" class="check-item">
              <span :class="item.ok ? 'check-ok' : 'check-bad'">{{ item.ok ? '✓' : '✗' }}</span>
              <span>{{ item.label }}</span>
            </div>
          </div>
          <div v-if="pkgChecks().total === 0" class="page-sub">还没有自动校验记录，这样的题不能通过审核，只能退回。</div>
          <div v-if="pkg.review?.reviewer || pkg.review?.reviewedAt || pkg.review?.comments" class="review-meta">
            <span v-if="pkg.review?.reviewer">审核人：{{ pkg.review.reviewer }}</span>
            <span v-if="pkg.review?.reviewedAt">时间：{{ new Date(pkg.review.reviewedAt).toLocaleString('zh-CN') }}</span>
            <span v-if="pkg.review?.comments">意见：{{ pkg.review.comments }}</span>
          </div>
        </div>
        <h4>题面</h4>
        <MathTextView :text="pkg.public.stem" />
        <h4>证明结构</h4>
        <div class="page-sub">关键步骤 {{ pkg.secret.keys?.length ?? 0 }} 个 · 证明思路 {{ pkg.secret.routes?.length ?? 0 }} 条</div>
        <div v-if="canReview()" class="review-actions">
          <t-button theme="primary" @click="openAction('approve')">通过并发布</t-button>
          <t-button theme="danger" variant="outline" @click="openAction('return')">退回</t-button>
          <t-button variant="outline" @click="openEdit">编辑题目数据</t-button>
          <span class="page-sub">四项自动校验全部通过才能通过审核</span>
        </div>
        <t-alert
          v-else
          :theme="reviewStatus() === 'published' ? 'success' : 'default'"
          :message="reviewStatus() === 'published' ? '该版本已发布，无需再审核。' : reviewStatus() === 'retired' ? '该版本已停用。' : '当前状态无需审核。'"
          style="margin-top: 12px"
        />
        <details v-if="hasStudentPreview()" style="margin-top: 12px">
          <summary>学生视角预览（回忆定义 / 写证明 / 提示额度用完 / 总结）</summary>
          <t-tabs v-model="previewTab" size="small" style="margin-top: 8px">
            <t-tab-panel value="L1" label="回忆定义">
              <div class="preview-block">
                <MathTextView v-if="pkg.public.def?.task" :text="pkg.public.def.task" />
                <span v-else class="page-sub">这道题没有设置“回忆定义”这一步的任务。</span>
              </div>
            </t-tab-panel>
            <t-tab-panel value="L3" label="写证明">
              <div class="preview-block">
                <b>{{ layerName('L3') }}：{{ layerLabel('L3') }}</b>
                <MathTextView v-if="pkg.public.stem" :text="pkg.public.stem" />
                <template v-if="pkg.public.frame?.task">
                  <span class="page-sub">搭骨架（学生开始写证明前已完成）：</span>
                  <MathTextView :text="pkg.public.frame.task" />
                  <MathTextView v-if="pkg.public.frame.template" :text="pkg.public.frame.template" />
                </template>
                <span class="page-sub">写到一半的状态要按学生的作答一步步推演，这里不模拟。</span>
              </div>
            </t-tab-panel>
            <t-tab-panel value="budget" label="提示额度用完">
              <div class="preview-block">
                <b>提示额度上限（题目设置）：{{ pkg.public.budget?.reveal ?? '—' }}</b>
                <span class="page-sub">额度用完后，学生可以回到定义、看讲解、先做下一题，或者点“求助老师”。</span>
              </div>
            </t-tab-panel>
            <t-tab-panel value="L6" label="总结">
              <div class="preview-block">
                <b>{{ layerName('L6') }}：{{ layerLabel('L6') }}</b>
                <span class="page-sub">学生提交总结后完成作答；总结里漏掉的要点会记录下来，导出时可以看到。</span>
              </div>
            </t-tab-panel>
          </t-tabs>
          <div class="page-sub">这里只显示学生本来就能看到的题面内容；学生实际看到的界面还会随作答进度和提示额度变化。</div>
        </details>
        <details style="margin-top: 12px">
          <summary>题目数据（JSON，含参考答案信息）</summary>
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
          <t-textarea v-model="actionComments" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="给导入同学的说明（可不填）" />
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
        通过后立即发布给学生，不能撤回（之后只能下架）；四项自动校验必须全部通过。
      </div>
    </t-dialog>

    <t-dialog v-model:visible="editVisible" header="编辑题目数据并发布新版本" width="min(820px, 96vw)" :footer="false">
      <t-alert v-if="editError" theme="error" :message="editError" style="margin-bottom: 8px" />
      <t-alert
        theme="warning"
        message="保存时会重新做一遍自动校验；全部通过就发布为新的一版，原来的版本不会被覆盖；没有提供参考证明时沿用原来的。"
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
.problem-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 12px;
  flex-wrap: wrap;
}
.problem-count { margin: 0 0 0 4px; }
.problem-title { font-weight: 600; line-height: 1.4; }
.problem-id { margin: 0; font-size: 12px; font-family: var(--font-mono); color: var(--pg-ink-3); }
.reviewed { margin: 0; font-size: 12px; }
.hidden-tag { margin-left: 6px; }
.problem-more { display: flex; justify-content: center; margin: 14px 0 4px; }
.takedown { margin: 10px 0 4px; }
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.check-card {
  border: 1px solid var(--pg-border);
  border-radius: var(--pg-radius);
  padding: 10px 12px;
  margin: 8px 0;
}
.check-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 6px 12px;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.check-ok { color: var(--pg-grass-text); font-weight: 700; }
.check-bad { color: var(--pg-chili-text); font-weight: 700; }
.review-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--pg-ink-2);
}
.preview-block {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--pg-soft);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.pkg-json {
  max-height: 360px;
  overflow: auto;
  background: var(--pg-soft);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
}
:deep(.is-hidden-row td) { color: var(--pg-ink-3); }
</style>
