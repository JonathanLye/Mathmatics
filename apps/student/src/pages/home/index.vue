<script setup lang="ts">
/**
 * 首页（02 §4.2）：GET /student/home 驱动的路径。
 *
 * - todo：open 可开始；scheduled / closed / cancelled 禁用并说明原因；
 * - inProgress：有 attempt 的进行中 →「继续」；
 * - done：已完成 → 查看（证明本）；reviewPublished=true 时显示讲评入口；
 * - 空态 / 骨架 / 错误 + 重试；弱网自动重试（client 内 withRetry）后仍失败可手动重试；
 * - week / notebook 契约里可选，缺省时 UI 降级（不假装有数据）。
 *
 * 演示构建默认走 mock 数据（见 api/client.ts）；加 ?api=real 强制走真实接口（e2e 弱网用例用）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { cardLayerLabel, errorMessage, fetchHome, isMockMode, setMockMode, type HomeData } from '@/api/client'
import type { AssignmentCardView } from '@/types/attempt'
import AppShell from '@/components/AppShell.vue'
import HomeNotebookCard from '@/components/home/HomeNotebookCard.vue'
import HomeStats from '@/components/home/HomeStats.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { COPY } from '@/copy'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { useViewport } from '@/composables/useViewport'
import { formatDateTime } from '@/utils/date'

const { mode } = useViewport()
/** 桌面把数字和证明本放进右栏；同一份内容只渲染一处，testid 不重复。 */
const wide = computed(() => mode.value === 'desktop')

const mockMode = ref(isMockMode())
const home = ref<HomeData | null>(null)
const loading = ref(true)
const error = ref('')
/** 弱网提示：加载超过 1.2 秒仍未返回（client 自动重试期间）显示轻提示。 */
const slow = ref(false)
const retrying = ref(false)
const notice = ref('')
let slowTimer: ReturnType<typeof setTimeout> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null

onLoad(async (q) => {
  if (q?.api === 'real') {
    setMockMode(false)
    mockMode.value = false
  }
  // 年龄门：Me.ageBand=null → 年龄选择页；lt14 → 暂不开通（守卫内重定向）。
  if (!ageGatePassed(await enforceAgeGate())) return
})

onShow(() => {
  void loadHome()
})

onUnmounted(() => {
  if (slowTimer) clearTimeout(slowTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
})

/** 拉首页；manual=true 表示用户点「重试」。client 内部会先自动重试一次（指数退避）。 */
async function loadHome(manual = false): Promise<void> {
  loading.value = true
  error.value = ''
  notice.value = ''
  slow.value = false
  retrying.value = manual
  if (slowTimer) clearTimeout(slowTimer)
  slowTimer = setTimeout(() => {
    if (loading.value) slow.value = true
  }, 1200)
  try {
    home.value = await fetchHome()
  } catch (e) {
    home.value = null
    error.value = errorMessage(e)
  } finally {
    loading.value = false
    slow.value = false
    retrying.value = false
    if (slowTimer) {
      clearTimeout(slowTimer)
      slowTimer = null
    }
  }
}

const greeting = computed(() => home.value?.greeting ?? COPY.studentFallbackName + '，你好')

function showNotice(text: string): void {
  notice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 3200)
}

function isOpen(card: AssignmentCardView): boolean {
  return card.status === 'open' && card.attemptStatus !== 'completed'
}

function disabledReason(card: AssignmentCardView): string {
  if (card.status === 'scheduled') return card.openAt ? '未开始 · ' + formatDateTime(card.openAt) + ' 后开放' : '未开始，等老师开放'
  if (card.status === 'closed') return '已关闭，不能再作答'
  if (card.status === 'cancelled') return '已取消'
  return '暂不可开始'
}

/** 副标题：横幅已经写了当前章节，这里不重复。 */
function cardSub(card: AssignmentCardView): string {
  const chapter = card.chapter === unitChapter.value ? '' : card.chapter
  return [chapter, cardLayerLabel(card), card.mode === 'test' ? '测验' : '练习'].filter(Boolean).join(' · ')
}

