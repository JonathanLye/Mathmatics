<script setup lang="ts">
/**
 * 路径（首页）：GET /student/path 驱动。顶部连胜、经验、今日目标；老师布置置顶；单元横幅；蜿蜒路径。
 * 只渲染服务端状态：完成、软锁、单元开放都来自接口。接口失败显示错误和重试，不回退假数据。
 * 演示构建默认走 mock（见 api/client.ts）；加 ?api=real 走真实接口（e2e 弱网用例用）。
 */
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { consumeRewards, errorMessage, getMe, getStudentPath, isMockMode, setMockMode, startAttempt, startPathItem } from '@/api/client'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import AppShell from '@/components/AppShell.vue'
import HomeOnboarding from '@/components/onboarding/HomeOnboarding.vue'
import ProgressStats from '@/components/ProgressStats.vue'
import ChapterSheet from '@/components/path/ChapterSheet.vue'
import PathMap from '@/components/path/PathMap.vue'
import PathNodeSheet from '@/components/path/PathNodeSheet.vue'
import TeacherPins from '@/components/path/TeacherPins.vue'
import UnitBanner from '@/components/path/UnitBanner.vue'
import UnitNotesSheet from '@/components/path/UnitNotesSheet.vue'
import { openPractice } from '@/components/path/openPractice'
import { currentIndex, doneIds, newlyDone, readSeen, writeSeen } from '@/components/path/pathLogic'
import PgButton from '@/components/ui/PgButton.vue'
import PgDialog from '@/components/ui/PgDialog.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { useToast } from '@/components/ui/useToast'
import { COPY, PATH_COPY, studentName } from '@/copy'
import { useProgress } from '@/composables/useProgress'
import { useViewport } from '@/composables/useViewport'
import { feedbackAllowed } from '@/motion/useFeedbackPrefs'
import { useRewards } from '@/motion/useRewards'
import type { AssignmentCardView } from '@/types/attempt'
import type { PathItem, PathUnitSummary, StudentPath } from '@/types/path'

const { mode } = useViewport()
const toast = useToast()
const rewards = useRewards()
const { progress, load: loadProgress } = useProgress()
/** 桌面把数字放进右栏；同一份内容只渲染一处，testid 不重复。 */
const wide = computed(() => mode.value === 'desktop')

const mockMode = ref(isMockMode())
const path = ref<StudentPath | null>(null)
const selectedUnit = ref<string | undefined>(undefined)
const loading = ref(true)
const error = ref('')
/** 弱网提示：加载超过 1.2 秒还没回来（client 自动重试期间）。 */
const slow = ref(false)
const retrying = ref(false)
const name = ref('')
const justDone = ref<string[]>([])
const entering = ref(true)
let requestNo = 0
let slowTimer: ReturnType<typeof setTimeout> | null = null
let scrolled = false

onLoad(async (q) => {
  if (q?.api === 'real') {
    setMockMode(false)
    mockMode.value = false
  }
  // 年龄门：Me.ageBand=null → 年龄选择页；lt14 → 暂不开通（守卫内重定向）。
  if (!ageGatePassed(await enforceAgeGate())) return
})

onShow(() => {
  void loadPath()
  void loadProgress(true)
  void loadName()
  // 做题页还没接奖励时，回到路径把这一笔提示掉；接好之后这里读到的是空。
  rewards.present(consumeRewards(), { completion: true })
})

onUnmounted(() => {
  if (slowTimer) clearTimeout(slowTimer)
})

/** 问候语只要昵称：/me 失败不影响路径。 */
async function loadName(): Promise<void> {
  try {
    name.value = studentName((await getMe()).displayName)
  } catch {
    name.value = ''
  }
}

const greeting = computed(() => (name.value && name.value !== COPY.studentFallbackName ? `你好，${name.value}` : `${COPY.studentFallbackName}，你好`))

