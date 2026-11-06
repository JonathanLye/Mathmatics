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
import WechatHint from '@/components/WechatHint.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
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

/** 路径节点的蛇形偏移（px）：循环 0 → 右 → 中右 → 左 → 中左。 */
const OFFSETS = [0, 64, 36, -36, -64, -36]
function nodeStyle(i: number): Record<string, string> {
  return { transform: 'translateX(' + OFFSETS[i % OFFSETS.length] + 'px)' }
}

/** 顶部横幅显示的章：进行中的第一题，否则第一个待做，否则第一个已完成。 */
const unitChapter = computed(() => {
  const h = home.value
  const card = h?.inProgress[0] ?? h?.todo[0] ?? h?.done[0]
  return card?.chapter ?? '我的练习'
})

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
    <!-- #37 微信内打开提示：非阻塞横条，非微信 UA 不渲染 -->
    <WechatHint />

    <view class="pg-home__stats">
      <view v-if="home" class="pg-home__chip pg-home__chip--bee" data-testid="home-done-count">
        <PgIcon name="qed" :size="22" color="#ffc800" />{{ home.done.length }}<text class="pg-home__chipsub">题</text>
      </view>
      <view v-if="home?.week" class="pg-home__chip pg-home__chip--grass" data-testid="home-week">
        <PgIcon name="check" :size="20" />{{ home.week.keysOwn }}/{{ home.week.keysTotal }}<text class="pg-home__chipsub">本周自己写出的关键步骤</text>
      </view>
    </view>
    <text class="pg-home__hello" data-testid="home-greeting">{{ greeting }}</text>
    <text v-if="mockMode" class="pg-home__mode pg-small" data-testid="home-mock-badge">mock 演示（?api=real 走真实接口）</text>

    <view class="pg-home__unit">
      <view class="pg-home__unitmain">
        <text class="pg-home__unitkick">当前章节</text>
        <text class="pg-home__unittitle">{{ unitChapter }}</text>
      </view>
      <view class="pg-home__unitbook"><PgIcon name="book" :size="24" /></view>
    </view>

    <view v-if="slow" class="pg-home__slow pg-small" role="status" data-testid="home-slow">
      网络较慢，正在自动重试…（你的内容不会丢）
    </view>

    <view v-if="loading" class="pg-home__skeleton" data-testid="home-loading" aria-busy="true">
      <view class="pg-home__ghost" style="transform: translateX(36px)" />
      <view class="pg-home__ghost" style="transform: translateX(-36px)" />
      <view class="pg-home__ghost" style="transform: translateX(36px)" />
      <text class="pg-home__skeletontip pg-small">{{ retrying ? '正在重试…' : '正在加载首页…' }}</text>
    </view>

    <view v-else-if="error" class="pg-home__error" data-testid="home-error" role="alert">
      <PgMascot expr="oops" :size="88" />
      <text class="pg-home__errortitle">首页加载失败</text>
      <text class="pg-home__errorbody pg-small">{{ error }}</text>
      <button class="pg-btn" role="button" data-testid="home-retry" :disabled="retrying" @tap="loadHome(true)">
        {{ retrying ? '正在重试…' : '重试' }}
      </button>
    </view>

    <view v-else-if="home" class="pg-home__path">
      <!-- 进行中：绿色大节点 + 浮动“继续”气泡 -->
      <view
        v-for="(card, i) in home.inProgress"
        :key="card.assignmentId"
        class="pg-home__node pg-home__node--cur"
        :style="nodeStyle(i)"
        data-testid="home-inprogress-card"
        :data-assignment-id="card.assignmentId"
      >
        <button class="pg-home__go" role="button" :data-testid="'home-continue-' + i" @tap="goPractice(card)">继续</button>
        <view class="pg-home__face pg-home__face--cur" @tap="goPractice(card)"><PgIcon name="pen" :size="40" /></view>
        <view class="pg-home__label">
          <text class="pg-home__cardtitle">{{ card.title }}</text>
          <text class="pg-home__cardsub">{{ card.chapter ?? '' }} · {{ cardLayerLabel(card) }} · {{ card.mode === 'test' ? '测验' : '练习' }}</text>
        </view>
        <view v-if="i === 0" class="pg-home__mascot"><PgMascot expr="idle" :size="84" /></view>
      </view>
      <view v-if="home.inProgress.length === 0" class="pg-home__empty pg-small" data-testid="home-inprogress-empty">
        <text class="pg-home__emptytext">暂无进行中的题，从下面「待完成」开始一道。</text>
      </view>

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
        <button
          v-if="isOpen(card)"
          class="pg-home__face pg-home__face--todo"
          role="button"
          :aria-label="(card.attemptId ? '继续 ' : '开始 ') + card.title"
          :data-testid="'home-todo-start-' + i"
          @tap="goPractice(card)"
        >
          <PgIcon name="book" :size="34" />
        </button>
        <button
          v-else
          class="pg-home__face pg-home__face--off"
          role="button"
          disabled
          :aria-label="(card.status === 'scheduled' ? '未开始 ' : '已关闭 ') + card.title"
          :data-testid="'home-todo-disabled-' + i"
        >
          <PgIcon name="lock" :size="30" />
        </button>
        <view class="pg-home__label">
          <text class="pg-home__cardtitle">{{ card.title }}</text>
          <text class="pg-home__cardsub">{{ card.chapter ?? '' }} · {{ cardLayerLabel(card) }} · {{ card.mode === 'test' ? '测验' : '练习' }}</text>
          <text v-if="!isOpen(card)" class="pg-home__cardsub pg-home__disabledreason" :data-testid="'home-todo-reason-' + i">
            {{ disabledReason(card) }}
          </text>
        </view>
      </view>
      <view v-if="home.todo.length === 0" class="pg-home__empty pg-small" data-testid="home-todo-empty">
        <text class="pg-home__emptytext">暂时没有待完成的布置。</text>
      </view>

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
        <view class="pg-home__face pg-home__face--done" @tap="goProofbook"><PgIcon name="qed" :size="34" color="#fff" /></view>
        <view class="pg-home__label">
          <text class="pg-home__cardtitle">{{ card.title }}</text>
          <text class="pg-home__cardsub">{{ card.chapter ?? '' }} · {{ cardLayerLabel(card) }} · {{ card.mode === 'test' ? '测验' : '练习' }}</text>
          <text v-if="card.reviewPublished" class="pg-home__reviewbadge" :data-testid="'home-done-reviewbadge-' + i">讲评已发布</text>
        </view>
        <view class="pg-home__actions">
          <button class="pg-btn pg-btn--out pg-btn--sm" role="button" :data-testid="'home-done-view-' + i" @tap="goProofbook">查看</button>
          <button class="pg-btn pg-btn--out pg-btn--sm" role="button" :data-testid="'home-done-notebook-' + i" @tap="addToNotebook(card)">加入证明本</button>
          <button
            v-if="card.reviewPublished"
            class="pg-btn pg-btn--sm"
            role="button"
            :data-testid="'home-done-review-' + i"
            @tap="openReview(card)"
          >
            看讲评
          </button>
        </view>
      </view>
      <view v-if="home.done.length === 0" class="pg-home__empty" data-testid="home-done-empty">
        <PgMascot expr="idle" :size="72" />
        <text class="pg-home__emptytext">还没有完成的题，完成后会出现在这里。</text>
      </view>

      <!-- 证明本摘要：契约可选字段，缺省时降级 -->
      <view class="pg-home__notebook pg-sheet" data-testid="home-notebook">
        <text class="pg-home__cardtitle">证明本</text>
        <text v-if="home.notebook" class="pg-home__cardsub" data-testid="home-notebook-summary">
          已收录 {{ home.notebook.cards }} 份证明 · {{ home.notebook.toRedo }} 题待重做
        </text>
        <text v-else class="pg-home__cardsub" data-testid="home-notebook-empty">
          写完的证明会收进证明本，随时可以回看。点下方「证明本」打开。
        </text>
      </view>
    </view>

    <view v-if="notice" class="pg-home__notice" role="status" data-testid="home-notice">{{ notice }}</view>

    <text class="pg-home__hint pg-small">
      {{ mockMode ? '当前 mock 模式：数据形状与契约 StudentHome 一致；加 ?api=real 可走真实接口。' : '网络不稳时会自动重试。' }}
    </text>

    <view class="pg-home__nav">
      <view class="pg-home__tab pg-home__tab--on"><PgIcon name="home" :size="28" /><text>路径</text></view>
      <button class="pg-home__tab" role="button" data-testid="home-proofbook" @tap="goProofbook"><PgIcon name="book" :size="28" /><text>证明本</text></button>
    </view>
  </view>
