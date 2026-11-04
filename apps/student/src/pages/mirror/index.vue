<script setup lang="ts">
/**
 * 教师镜像预览页（issue #43 A 侧 / 04 §5.1）。
 *
 * 学生端同一套数据只读渲染：
 * - 入口：C 的 mirror-token 返回 /s/mirror?attempt=…&token=…；H5 是 hash 路由，
 *   main.ts 会把路径式 URL 重定向到 #/pages/mirror/index?attempt=…&token=…（也支持直接打开 hash）。
 * - 数据：SSE GET /api/v1/teacher/attempts/{id}/stream?token=… 的 event: state（学生视图 AttemptState）+ ping。
 * - 只读：页面不渲染任何输入/按钮/求助/mock 开关；token 不出现在可见文本里（只用于请求 URL）。
 * - 回放由教师端提供，本页只展示服务端推送的最新状态，不伪造事件。
 */
import { computed, onUnmounted, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import ProofLineList from '@/components/layers/ProofLineList.vue'
import { isValidAttemptId, isValidMirrorToken } from '@/components/mirror/mirror'
import { MIRROR_BANNER, MIRROR_PLAYBACK_NOTE, buildMirrorViewModel } from '@/components/mirror/mirrorView'
import {
  buildMirrorStreamUrl,
  createMirrorStream,
  type MirrorConnectionStatus,
  type MirrorStatusDetail,
  type MirrorStreamHandle,
} from '@/components/mirror/mirrorSse'
import { useViewport } from '@/composables/useViewport'
import type { AttemptState } from '@/types/attempt'

const { mode } = useViewport()

const attemptId = ref('')
const token = ref('')
const state = ref<AttemptState | null>(null)
const initError = ref('')
const status = ref<MirrorConnectionStatus>('connecting')
const statusDetail = ref<MirrorStatusDetail>(null)
const attempts = ref(0)
let handle: MirrorStreamHandle | null = null
let beforeUnloadHandler: (() => void) | null = null

const view = computed(() => buildMirrorViewModel(state.value))
const modeClass = computed(() => 'pg-mirror--' + mode.value)
const statusText = computed(() => {
  if (initError.value) return '未连接'
  if (status.value === 'connecting') return '连接中…'
  if (status.value === 'connected') return '已连接'
  if (status.value === 'reconnecting') return '重连中…'
  return '连接失败'
})
const authSuspect = computed(() => statusDetail.value === 'auth' && status.value === 'reconnecting')

function readQueryParam(q: Record<string, unknown> | undefined, key: string): string {
  const fromQuery = q?.[key]
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery
  if (typeof window === 'undefined') return ''
  const sources = [window.location.hash, window.location.search]
  for (const source of sources) {
    const index = source.indexOf('?')
    if (index === -1) continue
    const value = new URLSearchParams(source.slice(index + 1)).get(key)
    if (value) return value
  }
  return ''
}

function cleanup(): void {
  handle?.close()
  handle = null
  if (beforeUnloadHandler && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', beforeUnloadHandler)
    beforeUnloadHandler = null
  }
}

onLoad((q) => {
  const attempt = readQueryParam(q as Record<string, unknown> | undefined, 'attempt').trim()
  const mirrorToken = readQueryParam(q as Record<string, unknown> | undefined, 'token').trim()
  attemptId.value = attempt
  token.value = mirrorToken

  if (!isValidAttemptId(attempt) || !isValidMirrorToken(mirrorToken)) {
    initError.value = '镜像链接无效或已过期：缺少合法的 attempt/token。请让老师重新打开「镜像预览」。'
    return
  }
  if (typeof EventSource === 'undefined') {
    initError.value = '当前浏览器不支持镜像预览所需的实时连接（EventSource）。请换用最新版 Chrome / Edge。'
    return
  }

  const url = buildMirrorStreamUrl(attempt, mirrorToken)
  handle = createMirrorStream({
    url,
    createEventSource: (target) => new EventSource(target),
    onState: (next) => {
      state.value = next
    },
    onStatus: (info) => {
      status.value = info.status
      statusDetail.value = info.detail
      attempts.value = info.attempts
    },
    reconnectBaseMs: 800,
    reconnectMaxMs: 8000,
    maxReconnectAttempts: 6,
    authSuspectAttempts: 2,
  })

  if (typeof window !== 'undefined') {
    beforeUnloadHandler = () => cleanup()
    window.addEventListener('beforeunload', beforeUnloadHandler)
  }
})

onUnload(cleanup)
onUnmounted(cleanup)
</script>

<template>
  <view class="pg-page pg-mirror" :class="modeClass" data-testid="mirror-page">
    <view class="pg-mirror__banner" role="status" data-testid="mirror-banner">
      <text class="pg-mirror__bannertext">{{ MIRROR_BANNER }}</text>
      <text class="pg-mirror__status pg-small" data-testid="mirror-status">{{ statusText }}</text>
    </view>

    <view v-if="authSuspect" class="pg-mirror__authhint pg-small" data-testid="mirror-auth-hint">
      镜像令牌可能已过期或无权访问，正在自动重试；若持续失败请让老师重新打开「镜像预览」。
    </view>

    <view v-if="initError" class="pg-mirror__error pg-sheet" data-testid="mirror-error" role="alert">
      <text class="pg-mirror__errortitle">无法打开镜像预览</text>
      <text class="pg-mirror__errorbody pg-small">{{ initError }}</text>
      <text class="pg-mirror__errorbody pg-small">本页只读；如链接失效，请让老师在教师端重新打开镜像预览。</text>
    </view>

    <view v-else-if="!view" class="pg-mirror__loading pg-sheet" data-testid="mirror-loading">
      <text class="pg-mirror__loadingtext">正在连接镜像…（只读）</text>
      <text v-if="status === 'reconnecting'" class="pg-mirror__loadingtext pg-small" data-testid="mirror-reconnecting">
        网络或服务暂时不可用，正在重连（第 {{ attempts }} 次）…
      </text>
    </view>

    <view v-else class="pg-mirror__shell">
      <view class="pg-mirror__head pg-sheet">
        <text class="pg-mirror__title" data-testid="mirror-title">{{ view.title }}</text>
        <text class="pg-mirror__meta pg-small" data-testid="mirror-meta">
          {{ view.chapter }} · {{ view.layerLabel }} · {{ view.statusLabel }} · 状态版本 {{ view.stateVersion }}
        </text>
        <view class="pg-mirror__budget pg-small" data-testid="mirror-budget">
          <text>透露 {{ view.budget.revealUsed }} / {{ view.budget.revealMax }}</text>
          <text>·</text>
          <text>自己写出 {{ view.budget.keysOwn }} / {{ view.budget.keysTotal }}</text>
        </view>
        <view class="pg-mirror__layers" aria-label="层状态（只读）">
          <text
            v-for="layer in view.layers"
            :key="layer.layer"
            class="pg-mirror__layer pg-small"
            :class="{
              'pg-mirror__layer--active': layer.active,
              'pg-mirror__layer--done': layer.status === 'done' || layer.status === 'skipped',
            }"
            :data-testid="'mirror-layer-' + layer.layer"
          >{{ layer.layer }} · {{ layer.status }}</text>
        </view>
      </view>

      <view class="pg-mirror__problem pg-sheet" data-testid="mirror-problem">
        <MathText :text="view.stem" serif block />
      </view>

      <view v-if="view.definition" class="pg-mirror__section pg-sheet" data-testid="mirror-def">
        <text class="pg-mirror__sectiontitle">第 1 层 · 定义</text>
        <MathText v-if="view.definition.task" :text="view.definition.task" block />
        <view class="pg-mirror__answer">
          <text class="pg-mirror__label pg-small">学生写的定义（提交 {{ view.definition.submissions }} 次）</text>
          <MathText v-if="view.definition.last" :text="view.definition.last" block />
          <text v-else class="pg-mirror__muted pg-small">（还没有提交定义）</text>
        </view>
      </view>

      <view v-if="view.frame" class="pg-mirror__section pg-sheet" data-testid="mirror-frame">
        <text class="pg-mirror__sectiontitle">第 2 层 · 证明骨架</text>
        <MathText v-if="view.frame.task" :text="view.frame.task" block />
        <view v-if="view.frame.templateShown && view.frame.template" class="pg-mirror__answer">
          <text class="pg-mirror__label pg-small">已展开的通用骨架</text>
          <MathText :text="view.frame.template" block />
        </view>
        <view class="pg-mirror__answer">
          <text class="pg-mirror__label pg-small">学生写的骨架</text>
          <MathText v-if="view.frame.last" :text="view.frame.last" block />
          <text v-else class="pg-mirror__muted pg-small">（还没有提交骨架）</text>
        </view>
      </view>

      <view class="pg-mirror__section pg-sheet" data-testid="mirror-lines">
        <text class="pg-mirror__sectiontitle">第 3 层 · 已写的证明行</text>
        <ProofLineList readonly :lines="view.lines" :notes="state?.notes ?? []" />
      </view>

      <view class="pg-mirror__section pg-mirror__notes pg-sheet" data-testid="mirror-notes">
        <text class="pg-mirror__sectiontitle">页边批注 / 提示</text>
        <text v-if="view.notes.length === 0" class="pg-mirror__muted pg-small">还没有批注或提示。</text>
        <view v-for="note in view.notes" :key="note.noteId" class="pg-mirror__note" :class="'pg-mirror__note--' + note.kind">
          <text class="pg-mirror__notewho pg-small">{{ note.kindLabel }} · {{ note.who }}</text>
          <MathText :text="note.text" block />
        </view>
      </view>

      <view v-if="view.selfcheck.length > 0" class="pg-mirror__section pg-sheet" data-testid="mirror-selfcheck">
        <text class="pg-mirror__sectiontitle">第 4 层 · 自检</text>
        <view v-for="item in view.selfcheck" :key="item.itemId" class="pg-mirror__checkrow">
          <text class="pg-mirror__label pg-small" :data-testid="'mirror-selfcheck-status-' + item.itemId">[{{ item.statusLabel }}] {{ item.question }}</text>
          <MathText v-if="item.answer" :text="item.answer" block />
          <text v-else class="pg-mirror__muted pg-small">（还没有回答）</text>
        </view>
      </view>

      <view v-if="view.transfer" class="pg-mirror__section pg-sheet" data-testid="mirror-transfer">
        <text class="pg-mirror__sectiontitle">第 5 层 · 迁移题（{{ view.transfer.statusLabel }}）</text>
        <MathText v-if="view.transfer.stem" :text="view.transfer.stem" block />
      </view>

      <view v-if="view.summary" class="pg-mirror__section pg-sheet" data-testid="mirror-summary">
        <text class="pg-mirror__sectiontitle">第 6 层 · 总结五问</text>
        <view v-for="(question, index) in view.summary.questions" :key="index" class="pg-mirror__checkrow">
          <MathText :text="question" block />
          <MathText v-if="view.summary.answers[index]" :text="view.summary.answers[index] as string" block />
          <text v-else class="pg-mirror__muted pg-small">（还没有回答）</text>
        </view>
      </view>

      <view v-if="view.completion?.done" class="pg-mirror__section pg-mirror__done pg-sheet" data-testid="mirror-completion">
        <text class="pg-mirror__sectiontitle">本题完成</text>
        <text class="pg-mirror__label pg-small">独立度 {{ view.completion.independence ?? '-' }}</text>
        <text v-if="view.completion.theorems.length" class="pg-mirror__label pg-small">mathlib4 对照：{{ view.completion.theorems.join('、') }}</text>
        <text v-if="view.completion.steps.length" class="pg-mirror__label pg-small">关键步骤：{{ view.completion.steps.join('、') }}</text>
      </view>

      <view v-if="view.integrity?.locked" class="pg-mirror__authhint pg-small" data-testid="mirror-locked">
        该作答当前被锁定（诚信警告 {{ view.integrity.warnings }} 次）；本页只读展示。
      </view>

      <text class="pg-mirror__playbacknote pg-small" data-testid="mirror-playback-note">{{ MIRROR_PLAYBACK_NOTE }}</text>
    </view>
  </view>