/** 拉路径。已有内容时悄悄刷新，不闪骨架；manual=true 是用户点了重试。 */
async function loadPath(manual = false): Promise<void> {
  const ticket = ++requestNo
  if (!path.value) loading.value = true
  error.value = ''
  retrying.value = manual
  slow.value = false
  if (slowTimer) clearTimeout(slowTimer)
  slowTimer = setTimeout(() => {
    if (loading.value) slow.value = true
  }, 1200)
  try {
    const next = await getStudentPath(selectedUnit.value)
    if (ticket !== requestNo) return
    applyPath(next)
  } catch (e) {
    if (ticket !== requestNo) return
    path.value = null
    error.value = errorMessage(e)
  } finally {
    if (ticket === requestNo) {
      loading.value = false
      slow.value = false
      retrying.value = false
      if (slowTimer) clearTimeout(slowTimer)
      slowTimer = null
    }
  }
}

/** 比一比上次看到的已完成节点：新完成的播动画，然后记下来。 */
function applyPath(next: StudentPath): void {
  path.value = next
  const current = next.current
  if (!current) return
  justDone.value = newlyDone(readSeen(current.id), current.items)
  writeSeen(current.id, doneIds(current.items))
  void nextTick(scrollToCurrent)
}

/** 第一次进来把当前节点滚到屏幕中间（已经看得见就不动）。 */
function scrollToCurrent(): void {
  if (scrolled || typeof document === 'undefined') return
  scrolled = true
  const node = document.querySelector('[data-testid="home-path-node"][data-current="true"]')
  if (!node) return
  const rect = node.getBoundingClientRect()
  const bottomMargin = window.innerWidth < 600 ? 96 : 24
  if (rect.top >= 120 && rect.bottom <= window.innerHeight - bottomMargin) return
  node.scrollIntoView({ block: 'center', behavior: feedbackAllowed('motion') ? 'smooth' : 'auto' })
}

const unit = computed(() => path.value?.current ?? null)
const chapterName = computed(() => {
  const current = unit.value
  if (!current) return ''
  return path.value?.chapters.find((c) => c.chapterNo === current.chapterNo)?.chapter ?? `第 ${current.chapterNo} 章`
})
const unitIndex = computed(() => path.value?.units.findIndex((u) => u.id === unit.value?.id) ?? -1)
const nextUnit = computed(() => (unitIndex.value === -1 ? null : (path.value?.units[unitIndex.value + 1] ?? null)))
const prevUnit = computed(() => (unitIndex.value <= 0 ? null : (path.value?.units[unitIndex.value - 1] ?? null)))
const teacherCards = computed(() => path.value?.teacherAssignments ?? [])
/** 一道都没开始过：小方说“从这里开始”。 */
const firstTime = computed(() => {
  const list = path.value?.units ?? []
  return list.length > 0 && list.every((u) => u.done === 0) && (unit.value?.items ?? []).every((item) => item.state === 'todo')
})
const noCourse = computed(() => Boolean(path.value) && !unit.value)

// ---- 节点卡片 ----
const sheetOpen = ref(false)
const sheetItem = ref<PathItem | null>(null)
const sheetBusy = ref(false)
const sheetError = ref('')

function openNode(item: PathItem): void {
  sheetItem.value = item
  sheetError.value = ''
  sheetOpen.value = true
}

function goDetail(item: PathItem, section?: string): void {
  if (!item.attemptId) return
  sheetOpen.value = false
  uni.navigateTo({ url: '/pages/proof-detail/index?attemptId=' + encodeURIComponent(item.attemptId) + (section ? '&section=' + section : '') })
}

/** 开始、继续（软锁的也走这里：用户已经确认要跳过去）；做完了去只读回看。 */
async function actOn(item: PathItem): Promise<void> {
  if (sheetBusy.value) return
  if (item.state === 'done') {
    goDetail(item)
    return
  }
  sheetItem.value = item
  sheetError.value = ''
  sheetBusy.value = true
  try {
    const state = await startPathItem(item.problemId)
    sheetOpen.value = false
    openPractice(state, 'path')
  } catch (e) {
    // 班里这题正在测验等：把服务端的说明放在卡片里，不跳走。
    sheetError.value = errorMessage(e)
    sheetOpen.value = true
  } finally {
    sheetBusy.value = false
  }
}

