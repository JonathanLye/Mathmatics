<script setup lang="ts">
// 反馈收件箱（15 号文档 §9，仅 admin）：看学生反馈、分类、回复、确认复现（发「捉虫小能手」勋章）、结单。
// 学生端传来的上下文不可信：下面全部用 {{ }} 当纯文本渲染，不用 v-html。
import { computed, onMounted, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import type { FeedbackCategory, FeedbackCloseReason, FeedbackInboxDetail, FeedbackInboxItem, FeedbackStatus } from '../api/types.ts';
import {
  AREA_OPTIONS,
  CATEGORY_OPTIONS,
  CLOSE_REASON_OPTIONS,
  PAGE_SIZE,
  STATUS_ORDER,
  areaLabel,
  breadcrumbLines,
  buildInboxQuery,
  categoryLabel,
  closeReasonLabel,
  confirmBlockedReason,
  contextRows,
  errorLines,
  feedbackErrorMessage,
  kindLabel,
  statusLabel,
  statusTheme,
  validateStatusChange,
} from '../utils/feedback.ts';
import { drawerSize } from '../utils/viewport.ts';

const items = ref<FeedbackInboxItem[]>([]);
const total = ref(0);
const counts = ref<Record<string, number>>({});
const statusFilter = ref<string>('new');
const categoryFilter = ref('');
const areaFilter = ref('');
const keyword = ref('');
const unreadOnly = ref(false);
const page = ref(1);
const loading = ref(false);
const error = ref('');

const detail = ref<FeedbackInboxDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const reply = ref('');
const busy = ref(false);
const actionError = ref('');
const closeVisible = ref(false);
const closeReason = ref<FeedbackCloseReason>('fixed');
const closeNote = ref('');

const columns = [
  { colKey: 'ref', title: '编号', width: 80 },
  { colKey: 'preview', title: '内容', minWidth: 260 },
  { colKey: 'category', title: '分类', width: 100 },
  { colKey: 'area', title: '区域', width: 90 },
  { colKey: 'status', title: '状态', width: 90 },
  { colKey: 'who', title: '学生', width: 150 },
  { colKey: 'last', title: '最近动静', width: 150 },
];

const statusTabs = computed(() => [
  ...STATUS_ORDER.map((value) => ({ value, label: `${statusLabel(value)} ${counts.value[value] ?? 0}` })),
  { value: '', label: '全部' },
]);

const pagination = computed(() => ({ current: page.value, pageSize: PAGE_SIZE, total: total.value, showJumper: false, showPageSize: false }));

// 快速切换筛选时只认最后一次请求，避免慢响应覆盖新结果。
let loadSeq = 0;
async function load(): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const query = buildInboxQuery({
      status: statusFilter.value,
      category: categoryFilter.value,
      area: areaFilter.value,
      unread: unreadOnly.value,
      q: keyword.value,
      offset: (page.value - 1) * PAGE_SIZE,
    });
    const data = await api.get<{ items: FeedbackInboxItem[]; total: number; counts: Record<string, number> }>(`/api/v1/teacher/feedback?${query}`);
    if (seq !== loadSeq) return;
    items.value = data.items;
    total.value = data.total;
    counts.value = data.counts;
  } catch (caught) {
    if (seq === loadSeq) error.value = caught instanceof ApiError ? caught.message : '加载反馈失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function refilter(): void {
  page.value = 1;
  void load();
}

function resetFilters(): void {
  statusFilter.value = 'new';
  categoryFilter.value = '';
  areaFilter.value = '';
  keyword.value = '';
  unreadOnly.value = false;
  refilter();
}

function onPage(ctx: { current: number }): void {
  page.value = ctx.current;
  void load();
}

async function open(item: { id: string }): Promise<void> {
  detail.value = null;
  detailError.value = '';
  actionError.value = '';
  reply.value = '';
  detailLoading.value = true;
  try {
    detail.value = await api.get<FeedbackInboxDetail>(`/api/v1/teacher/feedback/${item.id}`);
    // 打开即已读：列表里这行的加粗同步去掉
    items.value = items.value.map((row) => (row.id === item.id ? { ...row, devUnread: false } : row));
  } catch (caught) {
    detailError.value = caught instanceof ApiError ? caught.message : '加载详情失败';
  } finally {
    detailLoading.value = false;
  }
}

function closeDrawer(): void {
  detail.value = null;
  detailError.value = '';
  void load();
}

