<script setup lang="ts">
/**
 * 错题（GET /student/mistakes）：按卡点分组，每一处都能直接重做。
 * 错题条目只读展示学生写的行和一句提问，不判对错、不标红。从路径的单元复习进来时按章筛选。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import { errorMessage, fetchMistakes, startRedo } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import { applyApiOverride, openPractice } from '@/components/path/openPractice'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import type { IconName } from '@/components/ui/icons'
import { useToast } from '@/components/ui/useToast'
import { MISTAKE_COPY } from '@/copy'
import type { MistakeGroupId, MistakeItem, MistakesView } from '@/types/attempt'
import { formatDate } from '@/utils/date'

const toast = useToast()
const view = ref<MistakesView | null>(null)
const loading = ref(true)
const error = ref('')
const chapter = ref('')
const redoing = ref('')

const GROUP_ICON: Readonly<Record<MistakeGroupId, IconName>> = {
  definition: 'book',
  basis: 'flag',
  scaling: 'flash',
  hinted: 'help',
  selfcheck: 'check',
  other: 'pen',
}

onLoad((q) => {
  applyApiOverride(q)
  chapter.value = typeof q?.chapter === 'string' ? decodeURIComponent(q.chapter) : ''
})

onShow(() => {
  void load()
})

async function load(): Promise<void> {
  if (!view.value) loading.value = true
  error.value = ''
  try {
    view.value = await fetchMistakes()
  } catch (e) {
    view.value = null
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

const groups = computed(() => {
  const all = view.value?.groups ?? []
  if (!chapter.value) return all
  return all
    .map((group) => {
      const items = group.items.filter((item) => item.chapter === chapter.value)
      return { ...group, items, count: items.length }
    })
    .filter((group) => group.items.length > 0)
})
const total = computed(() => groups.value.reduce((sum, group) => sum + group.count, 0))

function clearFilter(): void {
  chapter.value = ''
}

function goPath(): void {
  uni.reLaunch({ url: '/pages/home/index' })
}

async function redo(item: MistakeItem): Promise<void> {
  if (redoing.value) return
  redoing.value = item.id
  try {
    const state = await startRedo(item.attemptId)
    openPractice(state, 'mistakes')
  } catch (e) {
    toast.show(errorMessage(e), { tone: 'warn' })
  } finally {
    redoing.value = ''
  }
}
</script>

<template>
  <AppShell active="mistakes">
    <view class="pg-mistakes" data-testid="mistakes-page">
      <view class="pg-mistakes__head">
        <view class="pg-mistakes__titlerow">
          <text class="pg-mistakes__title">{{ MISTAKE_COPY.title }}</text>
          <text v-if="total > 0" class="pg-mistakes__total" data-testid="mistakes-total">{{ MISTAKE_COPY.count(total) }}</text>
        </view>
        <text class="pg-mistakes__hint">{{ MISTAKE_COPY.hint }}</text>
      </view>

      <view v-if="chapter" class="pg-mistakes__filter" data-testid="mistakes-filter">
        <text class="pg-mistakes__filtertext">{{ MISTAKE_COPY.filterOn(chapter) }}</text>
        <text class="pg-mistakes__filterclear" role="button" tabindex="0" data-testid="mistakes-filter-clear" @tap="clearFilter" @keydown.enter.prevent="clearFilter">{{ MISTAKE_COPY.filterClear }}</text>
      </view>

      <view v-if="loading" class="pg-mistakes__list" data-testid="mistakes-loading" aria-busy="true">
        <PgSkeleton variant="block" :count="3" />
      </view>

      <view v-else-if="error" data-testid="mistakes-error" role="alert">
        <PgEmpty :title="MISTAKE_COPY.loadFailedTitle" :body="error" expr="oops" :motion="null" :size="88" action="重试" action-testid="mistakes-retry" @action="load" />
      </view>

      <view v-else-if="groups.length === 0" data-testid="mistakes-empty">
        <PgEmpty
          :title="chapter ? MISTAKE_COPY.filteredEmptyTitle : MISTAKE_COPY.emptyTitle"
          :body="chapter ? MISTAKE_COPY.filteredEmptyBody : MISTAKE_COPY.emptyBody"
          expr="cheer"
          :motion="['cheer']"
          :action="MISTAKE_COPY.emptyAction"
          action-testid="mistakes-to-path"
          @action="goPath"
        />
      </view>

      <view v-else class="pg-mistakes__list pg-stagger">
        <view v-for="group in groups" :key="group.group" class="pg-mistakes__group" data-testid="mistake-group" :data-group="group.group">
          <view class="pg-mistakes__grouphead">
            <view class="pg-mistakes__groupicon"><PgIcon :name="GROUP_ICON[group.group] ?? 'pen'" :size="18" /></view>
            <text class="pg-mistakes__groupname">{{ group.title }}</text>
            <text class="pg-mistakes__groupcount">{{ group.count }}</text>
          </view>
          <PgCard v-for="item in group.items" :key="item.id" class="pg-mistake" data-testid="mistake-item">
            <view class="pg-mistake__top">
              <view class="pg-mistake__titles">
                <MathText class="pg-mistake__problem" :text="item.problemTitle" />
                <text class="pg-mistake__meta">{{ item.chapter }} · {{ formatDate(item.createdAt) }}</text>
              </view>
              <PgButton
                class="pg-mistake__redo"
                variant="secondary"
                size="sm"
                sound="tap"
                data-testid="mistake-redo"
                :disabled="!item.canRedo"
                :loading="redoing === item.id"
                :aria-label="MISTAKE_COPY.redo + ' ' + item.problemTitle"
                @tap="redo(item)"
              >
                <PgIcon v-if="redoing !== item.id" name="redo" :size="16" />{{ MISTAKE_COPY.redo }}
              </PgButton>
            </view>
            <view v-if="item.lineExcerpt" class="pg-mistake__line">
              <text class="pg-mistake__label">{{ MISTAKE_COPY.yourLine }}</text>
              <MathText class="pg-mistake__linetext" :text="item.lineExcerpt" block serif />
            </view>
            <view v-if="item.note" class="pg-mistake__note">
              <text class="pg-mistake__notelabel">{{ MISTAKE_COPY.question }}</text>
              <MathText class="pg-mistake__notetext" :text="item.note" block />
            </view>
            <text v-if="!item.canRedo" class="pg-mistake__noredo">{{ MISTAKE_COPY.noRedo }}</text>
          </PgCard>
        </view>
      </view>
    </view>
  </AppShell>
</template>

<style scoped>
.pg-mistakes { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-mistakes__head { display: flex; flex-direction: column; gap: 2px; }
.pg-mistakes__titlerow { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-mistakes__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-mistakes__total { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-mistakes__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-mistakes__filter { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); padding-left: var(--sp-3); border-radius: var(--radius-12); background: var(--accent-soft); }
.pg-mistakes__filtertext { min-width: 0; color: var(--accent-text); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-mistakes__filterclear { flex: none; display: inline-flex; align-items: center; min-height: var(--touch); padding: 0 var(--sp-3); color: var(--accent-text); font-size: var(--fs-13); font-weight: var(--fw-black); text-decoration: underline; cursor: pointer; }
.pg-mistakes__list { display: flex; flex-direction: column; gap: var(--sp-5); }
.pg-mistakes__group { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-mistakes__grouphead { display: flex; align-items: center; gap: var(--sp-2); }
.pg-mistakes__groupicon { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-12); background: var(--sea-soft); color: var(--sea-text); }
.pg-mistakes__groupname { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-mistakes__groupcount { flex: none; min-width: 24px; padding: 2px var(--sp-2); border-radius: var(--radius-pill); background: var(--paper-2); color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-black); text-align: center; font-variant-numeric: tabular-nums; }
.pg-mistake { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-mistake__top { display: flex; align-items: flex-start; gap: var(--sp-3); }
.pg-mistake__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-mistake__problem { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.35; overflow-wrap: anywhere; }
.pg-mistake__meta { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); line-height: 1.3; }
.pg-mistake__redo { flex: none; }
.pg-mistake__line { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--paper-2); }
.pg-mistake__label { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
.pg-mistake__linetext { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); min-width: 0; }
.pg-mistake__note { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--sea-soft); }
.pg-mistake__notelabel { color: var(--sea-text); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pg-mistake__notetext { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); min-width: 0; }
.pg-mistake__noredo { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
</style>