function backToCurrent(): void {
  sheetOpen.value = false
  const items = unit.value?.items ?? []
  const at = currentIndex(items)
  if (at !== -1) void nextTick(() => document.querySelector('[data-testid="home-path-node"][data-current="true"]')?.scrollIntoView({ block: 'center', behavior: feedbackAllowed('motion') ? 'smooth' : 'auto' }))
}

// ---- 老师布置 ----
async function goTeacher(card: AssignmentCardView): Promise<void> {
  if (card.status !== 'open') return
  if (!isMockMode()) {
    const query = card.attemptId ? 'attemptId=' + encodeURIComponent(card.attemptId) : 'assignmentId=' + encodeURIComponent(card.assignmentId)
    uni.navigateTo({ url: '/pages/practice/index?' + query + '&from=teacher' })
    return
  }
  openPractice(await startAttempt(card.assignmentId), 'teacher')
}

// ---- 单元讲义、章节跳转 ----
const notesOpen = ref(false)
const chaptersOpen = ref(false)
const lockedUnit = ref<PathUnitSummary | null>(null)

function pickUnit(picked: PathUnitSummary): void {
  if (picked.id === unit.value?.id) {
    chaptersOpen.value = false
    return
  }
  if (picked.locked) {
    lockedUnit.value = picked
    return
  }
  goUnit(picked)
}

function goUnit(target: PathUnitSummary): void {
  chaptersOpen.value = false
  lockedUnit.value = null
  selectedUnit.value = target.id
  entering.value = false
  void nextTick(async () => {
    await loadPath()
    entering.value = true
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  })
}

/** 单元复习：错题页按这一章筛选（错题条目带章，不带单元）。 */
function goChest(): void {
  const chapter = chapterName.value
  uni.navigateTo({ url: '/pages/mistakes/index' + (chapter ? '?chapter=' + encodeURIComponent(chapter) : '') })
}

function goZone(): void {
  uni.reLaunch({ url: '/pages/practice-zone/index' })
}
</script>