</template>

<style scoped>
.pg-home { padding-top: calc(var(--safe-top) + var(--sp-3)); padding-bottom: calc(96px + var(--safe-bottom)); }
.pg-home__stats { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.pg-home__chip { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 var(--sp-3) 0 var(--sp-2); border-radius: var(--radius-input); font-size: 17px; font-weight: 900; color: var(--ink-2); }
.pg-home__chip--bee { color: var(--hint); }
.pg-home__chip--grass { color: var(--accent-text); }
.pg-home__chipsub { font-size: 12px; font-weight: 800; letter-spacing: 0.4px; opacity: 0.85; }
.pg-home__hello { display: block; margin: var(--sp-1) 0 var(--sp-3); font-size: 13px; font-weight: 800; color: var(--ink-2); }
.pg-home__mode { display: block; color: var(--ink-2); margin-bottom: var(--sp-2); }
.pg-home__unit { position: sticky; top: calc(var(--safe-top) + 4px); z-index: 3; display: flex; align-items: center; gap: var(--sp-3); min-height: 84px; padding: 0 var(--sp-3) 0 var(--sp-4); border-radius: 18px; background: var(--accent); color: var(--on-accent); box-shadow: 0 5px 0 var(--accent-lip); }
.pg-home__unitmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-home__unitkick { font-size: 12px; font-weight: 900; letter-spacing: 0.9px; opacity: 0.8; }
.pg-home__unittitle { font-size: 21px; font-weight: 900; line-height: 1.2; }
.pg-home__unitbook { width: 48px; height: 48px; border-radius: 14px; border: 2px solid rgba(20, 41, 10, 0.25); border-bottom-width: 4px; display: flex; align-items: center; justify-content: center; }
.pg-home__slow { margin-top: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-input); background: var(--hint-soft); color: var(--ink); font-weight: 700; }
.pg-home__path { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 36px 0 var(--sp-4); overflow-x: clip; }
.pg-home__node { position: relative; display: flex; flex-direction: column; align-items: center; width: 220px; max-width: 100%; }
.pg-home__face { width: 76px; height: 76px; border-radius: 50%; border: 0; padding: 0; display: flex; align-items: center; justify-content: center; color: var(--on-accent); }
.pg-home__face::after { display: none; }
.pg-home__face--done { background: var(--hint-fill); box-shadow: 0 8px 0 var(--hint-lip); transform: rotate(0); }
.pg-home__face--todo { background: var(--margin); color: var(--on-margin); box-shadow: 0 8px 0 var(--margin-lip); }
.pg-home__face--todo:active { transform: translateY(6px); box-shadow: 0 2px 0 var(--margin-lip); }
.pg-home__face--off,
.pg-home__face--off[disabled] { background: var(--rule); color: var(--ink-3); box-shadow: 0 8px 0 var(--ink-3); opacity: 0.85; }
.pg-home__face--cur { width: 88px; height: 88px; background: var(--accent); color: var(--on-accent); box-shadow: 0 8px 0 var(--accent-lip), 0 0 0 7px var(--accent-soft); }
.pg-home__go { margin-bottom: 14px; min-height: 40px; padding: 0 var(--sp-4); border: 2px solid var(--rule); border-bottom-width: 4px; border-radius: 14px; background: var(--sheet); color: var(--accent-text); font-size: 15px; font-weight: 900; letter-spacing: 1px; animation: pg-bob 1.6s ease-in-out 3; }
.pg-home__label { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
.pg-home__cardtitle { font-size: 16px; font-weight: 900; color: var(--ink); line-height: 1.3; }
.pg-home__cardsub { font-size: 13px; font-weight: 700; color: var(--ink-2); }
.pg-home__disabledreason { color: var(--hint); }
.pg-home__reviewbadge { margin-top: 2px; padding: 1px var(--sp-2); border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); font-size: 12px; font-weight: 900; }
.pg-home__divider { align-self: stretch; text-align: center; font-size: 12px; font-weight: 900; letter-spacing: 0.9px; color: var(--ink-3); border-top: 2px solid var(--rule); padding-top: var(--sp-3); margin-top: var(--sp-2); }
.pg-home__tab::after { display: none; }
.pg-home__actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; margin-top: var(--sp-2); }
.pg-home__mascot { position: absolute; left: 156px; top: 40px; }
.pg-home__empty { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); }
.pg-home__emptytext { font-size: 14px; font-weight: 700; color: var(--ink-2); text-align: center; }
.pg-home__notebook { width: 100%; padding: var(--sp-3); margin-top: var(--sp-3); display: flex; flex-direction: column; gap: 2px; }
.pg-home__skeleton { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 36px 0; }
.pg-home__skeletontip { color: var(--ink-2); }
.pg-home__ghost { width: 76px; height: 76px; border-radius: 50%; background: var(--rule); box-shadow: 0 8px 0 var(--ink-3); opacity: 0.5; }
.pg-home__error { margin-top: var(--sp-6); padding: var(--sp-4); display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); }
.pg-home__errortitle { font-size: 20px; font-weight: 900; color: var(--ink); }
.pg-home__errorbody { color: var(--ink-2); text-align: center; }
.pg-home__notice { margin-top: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 2px solid var(--margin); border-radius: var(--radius-input); background: var(--margin-soft); color: var(--ink); font-size: 13px; font-weight: 700; }
.pg-home__hint { display: block; margin-top: var(--sp-4); color: var(--ink-3); text-align: center; }
.pg-home__nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; justify-content: space-around; padding: 10px var(--sp-4) calc(10px + var(--safe-bottom)); background: var(--paper); border-top: 2px solid var(--rule); }
.pg-home__tab { width: 112px; min-height: 58px; border: 2px solid transparent; border-radius: 14px; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: var(--ink-3); font-size: 11px; font-weight: 900; letter-spacing: 0.6px; }
.pg-home__tab--on { background: var(--margin-soft); border-color: var(--margin); color: var(--margin-text); }
</style>
