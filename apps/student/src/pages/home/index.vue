<script setup lang="ts">
/**
 * 首页（02 §4.2；issue #24）：真实模式 GET /student/home 驱动。
 *
 * - todo：open 可「开始」；scheduled / closed / cancelled 禁用并说明原因；
 * - inProgress：有 attempt 的进行中 → 「继续」；
 * - done：已完成 → 「查看」（证明本）+「加入证明本」；reviewPublished=true 时显示「讲评已发布」入口；
 * - 空态 / 加载骨架 / 错误 + 重试；弱网自动重试（client 内 withRetry）后仍失败可手动重试；
 * - week / notebook 契约里可选，缺省时 UI 降级（不假装有数据）。
 *
 * mock 模式（默认）返回与契约一致的 StudentHome（见 api/client.ts mockHome）；
 * 演示/联调可加 ?api=real 强制走真实接口（e2e 弱网用例用）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  cardLayerLabel,
  errorMessage,
  fetchHome,
  isMockMode,
  setMockMode,
  type HomeData,
} from '@/api/client'
import type { AssignmentCardView } from '@/types/attempt'
import OfflineBar from '@/components/OfflineBar.vue'
import { initIntegrity } from '@/integrity/sdk'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { maskStudentNo, useSession } from '@/stores/session'

const session = useSession()

/** #27：离线提示条的重试（事件队列立刻补发一次；mock 下等同成功）。 */
async function handleOfflineRetry(): Promise<void> {
  await initIntegrity().flush('manual')
}
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
  // #145 年龄门：Me.ageBand=null → 年龄选择页；lt14 → 暂不开通（守卫内重定向）。
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

const greeting = computed(
  () => home.value?.greeting ?? (session.studentNo.value ? '你好，' + maskStudentNo(session.studentNo.value) : '同学，你好'),
)

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
  if (card.status === 'scheduled') return card.openAt ? '未开始 · ' + formatTime(card.openAt) + ' 后开放' : '未开始，等老师开放'
  if (card.status === 'closed') return '已关闭，不能再作答'
  if (card.status === 'cancelled') return '已取消'
  return '暂不可开始'
}

