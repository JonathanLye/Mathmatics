<script setup lang="ts">
/**
 * 练习区：从整个题库里自由挑题（GET /student/practice）。pages/practice 是写证明的工作台，所以这里叫 practice-zone。
 * 主按钮只有一个：随机来一道。筛选条件这次打开里一直留着，从题目回来不变。
 * 状态、分面、能不能开始都来自服务端；开始题目复用自学布置，奖励、证明本、错题和路径上一样。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import { errorMessage, listPractice, randomPracticeProblem, startPracticeProblem } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import TagChip from '@/components/TagChip.vue'
import { applyApiOverride, openPractice } from '@/components/path/openPractice'
import SolutionSheet from '@/components/practice-zone/SolutionSheet.vue'
import ZoneProblemCard from '@/components/practice-zone/ZoneProblemCard.vue'
import {
  EMPTY_FILTERS,
  ZONE_PAGE_SIZE,
  ZONE_REFRESH_MAX,
  filtersActive,
  loadFilters,
  mergeRefreshed,
  randomFilter,
  resultCount,
  saveFilters,
  zoneQuery,
  type ZoneFilters,
} from '@/components/practice-zone/zoneLogic'
import PgButton from '@/components/ui/PgButton.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { useToast } from '@/components/ui/useToast'
import { AI_IMPORTED_NOTE, SOURCE_OF, AI_IMPORTED_TAG, DIFFICULTY_TONE, STATUS_LABEL, ZONE_COPY } from '@/copy'
import { DIFFICULTY_LABEL, type PracticeFacets, type PracticeItem } from '@/types/path'

const toast = useToast()

const DIFFICULTY_OPTIONS: ReadonlyArray<{ value: ZoneFilters['difficulty']; label: string; testid: string }> = [
  { value: 'all', label: ZONE_COPY.difficultyAll, testid: 'zone-difficulty-all' },
  { value: 'easy', label: DIFFICULTY_LABEL.easy, testid: 'zone-difficulty-easy' },
  { value: 'medium', label: DIFFICULTY_LABEL.medium, testid: 'zone-difficulty-medium' },
  { value: 'hard', label: DIFFICULTY_LABEL.hard, testid: 'zone-difficulty-hard' },
]
const STATUS_OPTIONS: ReadonlyArray<{ value: ZoneFilters['status']; label: string; testid: string }> = [
  { value: 'all', label: ZONE_COPY.statusAll, testid: 'zone-status-all' },
  { value: 'todo', label: STATUS_LABEL.todo, testid: 'zone-status-todo' },
  { value: 'active', label: STATUS_LABEL.active, testid: 'zone-status-active' },
  { value: 'done', label: STATUS_LABEL.done, testid: 'zone-status-done' },
]

const filters = ref<ZoneFilters>(loadFilters())
const items = ref<PracticeItem[]>([])
const facets = ref<PracticeFacets | null>(null)
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const moreError = ref('')
const error = ref('')
const loadedOnce = ref(false)
let requestNo = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

onLoad((q) => {
  applyApiOverride(q)
})

onShow(() => {
  // 从题目回来：不重置筛选，也不把列表滚回顶部，只把状态更新一下。
  void (loadedOnce.value ? refresh() : load())
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

async function load(): Promise<void> {
  const ticket = ++requestNo
  loading.value = true
  error.value = ''
  moreError.value = ''
  try {
    const page = await listPractice(zoneQuery(filters.value))
    if (ticket !== requestNo) return
    items.value = page.items
    facets.value = page.facets
    nextCursor.value = page.nextCursor
    loadedOnce.value = true
  } catch (e) {
    if (ticket !== requestNo) return
    items.value = []
    error.value = errorMessage(e)
  } finally {
    if (ticket === requestNo) loading.value = false
  }
}

async function refresh(): Promise<void> {
  const ticket = ++requestNo
  const loaded = items.value.length
  try {
    const limit = Math.max(ZONE_PAGE_SIZE, Math.min(loaded, ZONE_REFRESH_MAX))
    const page = await listPractice(zoneQuery(filters.value, { limit }))
    if (ticket !== requestNo) return
    const whole = loaded <= ZONE_REFRESH_MAX
    items.value = mergeRefreshed(items.value, page.items, whole)
    facets.value = page.facets
    if (whole) nextCursor.value = page.nextCursor
  } catch {
    /* 悄悄刷新失败：列表还在，下次再说 */
  }
}