/** 进入做题页：有 attempt 用 attemptId 断线重连，否则用 assignmentId 开始/恢复（服务端幂等）。 */
function goPractice(card: AssignmentCardView): void {
  if (!isOpen(card)) return
  const query = card.attemptId ? '?attemptId=' + encodeURIComponent(card.attemptId) : '?assignmentId=' + encodeURIComponent(card.assignmentId)
  uni.navigateTo({ url: '/pages/practice/index' + query })
}

/** 路径节点的蛇形偏移（px）：循环 0 → 右 → 中右 → 左 → 中左。手机主列 358px、节点 250px，偏移不能超过 54。 */
const OFFSETS = [0, 48, 28, -28, -48, -28]
function nodeStyle(i: number): Record<string, string> {
  return { transform: 'translateX(' + OFFSETS[i % OFFSETS.length] + 'px)' }
}

/** 顶部横幅显示的章：进行中的第一题，否则第一个待做，否则第一个已完成。 */
const unitChapter = computed(() => {
  const h = home.value
  const card = h?.inProgress[0] ?? h?.todo[0] ?? h?.done[0]
  return card?.chapter ?? '我的练习'
})

/** “查看”压栈进证明本，这样能退回路径；底部标签切换则不压栈。 */
function goProofbook(): void {
  uni.navigateTo({ url: '/pages/proofbook/index' })
}

/** 讲评入口（只在 reviewPublished=true 时出现）。讲评页面还没有，先说清楚去哪里看。 */
function openReview(card: AssignmentCardView): void {
  showNotice('讲评已发布：《' + card.title + '》，老师会在课上带大家看')
}

/** 完成的证明已经自动进证明本，这里只是确认，不写数据。 */
function addToNotebook(card: AssignmentCardView): void {
  showNotice('《' + card.title + '》已经在证明本里了')
}
</script>