<template>
  <AppShell active="path">
    <view class="pg-home" data-testid="home-page">
      <ProgressStats v-if="!wide" :progress="progress" class="pg-home__stats" />

      <view class="pg-home__hello">
        <text class="pg-home__greeting" data-testid="home-greeting">{{ greeting }}</text>
        <text v-if="mockMode" class="pg-home__mode" data-testid="home-mock-badge">{{ COPY.demoBadge }}</text>
      </view>

      <view v-if="slow" class="pg-home__slow" role="status" data-testid="home-slow">{{ PATH_COPY.slow }}</view>

      <view v-if="loading" class="pg-home__skeleton" data-testid="home-loading" aria-busy="true">
        <PgSkeleton variant="block" />
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(0)" />
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(72px)" />
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(36px)" />
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(-48px)" />
        <text class="pg-home__skeletontip">{{ retrying ? '正在重试…' : PATH_COPY.loading }}</text>
      </view>

      <view v-else-if="error" class="pg-home__error" data-testid="home-error" role="alert">
        <PgEmpty :title="PATH_COPY.loadFailedTitle" :body="error" expr="oops" :motion="null" :size="88">
          <template #action>
            <PgButton class="pg-home__retry" data-testid="home-retry" :loading="retrying" @tap="loadPath(true)">{{ retrying ? '正在重试…' : '重试' }}</PgButton>
          </template>
        </PgEmpty>
      </view>

      <template v-else-if="path">
        <TeacherPins :cards="teacherCards" class="pg-home__pins" @go="goTeacher" />

        <view v-if="noCourse" data-testid="home-empty">
          <PgEmpty :title="PATH_COPY.emptyTitle" :body="PATH_COPY.emptyBody" expr="think" :motion="['think-tilt', 'blink']" :action="PATH_COPY.emptyAction" action-testid="home-empty-action" @action="goZone" />
        </view>

        <template v-else-if="unit">
          <UnitBanner :unit="unit" :chapter="chapterName" class="pg-home__banner" @notes="notesOpen = true" @chapters="chaptersOpen = true" />

          <view v-if="unit.items.length === 0" data-testid="home-empty-unit">
            <PgEmpty :title="PATH_COPY.emptyUnitTitle" :body="PATH_COPY.emptyUnitBody" expr="sleepy" :motion="null" :size="88" />
          </view>
          <PathMap
            v-else
            :key="unit.id"
            :items="unit.items"
            :just-done="justDone"
            :first-time="firstTime"
            :enter="entering"
            class="pg-home__map"
            @open="openNode"
            @continue="actOn"
            @chest="goChest"
          />

          <view class="pg-home__units">
            <PgButton v-if="prevUnit" class="pg-home__unitlink" variant="ghost" size="sm" data-testid="home-prev-unit" @tap="pickUnit(prevUnit)">
              <PgIcon name="back" :size="16" />{{ PATH_COPY.prevUnit(prevUnit.title) }}
            </PgButton>
            <PgButton v-if="nextUnit" class="pg-home__unitlink" variant="secondary" size="sm" sound="tap" data-testid="home-next-unit" @tap="pickUnit(nextUnit)">
              <PgIcon v-if="nextUnit.locked" name="lock" :size="16" />{{ PATH_COPY.nextUnit(nextUnit.title) }}<PgIcon v-if="!nextUnit.locked" name="fwd" :size="16" />
            </PgButton>
          </view>
        </template>
      </template>
    </view>

    <PathNodeSheet v-model:open="sheetOpen" :item="sheetItem" :busy="sheetBusy" :error="sheetError" @act="sheetItem && actOn(sheetItem)" @review="sheetItem && goDetail(sheetItem, 'review')" @stay="backToCurrent" />
    <UnitNotesSheet v-model:open="notesOpen" :unit="unit" :chapter="chapterName" />
    <ChapterSheet v-model:open="chaptersOpen" :chapters="path?.chapters ?? []" :units="path?.units ?? []" :current-id="unit?.id ?? null" @pick="pickUnit" />
    <PgDialog
      :open="lockedUnit !== null"
      :title="PATH_COPY.unitLockedTitle"
      :body="PATH_COPY.unitLockedBody"
      :confirm-text="PATH_COPY.unitLockedGo"
      :cancel-text="PATH_COPY.unitLockedStay"
      data-testid="home-unit-confirm"
      confirm-testid="home-unit-confirm-go"
      cancel-testid="home-unit-confirm-stay"
      @update:open="lockedUnit = null"
      @confirm="lockedUnit && goUnit(lockedUnit)"
    />
  </AppShell>
  <HomeOnboarding :ready="!loading && !!path" />
</template>

<style scoped>
.pg-home { display: flex; flex-direction: column; min-width: 0; }
.pg-home__stats { margin-bottom: var(--sp-3); }
.pg-home__hello { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); min-height: 24px; margin-bottom: var(--sp-3); }
.pg-home__greeting { min-width: 0; color: var(--ink-2); font-size: var(--fs-15); font-weight: var(--fw-heavy); overflow-wrap: anywhere; }
.pg-home__mode {
  flex: none;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-12);
}
.pg-home__slow {
  margin-bottom: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--bee-soft);
  color: var(--ink);
  font-size: var(--fs-13);
}
.pg-home__pins { margin-bottom: var(--sp-4); }
.pg-home__map { margin-top: var(--sp-2); }
.pg-home__units { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); }
.pg-home__unitlink { max-width: 100%; }
.pg-home__skeleton { display: flex; flex-direction: column; gap: var(--sp-6); }
.pg-home__ghost { align-self: center; }
.pg-home__skeletontip { color: var(--ink-2); font-size: var(--fs-13); text-align: center; }
.pg-home__error { margin-top: var(--sp-6); }
.pg-home__retry { margin-top: var(--sp-3); }
</style>