async function loadMore(): Promise<void> {
  const cursor = nextCursor.value
  if (!cursor || loadingMore.value) return
  const ticket = requestNo
  loadingMore.value = true
  moreError.value = ''
  try {
    const page = await listPractice(zoneQuery(filters.value, { cursor }))
    if (ticket !== requestNo) return
    items.value = [...items.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (e) {
    if (ticket === requestNo) moreError.value = errorMessage(e)
  } finally {
    loadingMore.value = false
  }
}

function setFilter<K extends keyof ZoneFilters>(key: K, value: ZoneFilters[K]): void {
  if (filters.value[key] === value) return
  filters.value = { ...filters.value, [key]: value }
  saveFilters(filters.value)
  void load()
}

/** 搜索框：停手 300 毫秒再查。 */
const searchText = ref(filters.value.q)
watch(searchText, (text) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', text.trim()), 300)
})

function clearSearch(): void {
  searchText.value = ''
}

function clearFilters(): void {
  searchText.value = ''
  filters.value = { ...EMPTY_FILTERS }
  saveFilters(filters.value)
  void load()
}

const active = computed(() => filtersActive(filters.value))
const count = computed(() => resultCount(facets.value, filters.value))

// ---- 章节选择 ----
const chapterOpen = ref(false)
const chapterLabel = computed(() => filters.value.chapter || ZONE_COPY.allChapters)

function pickChapter(chapter: string): void {
  chapterOpen.value = false
  setFilter('chapter', chapter)
}

// ---- 题目卡片 ----
const sheetOpen = ref(false)
const sheetItem = ref<PracticeItem | null>(null)
const sheetBusy = ref(false)
const sheetError = ref('')
const solutionOpen = ref(false)
/** 卡片是随机抽到的：多一个“换一道”。 */
const fromRandom = ref(false)

function openItem(item: PracticeItem, random = false): void {
  sheetItem.value = item
  sheetError.value = ''
  fromRandom.value = random
  sheetOpen.value = true
}

async function act(): Promise<void> {
  const item = sheetItem.value
  if (!item || sheetBusy.value) return
  if (item.status === 'done') {
    if (!item.attemptId) return
    sheetOpen.value = false
    uni.navigateTo({ url: '/pages/proof-detail/index?attemptId=' + encodeURIComponent(item.attemptId) })
    return
  }
  sheetBusy.value = true
  sheetError.value = ''
  try {
    const state = await startPracticeProblem(item.problemId)
    sheetOpen.value = false
    openPractice(state, 'zone')
  } catch (e) {
    sheetError.value = errorMessage(e)
  } finally {
    sheetBusy.value = false
  }
}

// ---- 随机来一道 ----
const rolling = ref(false)
const rollMessage = ref('')

async function roll(): Promise<void> {
  if (rolling.value) return
  rolling.value = true
  rollMessage.value = ''
  try {
    const item = await randomPracticeProblem(randomFilter(filters.value))
    openItem(item, true)
  } catch (e) {
    // 范围里都做完了：服务端的话就很友好，放在按钮下面。
    const text = errorMessage(e)
    if (sheetOpen.value) {
      sheetError.value = text
    } else {
      rollMessage.value = text
      toast.show(text)
    }
  } finally {
    rolling.value = false
  }
}
</script>

<template>
  <AppShell active="practice">
    <view class="pg-zone" data-testid="practice-zone-page">
      <view class="pg-zone__head">
        <text class="pg-zone__title">{{ ZONE_COPY.title }}</text>
        <text class="pg-zone__sub">{{ ZONE_COPY.subtitle }}</text>
      </view>

      <PgButton block size="lg" sound="tap" class="pg-zone__random" data-testid="zone-random" :loading="rolling" @tap="roll">
        <PgIcon v-if="!rolling" name="flash" :size="20" />{{ ZONE_COPY.random }}
      </PgButton>
      <text v-if="rollMessage" class="pg-zone__rollmsg" role="status" data-testid="zone-random-message">{{ rollMessage }}</text>

      <view class="pg-zone__filters" data-testid="zone-filters">
        <view class="pg-zone__row">
          <view class="pg-zone__search" :class="{ 'pg-zone__search--on': searchText }">
            <svg class="pg-zone__searchicon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
            <input v-model="searchText" class="pg-zone__input" data-testid="zone-search" :placeholder="ZONE_COPY.searchPlaceholder" confirm-type="search" />
            <view v-if="searchText" class="pg-zone__clear" role="button" tabindex="0" aria-label="清除搜索" data-testid="zone-search-clear" @tap="clearSearch" @keydown.enter.prevent="clearSearch">
              <PgIcon name="close" :size="16" />
            </view>
          </view>
          <view class="pg-zone__chapter" :class="{ 'pg-zone__chapter--on': filters.chapter }" role="button" tabindex="0" data-testid="zone-chapter" :aria-label="ZONE_COPY.chapterSheet" @tap="chapterOpen = true" @keydown.enter.prevent="chapterOpen = true">
            <text class="pg-zone__chaptertext">{{ chapterLabel }}</text>
            <PgIcon name="chevron" :size="14" class="pg-zone__chapterarrow" />
          </view>
        </view>
        <PgSegmented :model-value="filters.difficulty" :options="DIFFICULTY_OPTIONS" :label="ZONE_COPY.difficultyLabel" data-testid="zone-difficulty" @update:model-value="setFilter('difficulty', $event)" />
        <PgSegmented :model-value="filters.status" :options="STATUS_OPTIONS" :label="ZONE_COPY.statusLabel" data-testid="zone-status" @update:model-value="setFilter('status', $event)" />
      </view>

      <view v-if="count !== null && !error" class="pg-zone__summary">
        <text class="pg-zone__count" data-testid="zone-count">{{ ZONE_COPY.resultCount(count) }}</text>
        <text v-if="active" class="pg-zone__reset" role="button" tabindex="0" data-testid="zone-reset" @tap="clearFilters" @keydown.enter.prevent="clearFilters">{{ ZONE_COPY.emptyAction }}</text>
      </view>

      <view v-if="loading && !items.length" class="pg-zone__list" data-testid="zone-loading" aria-busy="true">
        <PgSkeleton variant="block" :count="4" />
      </view>

      <view v-else-if="error" data-testid="zone-error" role="alert">
        <PgEmpty :title="ZONE_COPY.loadFailedTitle" :body="error" expr="oops" :motion="null" :size="88" action="重试" action-testid="zone-retry" @action="load" />
      </view>

      <view v-else-if="!items.length" data-testid="zone-empty">
        <PgEmpty
          :title="active ? ZONE_COPY.emptyTitle : ZONE_COPY.noneTitle"
          :body="active ? ZONE_COPY.emptyBody : ZONE_COPY.noneBody"
          expr="think"
          :motion="['think-tilt', 'blink']"
          :action="active ? ZONE_COPY.emptyAction : ''"
          action-testid="zone-empty-clear"
          @action="clearFilters"
        />
      </view>

      <template v-else>
        <view class="pg-zone__list pg-stagger" :class="{ 'pg-zone__list--busy': loading }" data-testid="zone-list" :aria-busy="loading ? 'true' : undefined">
          <ZoneProblemCard v-for="item in items" :key="item.problemId" :item="item" @open="openItem(item)" />
        </view>
        <text v-if="moreError" class="pg-zone__moreerror" role="alert" data-testid="zone-more-error">{{ moreError }}</text>
        <PgButton v-if="nextCursor" class="pg-zone__more" variant="secondary" block sound="tap" data-testid="zone-load-more" :loading="loadingMore" @tap="loadMore">{{ ZONE_COPY.loadMore }}</PgButton>
      </template>
    </view>

    <!-- 章节选择 -->
    <PgSheet v-model:open="chapterOpen" data-testid="zone-chapter-sheet" :aria-label="ZONE_COPY.chapterSheet">
      <text class="pg-zone__sheettitle">{{ ZONE_COPY.chapterSheet }}</text>
      <view class="pg-zone__option" :class="{ 'pg-zone__option--on': !filters.chapter }" role="button" tabindex="0" data-testid="zone-chapter-all" @tap="pickChapter('')" @keydown.enter.prevent="pickChapter('')">
        <text class="pg-zone__optionname">{{ ZONE_COPY.allChapters }}</text>
      </view>
      <view
        v-for="entry in facets?.chapters ?? []"
        :key="entry.chapter"
        class="pg-zone__option"
        :class="{ 'pg-zone__option--on': filters.chapter === entry.chapter }"
        role="button"
        tabindex="0"
        data-testid="zone-chapter-option"
        :data-chapter="entry.chapter"
        @tap="pickChapter(entry.chapter)"
        @keydown.enter.prevent="pickChapter(entry.chapter)"
      >
        <text class="pg-zone__optionname">{{ entry.chapter }}</text>
        <text class="pg-zone__optioncount">{{ ZONE_COPY.chapterCount(entry.done, entry.total) }}</text>
      </view>
    </PgSheet>

    <!-- 题目卡片 -->
    <PgSheet v-model:open="sheetOpen" :persistent="sheetBusy" data-testid="zone-sheet" :aria-label="sheetItem?.title">
      <template v-if="sheetItem">
        <view class="pg-zone__sheettags">
          <TagChip :tone="DIFFICULTY_TONE[sheetItem.difficulty]">{{ DIFFICULTY_LABEL[sheetItem.difficulty] }}</TagChip>
          <TagChip v-if="sheetItem.status === 'active'" tone="accent">{{ STATUS_LABEL.active }}</TagChip>
          <TagChip v-if="sheetItem.status === 'done'" tone="bee">{{ STATUS_LABEL.done }}</TagChip>
          <TagChip v-if="sheetItem.autoImported">{{ AI_IMPORTED_TAG }}</TagChip>
        </view>
        <MathText class="pg-zone__sheetname" :text="sheetItem.title" data-testid="zone-sheet-title" />
        <MathText class="pg-zone__sheetstem" :text="sheetItem.stemPreview" block serif data-testid="zone-sheet-stem" />
        <text class="pg-zone__sheetmeta">{{ sheetItem.chapter }}<text v-if="sheetItem.keyCount"> · {{ ZONE_COPY.keyCount(sheetItem.keyCount) }}</text></text>
        <text v-if="sheetItem.sourceBook" class="pg-zone__sheetnote" data-testid="zone-sheet-source">{{ SOURCE_OF(sheetItem.sourceBook) }}</text>
        <text v-if="sheetItem.autoImported" class="pg-zone__sheetnote">{{ AI_IMPORTED_NOTE }}</text>
        <text v-if="sheetError" class="pg-zone__sheeterror" role="alert" data-testid="zone-sheet-error">{{ sheetError }}</text>
        <view class="pg-zone__sheetactions">
          <PgButton block size="lg" sound="tap" data-testid="zone-sheet-action" :loading="sheetBusy" @tap="act">{{ ZONE_COPY.action[sheetItem.status] }}</PgButton>
          <view class="pg-zone__sheetsub">
            <PgButton class="pg-zone__sheetsubbtn" variant="secondary" sound="tap" data-testid="zone-sheet-solution" :disabled="sheetBusy" @tap="solutionOpen = true">{{ ZONE_COPY.solutionEntry }}</PgButton>
            <PgButton v-if="fromRandom" class="pg-zone__sheetsubbtn" variant="secondary" sound="tap" data-testid="zone-sheet-reroll" :disabled="sheetBusy" :loading="rolling" @tap="roll">{{ ZONE_COPY.rerandom }}</PgButton>
          </view>
        </view>
      </template>
    </PgSheet>

    <SolutionSheet v-model:open="solutionOpen" :problem-id="sheetItem?.problemId ?? null" />
  </AppShell>
</template>

<style scoped>
.pg-zone { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-zone__head { display: flex; flex-direction: column; gap: 2px; }
.pg-zone__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-zone__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-zone__random { margin-top: var(--sp-1); }
.pg-zone__rollmsg { padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--sea-soft); color: var(--sea-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.5; }
.pg-zone__filters { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-zone__row { display: flex; gap: var(--sp-2); min-width: 0; }

/* 搜索框 */
.pg-zone__search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: var(--touch);
  padding: 0 var(--sp-1) 0 var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--paper-2);
  box-shadow: inset 0 0 0 var(--bw) var(--rule);
  transition: box-shadow var(--dur-fast) ease-out;
}
.pg-zone__search:focus-within,
.pg-zone__search--on { box-shadow: inset 0 0 0 var(--bw) var(--accent); }
.pg-zone__searchicon { flex: none; color: var(--ink-2); }
.pg-zone__input { flex: 1; min-width: 0; height: var(--touch); border: 0; background: transparent; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-bold); }
.pg-zone__clear { flex: none; width: var(--touch); height: var(--touch); display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--ink-2); cursor: pointer; }
.pg-zone__clear:active { background: var(--rule); }