<template>
  <AppShell active="path">
    <view class="pg-home" data-testid="home-page">
      <HomeStats v-if="home && !wide" :home="home" class="pg-home__stats" />
      <text class="pg-home__hello" data-testid="home-greeting">{{ greeting }}</text>
      <text v-if="mockMode" class="pg-home__mode" data-testid="home-mock-badge">{{ COPY.demoBadge }}</text>

      <view class="pg-home__unit">
        <view class="pg-home__unitmain">
          <text class="pg-home__unitkick">当前章节</text>
          <text class="pg-home__unittitle">{{ unitChapter }}</text>
        </view>
        <view class="pg-home__unitbook"><PgIcon name="book" :size="24" /></view>
      </view>

      <view v-if="slow" class="pg-home__slow" role="status" data-testid="home-slow">网络较慢，正在自动重试…（你的内容不会丢）</view>

      <view v-if="loading" class="pg-home__skeleton" data-testid="home-loading" aria-busy="true">
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(36px)" />
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(-36px)" />
        <PgSkeleton variant="circle" class="pg-home__ghost" style="transform: translateX(36px)" />
        <text class="pg-home__skeletontip">{{ retrying ? '正在重试…' : '正在加载首页…' }}</text>
      </view>

      <view v-else-if="error" class="pg-home__error" data-testid="home-error" role="alert">
        <PgEmpty title="首页加载失败" :body="error" expr="oops" :motion="null" :size="88">
          <template #action>
            <PgButton class="pg-home__retry" data-testid="home-retry" :loading="retrying" @tap="loadHome(true)">
              {{ retrying ? '正在重试…' : '重试' }}
            </PgButton>
          </template>
        </PgEmpty>
      </view>

      <view v-else-if="home" class="pg-home__path">
        <!-- 进行中：大节点 + 浮动“继续”气泡 -->
        <view
          v-for="(card, i) in home.inProgress"
          :key="card.assignmentId"
          class="pg-home__node pg-home__node--cur"
          :style="nodeStyle(i)"
          data-testid="home-inprogress-card"
          :data-assignment-id="card.assignmentId"
        >
          <PgButton class="pg-home__go" variant="secondary" size="sm" sound="tap" :data-testid="'home-continue-' + i" @tap="goPractice(card)">继续</PgButton>
          <PgButton class="pg-home__face pg-home__face--cur" size="icon" sound="tap" :aria-label="'继续 ' + card.title" @tap="goPractice(card)">
            <PgIcon name="pen" :size="40" />
          </PgButton>
          <view class="pg-home__label">
            <text class="pg-home__cardtitle">{{ card.title }}</text>
            <text class="pg-home__cardsub">{{ cardSub(card) }}</text>
          </view>
          <view v-if="i === 0" class="pg-home__mascot"><PgMascot expr="idle" :motion="['breathe', 'blink']" :size="84" /></view>
        </view>
        <text v-if="home.inProgress.length === 0" class="pg-home__emptytext" data-testid="home-inprogress-empty">暂无进行中的题，从下面「待完成」开始一道。</text>

        <!-- 待完成：蓝=可开始；灰=未开放（scheduled / closed / cancelled，说明原因） -->
        <view
          v-for="(card, i) in home.todo"
          :key="card.assignmentId"
          class="pg-home__node"
          :class="isOpen(card) ? 'pg-home__node--todo' : 'pg-home__node--off'"
          :style="nodeStyle(home.inProgress.length + i)"
          data-testid="home-todo-card"
          :data-assignment-id="card.assignmentId"
          :data-status="card.status"
        >
          <PgButton
            v-if="isOpen(card)"
            class="pg-home__face"
            variant="sea"
            size="icon"
            sound="tap"
            :aria-label="(card.attemptId ? '继续 ' : '开始 ') + card.title"
            :data-testid="'home-todo-start-' + i"
            @tap="goPractice(card)"
          >
            <PgIcon name="book" :size="34" />
          </PgButton>
          <PgButton
            v-else
            class="pg-home__face"
            size="icon"
            disabled
            :aria-label="(card.status === 'scheduled' ? '未开始 ' : '已关闭 ') + card.title"
            :data-testid="'home-todo-disabled-' + i"
          >
            <PgIcon name="lock" :size="30" />
          </PgButton>
          <view class="pg-home__label">
            <text class="pg-home__cardtitle">{{ card.title }}</text>
            <text class="pg-home__cardsub">{{ cardSub(card) }}</text>
            <text v-if="!isOpen(card)" class="pg-home__cardsub pg-home__disabledreason" :data-testid="'home-todo-reason-' + i">{{ disabledReason(card) }}</text>
          </view>
        </view>
        <text v-if="home.todo.length === 0" class="pg-home__emptytext" data-testid="home-todo-empty">暂时没有待完成的布置。</text>

        <!-- 已完成：金色 ∎ 节点（放在路径末尾，当前题永远在首屏） -->
        <text v-if="home.done.length" class="pg-home__divider">已完成</text>
        <view
          v-for="(card, i) in home.done"
          :key="card.assignmentId"
          class="pg-home__node pg-home__node--done"
          :style="nodeStyle(home.inProgress.length + home.todo.length + i)"
          data-testid="home-done-card"
          :data-assignment-id="card.assignmentId"
        >
          <PgButton class="pg-home__face" variant="hint" size="icon" :aria-label="'查看 ' + card.title" @tap="goProofbook"><PgIcon name="qed" :size="34" color="currentColor" /></PgButton>
          <view class="pg-home__label">
            <text class="pg-home__cardtitle">{{ card.title }}</text>
            <text class="pg-home__cardsub">{{ cardSub(card) }}</text>
            <text v-if="card.reviewPublished" class="pg-home__reviewbadge" :data-testid="'home-done-reviewbadge-' + i">讲评已发布</text>
          </view>
          <view class="pg-home__actions">
            <PgButton variant="secondary" size="sm" :data-testid="'home-done-view-' + i" @tap="goProofbook">查看</PgButton>
            <PgButton variant="secondary" size="sm" :data-testid="'home-done-notebook-' + i" @tap="addToNotebook(card)">加入证明本</PgButton>
            <PgButton v-if="card.reviewPublished" size="sm" :data-testid="'home-done-review-' + i" @tap="openReview(card)">看讲评</PgButton>
          </view>
        </view>
        <view v-if="home.done.length === 0" class="pg-home__doneempty" data-testid="home-done-empty">
          <PgMascot expr="idle" :size="72" />
          <text class="pg-home__emptytext">还没有完成的题，完成后会出现在这里。</text>
        </view>

        <HomeNotebookCard v-if="!wide" :home="home" class="pg-home__notebook" />
      </view>

      <view v-if="notice" class="pg-home__notice" role="status" data-testid="home-notice">{{ notice }}</view>
    </view>

    <template v-if="wide && home" #rail>
      <view class="pg-home__railcard">
        <PgMascot expr="happy" :motion="['breathe', 'blink']" :size="64" />
        <HomeStats :home="home" />
      </view>
      <HomeNotebookCard :home="home" />
    </template>
  </AppShell>