// 动作失败时把原因放在抽屉里，内容不丢。
async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    await action();
  } catch (caught) {
    actionError.value = caught instanceof ApiError ? feedbackErrorMessage(caught.code, caught.message) : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

async function sendReply(setStatus?: 'need_info' | 'resolved'): Promise<void> {
  const current = detail.value;
  if (!current) return;
  const body = reply.value.trim();
  if (body === '') {
    actionError.value = '请先写回复内容';
    return;
  }
  await run(async () => {
    detail.value = await api.post<FeedbackInboxDetail>(`/api/v1/teacher/feedback/${current.id}/messages`, { body, ...(setStatus ? { setStatus } : {}) });
    reply.value = '';
    MessagePlugin.success(setStatus === 'resolved' ? '已回复并标记为已解决' : setStatus === 'need_info' ? '已回复，等学生补充' : '已回复');
  });
}

async function patch(body: { category?: FeedbackCategory; area?: string; status?: FeedbackStatus; closeReason?: FeedbackCloseReason; note?: string }): Promise<void> {
  const current = detail.value;
  if (!current) return;
  await run(async () => {
    detail.value = await api.patch<FeedbackInboxDetail>(`/api/v1/teacher/feedback/${current.id}`, body);
  });
}

function changeCategory(value: unknown): void {
  void patch({ category: value as FeedbackCategory });
}
function changeArea(value: unknown): void {
  void patch({ area: String(value) });
}
function changeStatus(value: unknown): void {
  const status = value as FeedbackStatus;
  if (status === 'resolved' || status === 'closed') {
    // 这两个状态要写说明（学生会看到），先弹表单
    closeReason.value = 'fixed';
    closeNote.value = reply.value.trim();
    pendingStatus.value = status;
    closeVisible.value = true;
    return;
  }
  void patch({ status });
}

const pendingStatus = ref<FeedbackStatus>('closed');
async function submitClose(): Promise<void> {
  const reason = pendingStatus.value === 'closed' ? closeReason.value : undefined;
  const problem = validateStatusChange({ status: pendingStatus.value, closeReason: reason, note: closeNote.value });
  if (problem) {
    actionError.value = problem;
    return;
  }
  await patch({ status: pendingStatus.value, ...(reason ? { closeReason: reason } : {}), note: closeNote.value.trim() });
  if (!actionError.value) {
    closeVisible.value = false;
    reply.value = '';
    MessagePlugin.success(pendingStatus.value === 'resolved' ? '已标记为已解决' : '已关闭');
  }
}

const confirmBlocked = computed(() => (detail.value ? confirmBlockedReason({ category: detail.value.category, confirmed: detail.value.confirmed }) : null));

async function confirmBug(): Promise<void> {
  const current = detail.value;
  if (!current || confirmBlocked.value) return;
  await run(async () => {
    const note = reply.value.trim();
    const result = await api.post<{ confirmed: boolean; badgeGranted: boolean }>(`/api/v1/teacher/feedback/${current.id}/confirm`, note ? { note } : undefined);
    detail.value = await api.get<FeedbackInboxDetail>(`/api/v1/teacher/feedback/${current.id}`);
    reply.value = '';
    MessagePlugin.success(result.badgeGranted ? '已确认复现，已给学生发「捉虫小能手」勋章' : '已确认复现（这位学生已有勋章）');
  });
}

const rows = computed(() => contextRows(detail.value?.context));
const crumbs = computed(() => breadcrumbLines(detail.value?.context));
const errs = computed(() => errorLines(detail.value?.context));
const closeFormError = computed(() => (closeVisible.value ? actionError.value : ''));

function timeText(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <h1>反馈</h1>
      <t-button size="small" variant="outline" :loading="loading" data-testid="fb-refresh" @click="load()">刷新</t-button>
    </div>
    <div class="page-sub">学生在小方里提交的问题和想法。分类、回复、结单都在这里；对「功能故障」或「显示异常」点确认复现，学生会收到红色勋章。</div>
    <t-alert v-if="error" theme="error" :message="error" style="margin: 12px 0" />

    <t-radio-group v-model="statusFilter" variant="default-filled" class="fb-tabs" data-testid="fb-tabs" @change="refilter">
      <t-radio-button v-for="tab in statusTabs" :key="tab.value" :value="tab.value">{{ tab.label }}</t-radio-button>
    </t-radio-group>

    <div class="fb-filters">
      <t-select v-model="categoryFilter" :options="[{ label: '全部分类', value: '' }, ...CATEGORY_OPTIONS]" style="width: 130px" aria-label="分类" @change="refilter" />
      <t-select v-model="areaFilter" :options="[{ label: '全部区域', value: '' }, ...AREA_OPTIONS]" style="width: 130px" aria-label="区域" @change="refilter" />
      <t-input v-model="keyword" placeholder="搜索反馈内容" clearable style="width: 220px" aria-label="搜索反馈" @enter="refilter" @clear="refilter" />
      <t-checkbox v-model="unreadOnly" @change="refilter">只看未读</t-checkbox>
      <t-button size="small" theme="primary" @click="refilter">查询</t-button>
      <t-button size="small" variant="outline" @click="resetFilters">重置</t-button>
    </div>

    <t-table
      class="fb-table"
      :data="items"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :pagination="total > PAGE_SIZE ? pagination : undefined"
      :row-class-name="({ row }: { row: FeedbackInboxItem }) => (row.devUnread ? 'is-unread-row' : '')"
      size="small"
      hover
      data-testid="fb-table"
      @row-click="(ctx: { row: FeedbackInboxItem }) => open(ctx.row)"
      @page-change="onPage"
    >
      <template #ref="{ row }">#{{ String(row.refNo).padStart(4, '0') }}</template>
      <template #preview="{ row }">
        <div class="fb-preview">
          <span v-if="row.devUnread" class="fb-dot" aria-label="未读" />
          <span>{{ row.preview }}</span>
        </div>
        <div class="page-sub fb-kind">{{ kindLabel(row.kind) }}<template v-if="row.confirmed"> · 已确认复现</template></div>
      </template>
      <template #category="{ row }">{{ categoryLabel(row.category) }}</template>
      <template #area="{ row }">{{ areaLabel(row.area) }}</template>
      <template #status="{ row }"><t-tag :theme="statusTheme(row.status)" variant="light">{{ statusLabel(row.status) }}</t-tag></template>
      <template #who="{ row }">{{ row.anonCode }}<div class="page-sub fb-kind">{{ row.className ?? '' }}</div></template>
      <template #last="{ row }">{{ timeText(row.lastActivityAt) }}</template>
      <template #empty><div class="fb-empty" data-testid="fb-empty">这里还没有反馈。同学们点「小方」写下的话会出现在这里。</div></template>
    </t-table>

    <t-drawer :footer="false" :visible="detail !== null || detailLoading || detailError !== ''" :size="drawerSize" :header="detail ? `反馈 #${String(detail.refNo).padStart(4, '0')}` : '反馈'" data-testid="fb-drawer" @close="closeDrawer">
      <t-alert v-if="detailError" theme="error" :message="detailError" />
      <t-loading v-else-if="detailLoading" />
      <div v-else-if="detail" class="fb-detail">
        <div class="fb-chips">
          <t-tag :theme="statusTheme(detail.status)" variant="light" data-testid="fb-status">{{ statusLabel(detail.status) }}</t-tag>
          <t-tag variant="outline">{{ kindLabel(detail.kind) }}</t-tag>
          <t-tag v-if="detail.confirmed" theme="danger" variant="light" data-testid="fb-confirmed">已确认复现</t-tag>
          <t-tag v-if="detail.closeReason" variant="outline">{{ closeReasonLabel(detail.closeReason) }}</t-tag>
          <span class="page-sub">{{ detail.anonCode }}<template v-if="detail.classNames?.length"> · {{ detail.classNames.join('、') }}</template></span>
        </div>
        <t-alert v-if="actionError && !closeVisible" theme="error" :message="actionError" style="margin: 8px 0" data-testid="fb-action-error" />

        <div class="fb-grid">
          <section class="fb-thread" data-testid="fb-thread">
            <div v-for="m in detail.messages" :key="m.id" class="fb-msg" :class="m.from === 'dev' ? 'fb-msg--dev' : 'fb-msg--student'" :data-from="m.from">
              <div class="fb-who">{{ m.from === 'dev' ? '开发者' : '学生' }} · {{ timeText(m.createdAt) }}</div>
              <div class="fb-body">{{ m.body }}</div>
            </div>

            <t-textarea v-model="reply" :autosize="{ minRows: 3, maxRows: 8 }" :maxlength="2000" placeholder="回复学生（学生在信箱里看到）" data-testid="fb-reply" />
            <div class="fb-actions">
              <t-button size="small" theme="primary" :loading="busy" data-testid="fb-send" @click="sendReply()">回复</t-button>
              <t-button size="small" variant="outline" :disabled="busy" data-testid="fb-need-info" @click="sendReply('need_info')">想问问你</t-button>
              <t-button size="small" variant="outline" :disabled="busy" data-testid="fb-resolve" @click="sendReply('resolved')">回复并解决</t-button>
              <t-tooltip :content="confirmBlocked ?? '给学生发红色勋章「捉虫小能手」'">
                <t-button size="small" theme="danger" variant="outline" :disabled="busy || confirmBlocked !== null" data-testid="fb-confirm" @click="confirmBug">确认复现并发勋章</t-button>
              </t-tooltip>
            </div>
          </section>

          <aside class="fb-side">
            <h4>分类</h4>
            <t-select :value="detail.category ?? undefined" :options="CATEGORY_OPTIONS" placeholder="未分类" aria-label="分类" data-testid="fb-category" @change="changeCategory" />
            <h4>区域</h4>
            <t-select :value="detail.area ?? undefined" :options="AREA_OPTIONS" placeholder="未设置" aria-label="区域" @change="changeArea" />
            <h4>状态</h4>
            <t-select
              :value="detail.status"
              :options="STATUS_ORDER.map((value) => ({ label: statusLabel(value), value }))"
              aria-label="状态"
              data-testid="fb-status-select"
              @change="changeStatus"
            />

            <h4>自动带上的信息</h4>
            <dl v-if="rows.length" class="fb-ctx" data-testid="fb-context">
              <template v-for="row in rows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template>
            </dl>
            <div v-else class="page-sub">学生没有带上额外信息。</div>

            <template v-if="errs.length">
              <h4>最近的错误</h4>
              <pre class="fb-pre" data-testid="fb-errors">{{ errs.join('\n') }}</pre>
            </template>
            <template v-if="crumbs.length">
              <h4>最近的操作</h4>
              <pre class="fb-pre" data-testid="fb-crumbs">{{ crumbs.join('\n') }}</pre>
            </template>
          </aside>
        </div>
      </div>
    </t-drawer>

    <t-dialog v-model:visible="closeVisible" :header="pendingStatus === 'resolved' ? '标记为已解决' : '关闭这条反馈'" :footer="false" width="min(480px, 96vw)">
      <t-alert v-if="closeFormError" theme="error" :message="closeFormError" style="margin-bottom: 8px" data-testid="fb-close-error" />
      <t-form label-width="70px">
        <t-form-item v-if="pendingStatus === 'closed'" label="原因">
          <t-select v-model="closeReason" :options="CLOSE_REASON_OPTIONS" data-testid="fb-close-reason" />
        </t-form-item>
        <t-form-item label="说明">
          <t-textarea v-model="closeNote" :autosize="{ minRows: 3, maxRows: 6 }" :maxlength="2000" placeholder="写给学生的话，他们会在信箱里看到" data-testid="fb-close-note" />
        </t-form-item>
        <t-form-item>
          <t-button theme="primary" :loading="busy" data-testid="fb-close-submit" @click="submitClose">确定</t-button>
          <t-button variant="outline" style="margin-left: 8px" @click="closeVisible = false">取消</t-button>
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.fb-tabs { margin: 8px 0 4px; max-width: 100%; overflow-x: auto; }
.fb-filters { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; flex-wrap: wrap; }
.fb-preview { display: flex; align-items: flex-start; gap: 6px; font-weight: 600; line-height: 1.45; }
.fb-kind { margin: 2px 0 0; }
.fb-dot { flex: none; width: 8px; height: 8px; margin-top: 7px; border-radius: 50%; background: var(--bee, #ffc233); }
.fb-empty { padding: 28px 0; color: var(--ink-2); }
:deep(.is-unread-row td) { font-weight: 700; }
.fb-detail { min-width: 0; }
.fb-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.fb-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; margin-top: 12px; }
@media (max-width: 820px) { .fb-grid { grid-template-columns: minmax(0, 1fr); } }
.fb-thread { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.fb-msg { padding: 10px 12px; border: 2px solid var(--rule, #e5e5e5); border-radius: 12px; }
.fb-msg--student { background: var(--accent-soft, #e6f7f3); border-color: var(--accent, #14b8a6); }
.fb-msg--dev { background: var(--sea-soft, #e3eeff); border-color: var(--sea, #4c8dff); }
.fb-who { color: var(--ink-2); font-size: 12px; font-weight: 700; }
.fb-body { margin-top: 4px; white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
.fb-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.fb-side h4 { margin: 14px 0 6px; font-size: 13px; color: var(--ink-2); }
.fb-side h4:first-child { margin-top: 0; }
.fb-ctx { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
.fb-ctx dt { color: var(--ink-2); }
.fb-ctx dd { margin: 0; word-break: break-all; }
.fb-pre { max-height: 220px; margin: 0; padding: 8px 10px; overflow: auto; border-radius: 8px; background: var(--paper-2, #f5f5f5); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
</style>
