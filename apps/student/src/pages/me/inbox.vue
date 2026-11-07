<script setup lang="ts">
/**
 * 我的反馈（小方信箱，15 号文档 §7）：列表 → 对话。开发者的回复、处理进度、被确认复现的庆祝都在这里。
 * ?id= 直接打开某一条。红点来自列表的 unread；打开一条即已读。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { ApiError, errorMessage, getMyFeedback, listMyFeedback, replyMyFeedback } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import { applyApiOverride } from '@/components/path/openPractice'
import MeSubHeader from '@/components/me/MeSubHeader.vue'
import TagChip from '@/components/TagChip.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgCelebration from '@/components/ui/PgCelebration.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { FBBOX_COPY, FBBOX_KIND_LABEL } from '@/copy/feedbackbox'
import { openFeedbackSheet, setUnread } from '@/feedbackbox/store'
import { FBBOX_MAX, canReply, refLabel, statusLabelOf, statusToneOf, timeAgo } from '@/feedbackbox/logic'
import { playSfx } from '@/motion/sfx'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import type { FeedbackListItem, FeedbackThread } from '@/types/feedbackbox'

const prefs = useFeedbackPrefs()

const phase = ref<'loading' | 'ready' | 'failed'>('loading')
const items = ref<FeedbackListItem[]>([])
const thread = ref<FeedbackThread | null>(null)
const threadPhase = ref<'idle' | 'loading' | 'failed'>('idle')
const reply = ref('')
const replying = ref(false)
const replyError = ref('')
const celebrate = ref<'confirmed' | 'resolved' | null>(null)
let wantedId: string | null = null

async function loadList(): Promise<void> {
  phase.value = 'loading'
  try {
    const data = await listMyFeedback()
    items.value = data.items
    setUnread(data.unread)
    phase.value = 'ready'
  } catch {
    phase.value = 'failed'
  }
}

async function openThread(id: string): Promise<void> {
  threadPhase.value = 'loading'
  replyError.value = ''
  try {
    const data = await getMyFeedback(id)
    thread.value = data
    threadPhase.value = 'idle'
    // 打开即已读：列表里这条的红点同步熄掉，总数跟着减。
    items.value = items.value.map((i) => (i.id === id ? { ...i, unread: false } : i))
    setUnread(items.value.filter((i) => i.unread).length)
    // 一次性庆祝：小方欢呼、撒花和音效由 PgCelebration 按手感开关决定。
    if (data.event) celebrate.value = data.event
  } catch {
    threadPhase.value = 'failed'
  }
}

function closeThread(): void {
  thread.value = null
  threadPhase.value = 'idle'
  reply.value = ''
  replyError.value = ''
  void loadList()
}

async function sendReply(): Promise<void> {
  const current = thread.value
  const text = reply.value.trim()
  if (!current || replying.value) return
  if (!text) {
    replyError.value = FBBOX_COPY.empty
    return
  }
  replying.value = true
  replyError.value = ''
  try {
    const message = await replyMyFeedback(current.id, text)
    thread.value = {
      ...current,
      status: current.status === 'need_info' || current.status === 'resolved' ? 'open' : current.status,
      messages: [...current.messages, message],
    }
    reply.value = ''
    playSfx('tap')
  } catch (e) {
    replyError.value = e instanceof ApiError && e.code === 'FEEDBACK_CLOSED' ? FBBOX_COPY.replyClosed : errorMessage(e) || FBBOX_COPY.replyFailed
    if (e instanceof ApiError && e.code === 'FEEDBACK_CLOSED') thread.value = { ...current, status: 'closed' }
  } finally {
    replying.value = false
  }
}

function goBadges(): void {
  celebrate.value = null
  uni.navigateTo({ url: '/pages/me/badges' })
}

onLoad((q) => {
  applyApiOverride(q)
  wantedId = typeof q?.id === 'string' ? q.id : null
})
onShow(async () => {
  if (thread.value) return
  await loadList()
  if (wantedId) {
    const id = wantedId
    wantedId = null
    await openThread(id)
  }
})

const needInfo = computed(() => thread.value?.status === 'need_info')
const replyable = computed(() => (thread.value ? canReply(thread.value.status) : false))
const quiet = computed(() => !prefs.motionEnabled.value)
</script>

<template>
  <AppShell active="me">
    <view class="pg-inbox" data-testid="inbox-page">
      <!-- 对话 -->
      <template v-if="thread || threadPhase !== 'idle'">
        <view class="pg-inbox__bar">
          <PgButton variant="ghost" size="icon" aria-label="返回" data-testid="inbox-thread-back" @tap="closeThread"><PgIcon name="back" :size="26" /></PgButton>
          <text class="pg-inbox__title">{{ thread ? FBBOX_COPY.threadTitle(refLabel(thread.refNo)) : FBBOX_COPY.inboxTitle }}</text>
        </view>

        <PgSkeleton v-if="threadPhase === 'loading'" variant="block" :count="2" height="72px" />
        <PgEmpty v-else-if="threadPhase === 'failed'" :title="FBBOX_COPY.inboxLoadFailed" expr="oops" :motion="null" :size="88" :action="FBBOX_COPY.inboxRetry" action-testid="inbox-thread-retry" @action="closeThread" />

        <template v-else-if="thread">
          <view class="pg-inbox__chips">
            <TagChip :tone="statusToneOf(thread.status)" data-testid="inbox-status">{{ statusLabelOf(thread.status, thread.closeReason) }}</TagChip>
            <TagChip tone="neutral">{{ FBBOX_KIND_LABEL[thread.kind] }}</TagChip>
            <TagChip v-if="thread.confirmed" tone="fox" data-testid="inbox-confirmed">{{ FBBOX_COPY.confirmedTag }}</TagChip>
          </view>

          <PgCard v-if="needInfo" tone="fox" data-testid="inbox-needinfo"><text class="pg-inbox__banner">{{ FBBOX_COPY.replyNeedInfo }}</text></PgCard>

          <view class="pg-inbox__thread pg-stagger" data-testid="inbox-messages">
            <view v-for="m in thread.messages" :key="m.id" class="pg-inbox__msg" :class="m.from === 'me' ? 'pg-inbox__msg--me' : 'pg-inbox__msg--dev'" :data-from="m.from">
              <PgMascot v-if="m.from === 'dev'" class="pg-inbox__avatar" expr="happy" :size="34" />
              <view class="pg-inbox__bubble">
                <text class="pg-inbox__who">{{ m.from === 'me' ? FBBOX_COPY.fromMe : FBBOX_COPY.fromDev }} · {{ timeAgo(m.createdAt) }}</text>
                <text class="pg-inbox__body">{{ m.body }}</text>
              </view>
            </view>
            <text v-if="thread.messages.length === 1 && thread.status !== 'closed'" class="pg-inbox__wait">{{ FBBOX_COPY.threadEmpty }}</text>
          </view>

          <view v-if="replyable" class="pg-inbox__reply">
            <textarea v-model="reply" class="pg-input-area pg-input-area--sm" data-testid="inbox-reply" :maxlength="FBBOX_MAX" :placeholder="FBBOX_COPY.replyPlaceholder" />
            <text v-if="replyError" class="pg-inbox__error" role="alert" data-testid="inbox-reply-error">{{ replyError }}</text>
            <PgButton block sound="tap" data-testid="inbox-reply-send" :loading="replying" @tap="sendReply">{{ FBBOX_COPY.replySend }}</PgButton>
          </view>
          <PgCard v-else tone="soft" data-testid="inbox-closed">
            <text class="pg-inbox__banner">{{ FBBOX_COPY.replyClosed }}</text>
            <PgButton variant="secondary" block sound="tap" data-testid="inbox-write-new" @tap="openFeedbackSheet()">{{ FBBOX_COPY.writeNew }}</PgButton>
          </PgCard>
        </template>
      </template>

      <!-- 列表 -->
      <template v-else>
        <MeSubHeader :title="FBBOX_COPY.inboxTitle" />
        <view v-if="phase === 'loading'" data-testid="inbox-loading" aria-busy="true"><PgSkeleton variant="block" :count="3" height="88px" /></view>
        <view v-else-if="phase === 'failed'" data-testid="inbox-error" role="alert">
          <PgEmpty :title="FBBOX_COPY.inboxLoadFailed" expr="oops" :motion="null" :size="88" :action="FBBOX_COPY.inboxRetry" action-testid="inbox-retry" @action="loadList" />
        </view>
        <PgEmpty v-else-if="items.length === 0" :title="FBBOX_COPY.inboxEmptyTitle" :body="FBBOX_COPY.inboxEmptyBody" expr="think" :size="104" :action="FBBOX_COPY.writeNew" action-testid="inbox-empty-write" @action="openFeedbackSheet()" />
        <view v-else class="pg-inbox__list pg-stagger" data-testid="inbox-list">
          <PgCard v-for="item in items" :key="item.id" lip class="pg-inbox__item pg-press" role="button" tabindex="0" data-testid="inbox-item" :data-unread="item.unread ? 'true' : 'false'" @tap="openThread(item.id)" @keydown.enter.prevent="openThread(item.id)">
            <view class="pg-inbox__row">
              <TagChip :tone="statusToneOf(item.status)">{{ statusLabelOf(item.status, item.closeReason) }}</TagChip>
              <TagChip v-if="item.confirmed" tone="fox">{{ FBBOX_COPY.confirmedTag }}</TagChip>
              <text class="pg-inbox__ref">{{ refLabel(item.refNo) }} · {{ timeAgo(item.lastActivityAt) }}</text>
              <view v-if="item.unread" class="pg-inbox__dot" data-testid="inbox-unread-dot" aria-label="有新回复" />
            </view>
            <text class="pg-inbox__preview" :class="{ 'pg-inbox__preview--unread': item.unread }">{{ item.preview }}</text>
            <text v-if="item.lastReply" class="pg-inbox__reply-preview">{{ FBBOX_COPY.fromDev }}：{{ item.lastReply }}</text>
          </PgCard>
        </view>
      </template>
    </view>

    <PgCelebration
      :open="celebrate !== null"
      :title="celebrate === 'confirmed' ? FBBOX_COPY.celebrateConfirmedTitle : FBBOX_COPY.celebrateResolvedTitle"
      :quiet="quiet"
      :size="132"
    >
      <view v-if="celebrate === 'confirmed'" class="pg-inbox__medal" data-testid="inbox-medal" aria-hidden="true"><PgIcon name="bug" :size="38" /></view>
      <text class="pg-inbox__celebrate">{{ celebrate === 'confirmed' ? FBBOX_COPY.celebrateConfirmedBody : FBBOX_COPY.celebrateResolvedBody }}</text>
      <template #actions>
        <PgButton v-if="celebrate === 'confirmed'" block sound="tap" data-testid="inbox-medal-badges" @tap="goBadges">{{ FBBOX_COPY.badgeAction }}</PgButton>
        <PgButton :variant="celebrate === 'confirmed' ? 'secondary' : 'primary'" block sound="tap" data-testid="celebration-close" @tap="celebrate = null">{{ FBBOX_COPY.celebrateAction }}</PgButton>
      </template>
    </PgCelebration>
  </AppShell>
</template>

<style scoped>
.pg-inbox { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-inbox__bar { display: flex; align-items: center; gap: var(--sp-1); min-height: var(--touch); }
.pg-inbox__title { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-inbox__chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.pg-inbox__banner { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); line-height: 1.5; }
.pg-inbox__list { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-inbox__item { display: flex; flex-direction: column; gap: var(--sp-2); cursor: pointer; }
.pg-inbox__row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.pg-inbox__ref { flex: 1; min-width: 0; color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); font-variant-numeric: tabular-nums; }
.pg-inbox__dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--bee); box-shadow: 0 0 0 3px var(--bee-soft); animation: pg-pop var(--dur-base) var(--ease-spring) both; }
.pg-inbox__preview { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-bold); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pg-inbox__preview--unread { font-weight: var(--fw-black); }
.pg-inbox__reply-preview { color: var(--sea-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.45; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.pg-inbox__thread { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-inbox__msg { display: flex; align-items: flex-end; gap: var(--sp-2); min-width: 0; }
.pg-inbox__msg--me { justify-content: flex-end; }
.pg-inbox__avatar { margin-bottom: 2px; }
.pg-inbox__bubble { display: flex; flex-direction: column; gap: 4px; max-width: 82%; min-width: 0; padding: var(--sp-3) var(--sp-4); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); background: var(--paper); }
.pg-inbox__msg--me .pg-inbox__bubble { border-color: var(--accent); background: var(--accent-soft); border-bottom-right-radius: var(--radius-4, 4px); }
.pg-inbox__msg--dev .pg-inbox__bubble { border-color: var(--sea); background: var(--sea-soft); border-bottom-left-radius: var(--radius-4, 4px); }
.pg-inbox__who { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
.pg-inbox__msg--dev .pg-inbox__who { color: var(--sea-text); }
.pg-inbox__body { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); white-space: pre-wrap; word-break: break-word; }
.pg-inbox__wait { color: var(--ink-2); font-size: var(--fs-13); text-align: center; line-height: 1.5; }
.pg-inbox__reply { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-inbox__error { color: var(--fox-text); font-size: var(--fs-13); line-height: 1.5; }

.pg-inbox__medal {
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  /* 红色奖章：红只在这一处用于奖励（02 §0、15 §5） */
  background: var(--danger-face);
  color: var(--on-danger);
  box-shadow: 0 var(--lip) 0 var(--danger-lip);
  animation: pg-stamp 720ms var(--ease-spring) both;
}
.pg-inbox__celebrate { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-heavy); line-height: 1.5; text-align: center; }
</style>
