<script setup lang="ts">
/**
 * 选题下拉：题库会有几百道题，所以不一次拉全部，而是边输边搜、分页加载。
 * 只列“已发布、未下架的主题”；选中的那一项的名字会记下来，翻页或换关键词后也不会变成一串编号。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { fetchProblemPage, problemKey, problemLabel, type ProblemRow } from '../utils/problemSearch.ts';

const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void; (e: 'select', value: ProblemRow | null): void }>();

const rows = ref<ProblemRow[]>([]);
const picked = ref<ProblemRow | null>(null);
const keyword = ref('');
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref('');
const loaded = ref(false);
let seq = 0;
let timer: number | undefined;

// 选中项一直放在选项里，即使它不在当前这一页
const options = computed(() => {
  const list = [...rows.value];
  if (picked.value !== null && !list.some((item) => problemKey(item) === problemKey(picked.value as ProblemRow))) list.unshift(picked.value);
  return list.map((item) => ({ label: problemLabel(item), value: problemKey(item) }));
});

async function load(append: boolean): Promise<void> {
  const mine = ++seq; // 只认最后一次请求，慢的旧响应不会盖掉新结果
  loading.value = true;
  error.value = '';
  try {
    const page = await fetchProblemPage({ q: keyword.value, cursor: append ? nextCursor.value : null });
    if (mine !== seq) return;
    rows.value = append ? [...rows.value, ...page.items] : page.items;
    nextCursor.value = page.nextCursor;
    loaded.value = true;
  } catch (caught) {
    if (mine !== seq) return;
    error.value = caught instanceof Error ? caught.message : '题目加载失败';
  } finally {
    if (mine === seq) loading.value = false;
  }
}

function onSearch(words: string): void {
  keyword.value = words.trim();
  if (timer !== undefined) clearTimeout(timer);
  timer = window.setTimeout(() => void load(false), 300);
}

function onVisible(visible: boolean): void {
  if (visible && !loaded.value) void load(false);
}

function onChange(value: unknown): void {
  const key = typeof value === 'string' ? value : '';
  const found = [...rows.value, ...(picked.value === null ? [] : [picked.value])].find((item) => problemKey(item) === key) ?? null;
  picked.value = found;
  emit('update:modelValue', key);
  emit('select', found);
}

watch(
  () => props.modelValue,
  (value) => {
    if (value === '') picked.value = null;
  },
);

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
  <t-select
    :model-value="modelValue"
    class="problem-select"
    placeholder="选择已发布的题目版本"
    filterable
    clearable
    :disabled="disabled"
    :loading="loading"
    :options="options"
    :filter="() => true"
    :popup-props="{ overlayClassName: 'problem-select__popup' }"
    @search="onSearch"
    @popup-visible-change="onVisible"
    @change="onChange"
  >
    <template #panelTopContent>
      <div v-if="error" class="problem-select__note problem-select__note--error" role="alert">{{ error }}</div>
      <div v-else-if="loaded && options.length === 0 && !loading" class="problem-select__note">没有找到题目，换个关键词试试（可以输入题名、章节或题号）。</div>
    </template>
    <template #panelBottomContent>
      <div v-if="nextCursor !== null" class="problem-select__more">
        <t-button size="small" variant="text" theme="primary" :loading="loading" data-testid="problem-select-more" @click="load(true)">加载更多</t-button>
      </div>
    </template>
  </t-select>
</template>

<style scoped>
.problem-select { width: 100%; max-width: 420px; }
</style>

<style>
.problem-select__note { padding: 8px 12px; color: var(--pg-ink-2); font-size: 13px; }
.problem-select__note--error { color: var(--pg-chili-text); }
.problem-select__more { padding: 4px 8px; border-top: 1px solid var(--pg-border); text-align: center; }
</style>
