<script setup lang="ts">
/**
 * 小方信箱入口：悬浮的小方 + 反馈弹层（15 号文档 §6、§7）。
 * 挂在 AppShell（主标签页和「我的」子页）、做题页、出错页里；弹层和红点是模块级单例，哪里点开的都是同一个。
 * 该不该出现由 fabModeFor 决定：登录/同意前、考试模式、有弹层打开时都不出现；做题页缩成小标。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import PgSwitch from '@/components/ui/PgSwitch.vue'
import { openOverlayCount } from '@/components/ui/uiLogic'
import { FBBOX_COPY, FBBOX_QUICK_TAGS, FBBOX_WITH_LABEL } from '@/copy/feedbackbox'
import { playSfx } from '@/motion/sfx'
import { vibrate } from '@/motion/haptics'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'
import type { FeedbackKind } from '@/types/attempt'
import { FBBOX_MAX, fabModeFor, refLabel, routeOf, withItems } from './logic'
import { addQuickTag, closeFeedbackSheet, openFeedbackSheet, refreshUnread, setAttach, setBody, setKind, submitFeedback, useFeedbackBox } from './store'

const props = withDefaults(defineProps<{ route?: string; testMode?: boolean }>(), { route: undefined, testMode: false })

const HINT_KEY = 'pg.fbbox.hint.v1'
const { state, hasUnread, animate } = useFeedbackBox()
const { loggedIn, consented } = useSession()
const prefs = useFeedbackPrefs()

const route = ref(props.route ?? '')
const hintOpen = ref(false)
let hintTimer: ReturnType<typeof setTimeout> | null = null

const mode = computed(() =>
  fabModeFor({
    route: route.value,
    loggedIn: loggedIn.value,
    consented: consented.value,
    testMode: props.testMode || prefs.muted.value,
    overlayOpen: openOverlayCount.value > 0,
  }),
)

const KIND_OPTIONS: ReadonlyArray<{ value: FeedbackKind; label: string; testid: string }> = [
  { value: 'bug', label: FBBOX_COPY.kindBug, testid: 'fbbox-kind-bug' },
  { value: 'idea', label: FBBOX_COPY.kindIdea, testid: 'fbbox-kind-idea' },
  { value: 'content', label: FBBOX_COPY.kindContent, testid: 'fbbox-kind-content' },
  { value: 'other', label: FBBOX_COPY.kindOther, testid: 'fbbox-kind-other' },
]

const sheetOpen = computed({
  get: () => state.open,
  set: (value: boolean) => {
    if (!value) closeFeedbackSheet()
  },
})
const kindModel = computed({ get: () => state.kind, set: (v: FeedbackKind) => setKind(v) })
const bodyModel = computed({ get: () => state.body, set: (v: string) => setBody(v) })
const attachModel = computed({ get: () => state.attach, set: (v: boolean) => setAttach(v) })
const quickTags = computed(() => FBBOX_QUICK_TAGS[state.kind])
const withLabels = computed(() => withItems(state.context).map((k) => FBBOX_WITH_LABEL[k]))
const mascotExpr = computed(() => (state.receipt ? 'happy' : state.body.trim() ? 'think' : 'idle'))
const mascotMotion = computed(() => (state.receipt ? 'hop' : state.body.trim() ? 'think-tilt' : ['breathe', 'blink']) as 'hop' | 'think-tilt' | Array<'breathe' | 'blink'>)

function readRoute(): void {
  if (props.route === undefined && typeof window !== 'undefined') route.value = routeOf(window.location.hash || window.location.pathname)
}

function dismissHint(): void {
  hintOpen.value = false
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = null
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    /* 隐私模式：下次再提示一次也无妨 */
  }
}

let hintShown = false
function maybeShowHint(): void {
  hintShown = true
  try {
    if (localStorage.getItem(HINT_KEY)) return
  } catch {
    return
  }
  hintOpen.value = true
  hintTimer = setTimeout(dismissHint, 7000)
}

function tapFab(): void {
  dismissHint()
  playSfx('tap')
  openFeedbackSheet()
}

async function send(): Promise<void> {
  if (await submitFeedback()) {
    playSfx('correct')
    vibrate('success')
    void refreshUnread()
  }
}