</template>

<style scoped>
.pg-mirror {
  min-height: 100vh;
  padding: 0 var(--sp-3) calc(var(--sp-6) + var(--safe-bottom));
  background: var(--paper);
}
.pg-mirror__banner {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 40px;
  margin: 0 calc(-1 * var(--sp-3));
  padding: 0 var(--sp-3);
  background: var(--accent-soft);
  border-bottom: 1px solid var(--accent);
  color: var(--accent);
}
.pg-mirror__bannertext { font-weight: 600; font-size: var(--fs-small); }
.pg-mirror__status { margin-left: auto; color: var(--ink-2); }
.pg-mirror__authhint {
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-input);
  background: var(--hint-soft);
  color: var(--hint);
}
.pg-mirror__error,
.pg-mirror__loading {
  margin: var(--sp-4) auto;
  max-width: var(--content-max);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.pg-mirror__errortitle { font-family: var(--font-serif); font-weight: 600; color: var(--ink); }
.pg-mirror__errorbody,
.pg-mirror__loadingtext { color: var(--ink-2); }
.pg-mirror__shell {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding-top: var(--sp-3);
}
.pg-mirror__head { padding: var(--sp-3) var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-mirror__title { font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--ink); }
.pg-mirror__meta { color: var(--ink-2); }
.pg-mirror__budget { display: flex; gap: var(--sp-2); color: var(--ink-2); flex-wrap: wrap; }
.pg-mirror__layers { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-top: var(--sp-1); }
.pg-mirror__layer {
  padding: 1px var(--sp-2);
  border-radius: 999px;
  background: var(--paper);
  border: 1px solid var(--rule);
  color: var(--ink-2);
}
.pg-mirror__layer--active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.pg-mirror__layer--done { color: var(--ok); }
.pg-mirror__problem { padding: var(--sp-3) var(--sp-4); font-family: var(--font-serif); font-size: var(--fs-stem); line-height: var(--lh-body); color: var(--ink); }
.pg-mirror__section { padding: var(--sp-3) var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-mirror__sectiontitle { font-family: var(--font-serif); font-size: 15px; font-weight: 600; color: var(--ink); }
.pg-mirror__label { color: var(--ink-2); }
.pg-mirror__muted { color: var(--ink-2); }
.pg-mirror__answer { display: flex; flex-direction: column; gap: var(--sp-1); padding-left: var(--sp-2); border-left: 2px solid var(--rule); }
.pg-mirror__checkrow { display: flex; flex-direction: column; gap: var(--sp-1); padding: var(--sp-2) 0; border-bottom: 1px dashed var(--rule); }
.pg-mirror__checkrow:last-child { border-bottom: 0; }
/* 手机：行内批注由 ProofLineList 渲染；宽屏只留标记，这里补正文。 */
.pg-mirror__notes { display: none; }
.pg-mirror__note { padding: var(--sp-2); border-left: 3px solid var(--rule); border-radius: 0 var(--radius-input) var(--radius-input) 0; }
.pg-mirror__note--annotation { border-left-color: var(--margin); background: var(--margin-soft); }
.pg-mirror__note--hint { border-left-color: var(--hint); background: var(--hint-soft); }
.pg-mirror__note--concept { border-left-color: var(--accent); background: var(--accent-soft); }
.pg-mirror__notewho { display: block; color: var(--ink-2); }
.pg-mirror__done { border-left: 3px solid var(--ok); }
.pg-mirror__playbacknote { display: block; color: var(--ink-2); text-align: center; }
/* 平板/桌面：内容居中，页边批注正文展开（复用 02 §3 的宽屏行为）。 */
@media (min-width: 600px) {
  .pg-mirror__notes { display: flex; }
}
@media (min-width: 1024px) {
  .pg-mirror__shell { max-width: 880px; }
}
</style>