function formatTime(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 进入做题页：有 attempt 用 attemptId 断线重连，否则用 assignmentId 开始/恢复（服务端幂等）。 */
function goPractice(card: AssignmentCardView): void {
  if (!isOpen(card)) return
  const query = card.attemptId
    ? '?attemptId=' + encodeURIComponent(card.attemptId)
    : '?assignmentId=' + encodeURIComponent(card.assignmentId)
  uni.navigateTo({ url: '/pages/practice/index' + query })
}

function goProofbook(): void {
  uni.navigateTo({ url: '/pages/proofbook/index' })
}

/** 讲评入口（仅在 reviewPublished=true 时出现）：讲评页面由教师端 #102 提供，这里先给明确提示。 */
function openReview(card: AssignmentCardView): void {
  showNotice('讲评已发布：《' + card.title + '》的讲评内容将在教师端讲评页面（#102）查看')
}

function addToNotebook(card: AssignmentCardView): void {
  showNotice('已加入证明本：《' + card.title + '》（真实写接口待 B #74 提供）')
}
</script>

<template>
  <view class="pg-page pg-home" data-testid="home-page">
    <!-- #27 离线提示条：正常文档流，不遮 44px 操作区 -->
    <OfflineBar @retry="handleOfflineRetry" />
    <view class="pg-home__head">
      <text class="pg-home__hello" data-testid="home-greeting">{{ greeting }}</text>
      <text v-if="home?.week" class="pg-home__stat pg-small" data-testid="home-week">
        本周你自己写出了 {{ home.week.keysOwn }} 个关键步骤（共 {{ home.week.keysTotal }} 个）
      </text>
      <text v-else class="pg-home__stat pg-small" data-testid="home-week-empty">本周统计暂不可用（服务端未下发 week）</text>
      <view class="pg-home__headrow">
        <button class="pg-home__book pg-small" role="button" data-testid="home-proofbook" @tap="goProofbook">证明本</button>
        <text v-if="mockMode" class="pg-home__mode pg-small" data-testid="home-mock-badge">mock 演示（?api=real 走真实接口）</text>
      </view>
    </view>

    <view v-if="slow" class="pg-home__slow pg-small" role="status" data-testid="home-slow">
      网络较慢，正在自动重试…（你的内容不会丢）
    </view>

    <view v-if="loading" class="pg-home__skeleton pg-sheet" data-testid="home-loading" aria-busy="true">
      <view class="pg-home__line" /><view class="pg-home__line" /><view class="pg-home__line" />
      <text class="pg-home__skeletontip pg-small">{{ retrying ? '正在重试…' : '正在加载首页…' }}</text>
    </view>

    <view v-else-if="error" class="pg-home__error pg-sheet" data-testid="home-error" role="alert">
      <text class="pg-home__errortitle">首页加载失败</text>
      <text class="pg-home__errorbody pg-small">{{ error }}</text>
      <button class="pg-home__btn pg-home__btn--primary" role="button" data-testid="home-retry" :disabled="retrying" @tap="loadHome(true)">
        {{ retrying ? '正在重试…' : '重试' }}
      </button>
    </view>

    <template v-else-if="home">
      <!-- 进行中 -->
      <text class="pg-home__section">进行中</text>
      <view v-if="home.inProgress.length === 0" class="pg-home__empty pg-small" data-testid="home-inprogress-empty">
        暂无进行中的题，从下面「待完成」开始一道。
      </view>
      <view
        v-for="(card, i) in home.inProgress"
        :key="card.assignmentId"
        class="pg-home__card pg-sheet"
        data-testid="home-inprogress-card"
        :data-assignment-id="card.assignmentId"
      >
        <view class="pg-home__cardmain">
          <text class="pg-home__cardtitle">{{ card.title }}</text>
          <text class="pg-home__cardsub pg-small">{{ card.chapter ?? '' }} · {{ cardLayerLabel(card) }} · {{ card.mode === 'test' ? '测验' : '练习' }}</text>
        </view>
        <button class="pg-home__btn" role="button" :data-testid="'home-continue-' + i" @tap="goPractice(card)">继续</button>
      </view>

      <!-- 待完成：scheduled/closed 禁用并说明 -->
      <text class="pg-home__section">待完成</text>
      <view v-if="home.todo.length === 0" class="pg-home__empty pg-small" data-testid="home-todo-empty">
        暂时没有待完成的布置。
      </view>
      <view
        v-for="(card, i) in home.todo"
        :key="card.assignmentId"
        class="pg-home__card pg-sheet"
        data-testid="home-todo-card"
        :data-assignment-id="card.assignmentId"
        :data-status="card.status"
      >
        <view class="pg-home__cardmain">
          <text class="pg-home__cardtitle">{{ card.title }}</text>
          <text class="pg-home__cardsub pg-small">{{ card.chapter ?? '' }} · {{ cardLayerLabel(card) }} · {{ card.mode === 'test' ? '测验' : '练习' }}</text>
          <text v-if="!isOpen(card)" class="pg-home__cardsub pg-small pg-home__disabledreason" :data-testid="'home-todo-reason-' + i">
            {{ disabledReason(card) }}
          </text>
        </view>
        <button
          v-if="isOpen(card)"
          class="pg-home__btn pg-home__btn--primary"
          role="button"
          :data-testid="'home-todo-start-' + i"
          @tap="goPractice(card)"
        >
          {{ card.attemptId ? '继续' : '开始' }}
        </button>
        <button
          v-else
          class="pg-home__btn pg-home__btn--disabled"
          role="button"
          disabled
          :data-testid="'home-todo-disabled-' + i"
        >
          {{ card.status === 'scheduled' ? '未开始' : '已关闭' }}
        </button>
      </view>

      <!-- 已完成 -->
      <text class="pg-home__section">已完成</text>
      <view v-if="home.done.length === 0" class="pg-home__empty pg-small" data-testid="home-done-empty">
        还没有完成的题，完成后会出现在这里。
      </view>
      <view
        v-for="(card, i) in home.done"
        :key="card.assignmentId"
        class="pg-home__card pg-sheet pg-home__card--done"
        data-testid="home-done-card"
        :data-assignment-id="card.assignmentId"
      >
        <view class="pg-home__cardmain">
          <text class="pg-home__cardtitle">{{ card.title }}</text>
          <text class="pg-home__cardsub pg-small">{{ card.chapter ?? '' }} · {{ cardLayerLabel(card) }} · {{ card.mode === 'test' ? '测验' : '练习' }}</text>
          <text v-if="card.reviewPublished" class="pg-home__reviewbadge" :data-testid="'home-done-reviewbadge-' + i">讲评已发布</text>
        </view>
        <view class="pg-home__actions">
          <button class="pg-home__btn pg-home__btn--small" role="button" :data-testid="'home-done-view-' + i" @tap="goProofbook">查看</button>
          <button class="pg-home__btn pg-home__btn--small" role="button" :data-testid="'home-done-notebook-' + i" @tap="addToNotebook(card)">加入证明本</button>
          <button
            v-if="card.reviewPublished"
            class="pg-home__btn pg-home__btn--small pg-home__btn--primary"
            role="button"
            :data-testid="'home-done-review-' + i"
            @tap="openReview(card)"
          >
            看讲评
          </button>
        </view>
      </view>

      <!-- 证明本摘要：契约可选字段，缺省时降级 -->
      <view class="pg-home__notebook pg-sheet" data-testid="home-notebook">
        <text class="pg-home__cardtitle">证明本</text>
        <text v-if="home.notebook" class="pg-home__cardsub pg-small" data-testid="home-notebook-summary">
          已收录 {{ home.notebook.cards }} 份证明 · {{ home.notebook.toRedo }} 题待重做
        </text>
        <text v-else class="pg-home__cardsub pg-small" data-testid="home-notebook-empty">
          证明本摘要暂不可用（服务端未下发 notebook），可以先点上方「证明本」打开。
        </text>
      </view>
    </template>

    <view v-if="notice" class="pg-home__notice pg-small" role="status" data-testid="home-notice">{{ notice }}</view>

    <text class="pg-home__hint pg-small">
      {{ mockMode ? '当前 mock 模式：数据形状与契约 StudentHome 一致；加 ?api=real 可走真实接口。' : '数据来自服务端 GET /student/home 与 GET /me；弱网会自动重试。' }}
    </text>
  </view>
</template>

<style scoped>
.pg-home { padding-top: calc(var(--safe-top) + var(--sp-4)); padding-bottom: calc(var(--sp-6) + var(--safe-bottom)); }
.pg-home__head { display: flex; flex-direction: column; gap: var(--sp-1); margin-bottom: var(--sp-4); }
.pg-home__headrow { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.pg-home__hello { font-family: var(--font-serif); font-size: 22px; font-weight: 600; }
.pg-home__stat { color: var(--ink-2); }
.pg-home__book { min-height: 36px; padding: 0 var(--sp-3); border: 1px solid var(--rule); border-radius: 999px; background: transparent; color: var(--ink-2); }
.pg-home__mode { color: var(--ink-2); }
.pg-home__slow { padding: var(--sp-1) var(--sp-2); border-radius: var(--radius-input); background: var(--hint-soft); color: var(--ink); margin-bottom: var(--sp-2); }
.pg-home__section { display: block; margin: var(--sp-4) 0 var(--sp-2); font-family: var(--font-serif); font-size: 16px; font-weight: 600; color: var(--ink); }
.pg-home__card { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3); margin-bottom: var(--sp-2); min-width: 0; }
.pg-home__cardmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-home__cardtitle { font-size: 15px; color: var(--ink); }
.pg-home__cardsub { color: var(--ink-2); }
.pg-home__disabledreason { color: var(--hint); }
.pg-home__card--done { align-items: flex-start; flex-wrap: wrap; }
.pg-home__actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.pg-home__reviewbadge { align-self: flex-start; padding: 1px var(--sp-2); border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; }
.pg-home__btn {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.2;
}
.pg-home__btn--small { min-height: 36px; font-size: 13px; padding: 0 var(--sp-2); }
.pg-home__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.pg-home__btn--disabled { opacity: 0.45; }
.pg-home__empty { color: var(--ink-2); padding: var(--sp-2) 0; }
.pg-home__notebook { padding: var(--sp-3); margin-top: var(--sp-3); display: flex; flex-direction: column; gap: 2px; }
.pg-home__skeleton { padding: var(--sp-3); }
.pg-home__skeletontip { color: var(--ink-2); }
.pg-home__line { height: 16px; border-radius: 4px; background: var(--paper); margin: var(--sp-2) 0; }
.pg-home__error { padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-home__errortitle { font-family: var(--font-serif); font-weight: 600; color: var(--ink); }
.pg-home__errorbody { color: var(--ink-2); }
.pg-home__notice { margin-top: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-left: 3px solid var(--accent); border-radius: 0 var(--radius-input) var(--radius-input) 0; background: var(--accent-soft); color: var(--ink); }
.pg-home__hint { display: block; margin-top: var(--sp-4); color: var(--ink-2); text-align: center; }
</style>