function openInbox(): void {
  closeFeedbackSheet()
  uni.navigateTo({ url: '/pages/me/inbox' })
}

function onVisible(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refreshUnread()
}

onMounted(() => {
  readRoute()
  void refreshUnread()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
})

// 登录信息通常比组件晚一步到：第一次变成完整入口时提示一次（之后记在本机，不再出现）。
watch(
  mode,
  (now, before) => {
    if (now === 'full' && before !== 'full' && !hintShown) maybeShowHint()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (hintTimer) clearTimeout(hintTimer)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})

// 有新回复时小方弹跳一下（动效开关关着就不动）。
const bounceKey = ref(0)
watch(
  () => state.unread,
  (now, before) => {
    if (now > before && animate.value) bounceKey.value += 1
  },
)
</script>

<template>
  <view v-if="mode !== 'hidden'" class="pg-fbfab" :class="[`pg-fbfab--${mode}`, { 'pg-fbfab--bounce': bounceKey > 0 }]" :key="bounceKey" data-testid="fbbox-host">
    <view v-if="hintOpen && mode === 'full'" class="pg-fbfab__hint" role="status" data-testid="fbbox-hint" @tap="dismissHint">
      <text>{{ FBBOX_COPY.coachmark }}</text>
    </view>
    <view class="pg-fbfab__btn pg-press" role="button" tabindex="0" :aria-label="FBBOX_COPY.fabLabel" data-testid="fbbox-fab" @tap="tapFab" @keydown.enter.prevent="tapFab">
      <PgMascot :expr="hasUnread ? 'happy' : 'idle'" :motion="hasUnread ? 'hop' : ['breathe', 'blink']" :size="mode === 'mini' ? 28 : 38" />
      <view v-if="hasUnread" class="pg-fbfab__dot" data-testid="fbbox-dot" :aria-label="`${state.unread} 条新动静`">
        <text>{{ state.unread > 9 ? '9+' : state.unread }}</text>
      </view>
    </view>
  </view>

  <PgSheet v-model:open="sheetOpen" data-testid="fbbox-sheet" :persistent="state.sending">
    <view class="pg-fbsheet">
      <view class="pg-fbsheet__head">
        <PgMascot :expr="mascotExpr" :motion="mascotMotion" :size="56" />
        <text class="pg-fbsheet__title">{{ state.receipt ? FBBOX_COPY.sent : FBBOX_COPY.sheetTitle }}</text>
      </view>

      <template v-if="state.receipt">
        <text class="pg-fbsheet__ok" data-testid="fbbox-receipt">{{ FBBOX_COPY.sentRef(refLabel(state.receipt.refNo)) }}</text>
        <text class="pg-fbsheet__hint">{{ FBBOX_COPY.sentHint }}</text>
        <PgButton block sound="tap" data-testid="fbbox-to-inbox" @tap="openInbox">{{ FBBOX_COPY.sentAction }}</PgButton>
        <PgButton block variant="secondary" sound="tap" data-testid="fbbox-close" @tap="closeFeedbackSheet">{{ FBBOX_COPY.sentClose }}</PgButton>
      </template>

      <template v-else>
        <PgSegmented v-model="kindModel" :options="KIND_OPTIONS" :label="FBBOX_COPY.kindLabel" />
        <view class="pg-fbsheet__tags" data-testid="fbbox-tags">
          <view v-for="tag in quickTags" :key="tag" class="pg-fbsheet__tag pg-press" role="button" tabindex="0" data-testid="fbbox-tag" @tap="addQuickTag(tag)" @keydown.enter.prevent="addQuickTag(tag)">
            <text>{{ tag }}</text>
          </view>
        </view>
        <textarea v-model="bodyModel" class="pg-input-area" data-testid="fbbox-body" :maxlength="FBBOX_MAX" :placeholder="FBBOX_COPY.placeholder" :aria-label="FBBOX_COPY.bodyLabel" />
        <text v-if="state.draftRestored" class="pg-fbsheet__hint" data-testid="fbbox-draft">{{ FBBOX_COPY.draftKept }}</text>

        <PgCard tone="soft" class="pg-fbsheet__with" data-testid="fbbox-with">
          <view class="pg-fbsheet__withrow">
            <view class="pg-fbsheet__withtext">
              <text class="pg-fbsheet__withtitle">{{ FBBOX_COPY.withTitle }}</text>
              <text class="pg-fbsheet__withitems">{{ state.attach && withLabels.length ? withLabels.join(' · ') : FBBOX_COPY.withNone }}</text>
            </view>
            <PgSwitch v-model="attachModel" :label="FBBOX_COPY.withToggle" data-testid="fbbox-attach" />
          </view>
        </PgCard>

        <text v-if="state.error" class="pg-fbsheet__error" role="alert" data-testid="fbbox-error">{{ state.error }}</text>
        <PgButton block sound="tap" data-testid="fbbox-send" :loading="state.sending" @tap="send">{{ FBBOX_COPY.send }}</PgButton>
      </template>
    </view>
  </PgSheet>
