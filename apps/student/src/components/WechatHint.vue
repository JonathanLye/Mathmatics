<script setup lang="ts">
/**
 * 微信内打开提示（Refs #37 / 12 §7 上线检查单）：
 * - 只在「微信内置浏览器 UA + 本 tab 未点过『我知道了』」时显示，非微信 UA 不渲染；
 * - 非阻塞：正常文档流的一条横条，不覆盖 44px 操作区、不拦截任何流程；
 * - 「复制链接」优先 navigator.clipboard，失败（非安全上下文/权限被拒/旧 WebView）降级到
 *   input + select + document.execCommand('copy')；文字只展示与复制链接，不做判定或伪造；
 * - 深色模式与配色全部走 src/styles/tokens.css 的 CSS 变量；
 * - 可在页面/测试里通过 enabled / dismissKey 配置（默认 enabled=true，按 sessionStorage 记忆）。
 */
import { onMounted, ref } from 'vue'
import {
  WECHAT_HINT_DISMISS_KEY,
  WECHAT_HINT_TEXT,
  copyLinkWithFallback,
  copyTextViaInput,
  dismissWeChatHint,
  shouldShowWeChatHint,
  type CopyFallbackDom,
  type SessionStorageLike,
} from '@/utils/wechat'

const props = withDefaults(defineProps<{ enabled?: boolean; dismissKey?: string }>(), {
  enabled: true,
  dismissKey: WECHAT_HINT_DISMISS_KEY,
})

const hintText = WECHAT_HINT_TEXT
const visible = ref(false)
const copyState = ref('')
/** sessionStorage 不可用（隐私模式/SSR）时的本 tab 内存记忆。 */
const memoryStorage = new Map<string, string>()

/** 本 tab 存储：优先 sessionStorage（H5），否则内存。 */
function resolveSessionStorage(): SessionStorageLike | null {
  // #ifdef H5
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const storage = window.sessionStorage
      return {
        getItem: (key: string) => storage.getItem(key),
        setItem: (key: string, value: string) => storage.setItem(key, value),
      }
    }
  } catch {
    // 隐私模式 / 被禁用：降级内存
  }
  // #endif
  return {
    getItem: (key: string) => (memoryStorage.has(key) ? (memoryStorage.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      memoryStorage.set(key, value)
    },
  }
}

function readUserAgent(): string {
  // #ifdef H5
  if (typeof navigator !== 'undefined') return navigator.userAgent
  // #endif
  return ''
}

function readHref(): string {
  // #ifdef H5
  if (typeof location !== 'undefined') return location.href
  // #endif
  return ''
}

function resolveClipboard(): { writeText(text: string): Promise<void> } | null {
  // #ifdef H5
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return { writeText: (text: string) => navigator.clipboard.writeText(text) }
  }
  // #endif
  return null
}

/** input + select 兜底需要的最小 DOM 子集（只在 H5 注入）。 */
function resolveCopyDom(): CopyFallbackDom | null {
  // #ifdef H5
  if (typeof document === 'undefined') return null
  return {
    createElement: (tag) => document.createElement(tag),
    body: {
      appendChild: (node) => document.body.appendChild(node as unknown as Node),
      removeChild: (node) => document.body.removeChild(node as unknown as Node),
    },
    execCommand:
      typeof document.execCommand === 'function' ? (command: string) => document.execCommand(command) : undefined,
  }
  // #endif
  return null
}

onMounted(() => {
  if (!props.enabled) return
  visible.value = shouldShowWeChatHint({
    userAgent: readUserAgent(),
    enabled: props.enabled,
    storage: resolveSessionStorage(),
    dismissKey: props.dismissKey,
  })
})

/** 「复制链接」：clipboard 优先，失败降级 input+select；按钮只复制当前页地址。 */
async function copyLink(): Promise<void> {
  const text = readHref()
  if (!text) {
    copyState.value = '复制失败：请长按地址栏复制链接'
    return
  }
  const ok = await copyLinkWithFallback(text, {
    clipboard: resolveClipboard(),
    copyFallback: (value: string) => copyTextViaInput(value, resolveCopyDom()),
  })
  copyState.value = ok ? '已复制，去浏览器粘贴打开' : '复制失败：请长按地址栏复制链接'
}

/** 「我知道了」：本 tab 内不再重复提示（换 tab/重开浏览器会再提示）。 */
function dismiss(): void {
  visible.value = false
  dismissWeChatHint(resolveSessionStorage(), props.dismissKey)
}
</script>

<template>
  <view v-if="visible" class="pg-wechat" role="status" aria-live="polite" data-testid="wechat-hint">
    <text class="pg-wechat__text" data-testid="wechat-hint-text">{{ hintText }}</text>
    <view class="pg-wechat__actions">
      <button class="pg-wechat__btn" role="button" data-testid="wechat-copy" @tap="copyLink">复制链接</button>
      <button class="pg-wechat__btn pg-wechat__btn--primary" role="button" data-testid="wechat-dismiss" @tap="dismiss">
        我知道了
      </button>
    </view>
    <text v-if="copyState" class="pg-wechat__state pg-small" role="status" data-testid="wechat-copy-state">
      {{ copyState }}
    </text>
  </view>
</template>

<style scoped>
.pg-wechat {
  position: relative;
  z-index: 35;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1) var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--accent-soft);
  border-bottom: var(--bw) solid var(--accent);
  color: var(--ink);
}
.pg-wechat__text {
  flex: 1 1 100%;
  min-width: 0;
  font-size: var(--fs-13);
  line-height: 1.5;
}
.pg-wechat__actions {
  display: flex;
  flex: 1 1 100%;
  justify-content: flex-end;
  gap: var(--sp-1);
}
.pg-wechat__btn {
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--accent);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--accent-text);
  font-size: var(--fs-13);
  line-height: 1.2;
}
.pg-wechat__btn::after {
  border: none;
}
.pg-wechat__btn--primary {
  background: var(--accent);
  color: var(--on-accent);
}
.pg-wechat__state {
  flex: 1 1 100%;
  color: var(--ink-2);
}
</style>