</template>

<style scoped>
.pg-home { display: flex; flex-direction: column; }
.pg-home__stats { margin-bottom: var(--sp-2); }
.pg-home__hello { display: block; margin-bottom: var(--sp-3); color: var(--ink-2); font-size: var(--fs-15); font-weight: var(--fw-heavy); }
.pg-home__mode {
  align-self: flex-start;
  margin-bottom: var(--sp-3);
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-12);
}
.pg-home__unit {
  position: sticky;
  top: calc(var(--safe-top) + var(--sp-1));
  z-index: 3;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 84px;
  padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4);
  margin-bottom: var(--lip);
  border-radius: var(--radius-16);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 var(--lip) 0 var(--accent-lip);
}
.pg-home__unitmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-home__unitkick { font-size: var(--fs-12); opacity: 0.85; }
.pg-home__unittitle { font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-home__unitbook {
  flex: none;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--bw) solid currentColor;
  border-radius: var(--radius-12);
  opacity: 0.8;
}
.pg-home__slow {
  margin-top: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--bee-soft);
  color: var(--ink);
  font-size: var(--fs-13);
}

/* 路径 */
.pg-home__path { display: flex; flex-direction: column; align-items: center; gap: var(--sp-8); padding: var(--sp-8) 0 var(--sp-4); overflow-x: clip; }
.pg-home__node { position: relative; display: flex; flex-direction: column; align-items: center; width: 250px; max-width: 100%; }
.pg-home__face.pg-button {
  width: 76px;
  height: 76px;
  min-height: 76px;
  border-radius: 50%;
  margin-bottom: 8px;
  box-shadow: 0 8px 0 var(--_lip);
}
.pg-home__face.pg-button:active:not([disabled]) { transform: translateY(6px); box-shadow: 0 2px 0 var(--_lip); }
.pg-home__face.pg-button[disabled] { --_lip: var(--rule-2); box-shadow: 0 8px 0 var(--_lip); }
.pg-home__face--cur.pg-button {
  width: 88px;
  height: 88px;
  min-height: 88px;
  box-shadow: 0 8px 0 var(--_lip), 0 0 0 7px var(--accent-soft);
}
.pg-home__face--cur.pg-button:active:not([disabled]) { box-shadow: 0 2px 0 var(--_lip), 0 0 0 7px var(--accent-soft); }
.pg-home__go { margin-bottom: var(--sp-4); color: var(--accent-text); letter-spacing: 1px; animation: pg-home-bob 1.6s ease-in-out 3; }
.pg-home__label { margin-top: var(--sp-3); display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
.pg-home__cardtitle { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); line-height: 1.3; }
.pg-home__cardsub { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.45; }
.pg-home__disabledreason { color: var(--bee-text); }
.pg-home__reviewbadge {
  margin-top: 2px;
  padding: 1px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
}
.pg-home__divider {
  align-self: stretch;
  margin-top: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: var(--bw) solid var(--rule);
  color: var(--ink-2);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
  text-align: center;
}
.pg-home__actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; justify-content: center; margin-top: var(--sp-2); }
.pg-home__mascot { position: absolute; left: 172px; top: 40px; }
.pg-home__doneempty { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); }
.pg-home__emptytext { color: var(--ink-2); font-size: var(--fs-13); text-align: center; }
.pg-home__notebook { width: 100%; margin-top: var(--sp-3); }
.pg-home__skeleton { display: flex; flex-direction: column; align-items: center; gap: var(--sp-6); padding: var(--sp-8) 0; }
.pg-home__skeletontip { color: var(--ink-2); font-size: var(--fs-13); }
.pg-home__error { margin-top: var(--sp-6); }
.pg-home__retry { margin-top: var(--sp-3); }
.pg-home__notice {
  margin-top: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--sea);
  border-radius: var(--radius-12);
  background: var(--sea-soft);
  color: var(--ink);
  font-size: var(--fs-13);
}

/* 右栏 */
.pg-home__railcard {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-16);
  background: var(--sheet);
}

@keyframes pg-home-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
</style>