</template>

<style scoped>
.pg-fbfab {
  position: fixed;
  right: max(var(--sp-3), var(--safe-right));
  bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--sp-3));
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--sp-2);
  animation: pg-pop var(--dur-slow) var(--ease-spring) both;
}
.pg-fbfab--bounce { animation: pg-fbfab-hop 620ms var(--ease-spring) both; }
/* 做题页没有标签栏：缩成小标，放在顶栏下面，不挡底部的输入区和求助 */
.pg-fbfab--mini {
  bottom: auto;
  top: calc(var(--safe-top) + 64px);
}
@media (min-width: 600px) {
  .pg-fbfab { bottom: var(--sp-6); right: var(--sp-6); }
  .pg-fbfab--mini { bottom: auto; top: calc(var(--safe-top) + 72px); }
}
.pg-fbfab__btn {
  position: relative;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--bw) solid var(--rule);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: 0 var(--lip) 0 var(--rule);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.pg-fbfab--mini .pg-fbfab__btn { width: 40px; height: 40px; }
.pg-fbfab__btn:active { transform: translateY(var(--lip)); box-shadow: none; }
.pg-fbfab__dot {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--bw) solid var(--paper);
  border-radius: var(--radius-pill);
  background: var(--bee);
  color: var(--on-bee);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
  line-height: 1;
  animation: pg-pop var(--dur-base) var(--ease-spring) both;
}
.pg-fbfab__hint {
  position: relative;
  max-width: 220px;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--sea);
  border-radius: var(--radius-16);
  background: var(--sea-soft);
  color: var(--sea-text);
  font-size: var(--fs-13);
  font-weight: var(--fw-heavy);
  line-height: 1.4;
  animation: pg-item-in var(--dur-base) var(--ease-out) both;
}
.pg-fbfab__hint::after {
  content: '';
  position: absolute;
  right: 20px;
  bottom: -7px;
  width: 12px;
  height: 12px;
  border-right: var(--bw) solid var(--sea);
  border-bottom: var(--bw) solid var(--sea);
  background: var(--sea-soft);
  transform: rotate(45deg);
}
@keyframes pg-fbfab-hop {
  0% { transform: translateY(0); }
  35% { transform: translateY(-14px) scale(1.06); }
  70% { transform: translateY(0) scale(0.97); }
  100% { transform: none; }
}

.pg-fbsheet { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-fbsheet__head { display: flex; align-items: center; gap: var(--sp-3); }
.pg-fbsheet__title { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-fbsheet__ok { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-heavy); line-height: 1.5; }
.pg-fbsheet__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-fbsheet__tags { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.pg-fbsheet__tag {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-13);
  font-weight: var(--fw-heavy);
  cursor: pointer;
}
.pg-fbsheet__tag:active { background: var(--accent-soft); border-color: var(--accent); }
.pg-fbsheet__with { display: flex; flex-direction: column; }
.pg-fbsheet__withrow { display: flex; align-items: center; gap: var(--sp-3); }
.pg-fbsheet__withtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-fbsheet__withtitle { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
.pg-fbsheet__withitems { color: var(--ink); font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.4; }
.pg-fbsheet__error { color: var(--fox-text); font-size: var(--fs-13); line-height: 1.5; }
</style>
