/**
 * 微信内置浏览器提示（Refs #37 / 12 §7 上线检查单）：
 * - 微信内置浏览器对未备案域名 / 部分 API 可能拦截，首页、登录页、做题页入口给一个
 *   非阻塞提示，引导「点右上角 ··· → 在浏览器中打开」；
 * - 本文件是纯逻辑：UA 检测、本 tab 记忆（sessionStorage 抽象）、复制链接（clipboard 优先、
 *   input+select 兜底）；不依赖 DOM，可在 vitest node 环境直接单测；DOM 细节由组件按 #ifdef H5 注入。
 *
 * 约束：提示只做展示与复制链接；不做任何判定、拦截或伪造。
 */

/** 提示语（12 §7 上线检查单：「被拦时引导『在浏览器中打开』」）。 */
export const WECHAT_HINT_TEXT = '当前在微信内打开，如页面异常请点右上角 ··· → 在浏览器中打开'

/** 本 tab 记住「我知道了」的 sessionStorage 键。 */
export const WECHAT_HINT_DISMISS_KEY = 'pg.wechatHintDismissed'

const MICROMESSENGER_PATTERN = /MicroMessenger/i

/** UA 是否微信内置浏览器（Android / iOS / 微信桌面端都带 MicroMessenger 标识）。 */
export function isWeChatBrowser(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && MICROMESSENGER_PATTERN.test(userAgent)
}

/** 本 tab 的存储抽象（H5 注入 sessionStorage；无 sessionStorage 时用内存）。 */
export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 本 tab 是否已经点过「我知道了」。 */
export function isWeChatHintDismissed(
  storage: SessionStorageLike | null,
  key: string = WECHAT_HINT_DISMISS_KEY,
): boolean {
  if (!storage) return false
  try {
    return storage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** 记住「我知道了」（本 tab 内不再重复；换 tab / 重开浏览器会再提示）。 */
export function dismissWeChatHint(
  storage: SessionStorageLike | null,
  key: string = WECHAT_HINT_DISMISS_KEY,
): void {
  if (!storage) return
  try {
    storage.setItem(key, '1')
  } catch {
    // 隐私模式 / 存储已满：忽略，最多重复提示一次
  }
}

/**
 * 是否应展示提示：可配置关闭；非微信 UA 不展示；本 tab 已点过不展示。
 * 组件在 onMounted 里调用一次（UA / sessionStorage 都是 H5 能力，放在 #ifdef H5）。
 */
export function shouldShowWeChatHint(options: {
  userAgent?: string | null
  enabled?: boolean
  storage?: SessionStorageLike | null
  dismissKey?: string
}): boolean {
  if (options.enabled === false) return false
  if (!isWeChatBrowser(options.userAgent)) return false
  return !isWeChatHintDismissed(options.storage ?? null, options.dismissKey)
}

/** 复制链接的环境依赖（组件注入 navigator.clipboard 与 input+select 兜底；测试注入假实现）。 */
export interface CopyLinkEnv {
  clipboard?: { writeText(text: string): Promise<void> } | null
  copyFallback?: (text: string) => boolean | Promise<boolean>
}

/** clipboard 优先；失败（非安全上下文 / 被禁 / 权限拒绝）降级到 input+select。返回是否复制成功。 */
export async function copyLinkWithFallback(text: string, env: CopyLinkEnv): Promise<boolean> {
  const clipboard = env.clipboard
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // 继续走兜底
    }
  }
  if (typeof env.copyFallback === 'function') {
    try {
      return Boolean(await env.copyFallback(text))
    } catch {
      return false
    }
  }
  return false
}

/** input+select 兜底所需的 DOM 子集（不依赖真实 DOM，便于单测）。 */
export interface CopyInputElement {
  value: string
  style: { position?: string; left?: string; opacity?: string }
  setAttribute(name: string, value: string): void
  focus?(): void
  select?(): void
  setSelectionRange?(start: number, end: number): void
}

export interface CopyFallbackDom {
  createElement(tag: 'input'): CopyInputElement
  body: {
    appendChild(node: CopyInputElement): void
    removeChild(node: CopyInputElement): void
  }
  execCommand?: (command: string) => boolean
}

/**
 * 复制兜底：临时插入 readonly input → select → document.execCommand('copy') → 移除。
 * 用于 navigator.clipboard 不可用（http 非安全上下文、旧 WebView、权限被拒）的情况。
 */
export function copyTextViaInput(text: string, dom: CopyFallbackDom | null): boolean {
  if (!dom || typeof dom.execCommand !== 'function') return false
  let input: CopyInputElement | null = null
  try {
    input = dom.createElement('input')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.opacity = '0'
    dom.body.appendChild(input)
    input.focus?.()
    input.select?.()
    input.setSelectionRange?.(0, text.length)
    return dom.execCommand('copy')
  } catch {
    return false
  } finally {
    if (input) {
      try {
        dom.body.removeChild(input)
      } catch {
        // 已不在 DOM：忽略
      }
    }
  }
}