/* 章节按钮 */
.pg-zone__chapter {
  flex: 0 1 auto;
  max-width: 46%;
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: var(--touch);
  padding: 0 var(--sp-2) 0 var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--paper-2);
  box-shadow: inset 0 0 0 var(--bw) var(--rule);
  color: var(--ink-2);
  cursor: pointer;
  transition: transform var(--dur-base) var(--ease-spring);
}
.pg-zone__chapter:active { transform: scale(0.97); transition-duration: var(--dur-fast); }
.pg-zone__chapter--on { background: var(--accent-soft); box-shadow: inset 0 0 0 var(--bw) var(--accent); color: var(--accent-text); }
.pg-zone__chaptertext { min-width: 0; overflow: hidden; font-size: var(--fs-13); font-weight: var(--fw-black); text-overflow: ellipsis; white-space: nowrap; }
.pg-zone__chapterarrow { flex: none; transform: rotate(90deg); }

.pg-zone__summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); min-height: var(--touch); margin-bottom: calc(var(--sp-2) * -1); }
.pg-zone__count { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; }
.pg-zone__reset { display: inline-flex; align-items: center; min-height: var(--touch); padding: 0 var(--sp-1); color: var(--accent-text); font-size: var(--fs-13); font-weight: var(--fw-black); cursor: pointer; }
.pg-zone__list { display: flex; flex-direction: column; gap: var(--sp-3); transition: opacity var(--dur-base) ease-out; }
.pg-zone__list--busy { opacity: 0.55; }
.pg-zone__more { margin-top: var(--sp-1); }
.pg-zone__moreerror { color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); text-align: center; }

/* 章节弹层 */
.pg-zone__sheettitle { margin-top: var(--sp-1); color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-zone__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-height: 52px;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-12);
  cursor: pointer;
  transition: transform var(--dur-base) var(--ease-spring);
}
.pg-zone__option:active { transform: scale(0.98); transition-duration: var(--dur-fast); }
.pg-zone__option--on { border-color: var(--accent); background: var(--accent-soft); }
.pg-zone__optionname { min-width: 0; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); }
.pg-zone__optioncount { flex: none; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); font-variant-numeric: tabular-nums; }

/* 题目卡片 */
.pg-zone__sheettags { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-top: var(--sp-1); }
.pg-zone__sheetname { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); overflow-wrap: anywhere; }
.pg-zone__sheetstem { color: var(--ink); font-size: var(--fs-16); line-height: var(--lh-body); }
.pg-zone__sheetmeta { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-zone__sheetnote { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-zone__sheeterror { padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--fox-soft); color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.5; }
.pg-zone__sheetactions { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-1); }
.pg-zone__sheetsub { display: flex; gap: var(--sp-2); }
.pg-zone__sheetsubbtn { flex: 1; min-width: 0; }
</style>
