import { describe, expect, it } from 'vitest'
import {
  WECHAT_HINT_DISMISS_KEY,
  WECHAT_HINT_TEXT,
  copyLinkWithFallback,
  copyTextViaInput,
  dismissWeChatHint,
  isWeChatBrowser,
  isWeChatHintDismissed,
  shouldShowWeChatHint,
  type CopyFallbackDom,
  type CopyInputElement,
  type SessionStorageLike,
} from '@/utils/wechat'

const UA = {
  androidWeChat:
    'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40.2420(0x28002833) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
  iphoneWeChat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002833) NetType/WIFI Language/zh_CN',
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
}

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  const storage: SessionStorageLike = {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
  return { storage, map }
}

function throwingStorage(): SessionStorageLike {
  return {
    getItem: () => {
      throw new Error('storage denied')
    },
    setItem: () => {
      throw new Error('storage denied')
    },
  }
}

interface FakeInput extends CopyInputElement {
  attrs: Record<string, string>
}

function fakeCopyDom(config: {
  withExec?: boolean
  execResult?: boolean
  throwOnCreate?: boolean
  throwOnAppend?: boolean
} = {}) {
  const created: FakeInput[] = []
  const appended: FakeInput[] = []
  const removed: FakeInput[] = []
  const commands: string[] = []
  let selected = false
  const dom: CopyFallbackDom = {
    createElement: () => {
      if (config.throwOnCreate) throw new Error('create failed')
      const input = { value: '', style: {}, attrs: {} } as FakeInput
      input.setAttribute = (name: string, value: string) => {
        input.attrs[name] = value
      }
      input.focus = () => undefined
      input.select = () => {
        selected = true
      }
      input.setSelectionRange = () => undefined
      created.push(input)
      return input
    },
    body: {
      appendChild: (node) => {
        if (config.throwOnAppend) throw new Error('append failed')
        appended.push(node as FakeInput)
      },
      removeChild: (node) => {
        removed.push(node as FakeInput)
      },
    },
  }
  if (config.withExec !== false) {
    dom.execCommand = (command: string) => {
      commands.push(command)
      return config.execResult ?? true
    }
  }
  return { dom, created, appended, removed, commands, selected: () => selected }
}

describe('微信内置浏览器检测（Refs #37 / 12 §7）', () => {
  it('Android / iOS 微信 UA 判定为微信内置浏览器', () => {
    expect(isWeChatBrowser(UA.androidWeChat)).toBe(true)
    expect(isWeChatBrowser(UA.iphoneWeChat)).toBe(true)
    expect(isWeChatBrowser(UA.androidWeChat.toLowerCase())).toBe(true)
  })

  it('普通 Chrome / 空 UA 不判定为微信内置浏览器', () => {
    expect(isWeChatBrowser(UA.chrome)).toBe(false)
    expect(isWeChatBrowser('')).toBe(false)
    expect(isWeChatBrowser(null)).toBe(false)
    expect(isWeChatBrowser(undefined)).toBe(false)
  })

  it('提示语包含「微信内打开」与「在浏览器中打开」的引导', () => {
    expect(WECHAT_HINT_TEXT).toContain('微信内打开')
    expect(WECHAT_HINT_TEXT).toContain('在浏览器中打开')
  })
})

describe('提示展示条件与本 tab 记忆', () => {
  it('微信内首次进入显示；非微信 UA 即使未点过也不显示', () => {
    const { storage } = memoryStorage()
    expect(shouldShowWeChatHint({ userAgent: UA.androidWeChat, storage })).toBe(true)
    expect(shouldShowWeChatHint({ userAgent: UA.chrome, storage })).toBe(false)
  })

  it('可配置关闭：enabled=false 时任何 UA 都不显示', () => {
    expect(shouldShowWeChatHint({ userAgent: UA.androidWeChat, enabled: false })).toBe(false)
  })

  it('点「我知道了」后本 tab 不再显示（sessionStorage 记忆）', () => {
    const { storage, map } = memoryStorage()
    expect(isWeChatHintDismissed(storage)).toBe(false)
    dismissWeChatHint(storage)
    expect(map.get(WECHAT_HINT_DISMISS_KEY)).toBe('1')
    expect(isWeChatHintDismissed(storage)).toBe(true)
    expect(shouldShowWeChatHint({ userAgent: UA.androidWeChat, storage })).toBe(false)
  })

  it('自定义 dismissKey 生效且与默认键互不影响', () => {
    const { storage } = memoryStorage()
    dismissWeChatHint(storage, 'custom.wechatHintDismissed')
    expect(isWeChatHintDismissed(storage, 'custom.wechatHintDismissed')).toBe(true)
    expect(isWeChatHintDismissed(storage)).toBe(false)
    expect(shouldShowWeChatHint({ userAgent: UA.androidWeChat, storage, dismissKey: 'custom.wechatHintDismissed' })).toBe(false)
  })

  it('没有 storage / storage 抛异常时安全降级（不抛给 UI）', () => {
    expect(isWeChatHintDismissed(null)).toBe(false)
    dismissWeChatHint(null)
    const throwing = throwingStorage()
    expect(isWeChatHintDismissed(throwing)).toBe(false)
    expect(() => dismissWeChatHint(throwing)).not.toThrow()
    expect(shouldShowWeChatHint({ userAgent: UA.androidWeChat, storage: throwing })).toBe(true)
  })
})

describe('复制链接（clipboard 优先，input+select 兜底）', () => {
  const HREF = 'http://127.0.0.1:5173/#/pages/login/index'

  it('clipboard 可用时直接写入并返回成功，不再走兜底', async () => {
    const writes: string[] = []
    let fallbackCalls = 0
    const ok = await copyLinkWithFallback(HREF, {
      clipboard: { writeText: async (text: string) => { writes.push(text) } },
      copyFallback: () => {
        fallbackCalls += 1
        return true
      },
    })
    expect(ok).toBe(true)
    expect(writes).toEqual([HREF])
    expect(fallbackCalls).toBe(0)
  })

  it('clipboard 被拒 / 非安全上下文时降级到 input+select 兜底', async () => {
    let fallbackText = ''
    const ok = await copyLinkWithFallback(HREF, {
      clipboard: { writeText: async () => { throw new Error('not allowed') } },
      copyFallback: (text: string) => {
        fallbackText = text
        return true
      },
    })
    expect(ok).toBe(true)
    expect(fallbackText).toBe(HREF)
  })

  it('clipboard 不可用且兜底失败时返回 false', async () => {
    expect(await copyLinkWithFallback(HREF, { clipboard: null, copyFallback: () => false })).toBe(false)
    expect(
      await copyLinkWithFallback(HREF, {
        copyFallback: () => {
          throw new Error('execCommand failed')
        },
      }),
    ).toBe(false)
  })

  it('临时 input 的 copy 兜底：选中文本、执行 copy、结束后移除节点', () => {
    const fake = fakeCopyDom()
    const ok = copyTextViaInput(HREF, fake.dom)
    expect(ok).toBe(true)
    expect(fake.created).toHaveLength(1)
    expect(fake.created[0]?.value).toBe(HREF)
    expect(fake.created[0]?.attrs.readonly).toBe('')
    expect(fake.created[0]?.style.position).toBe('fixed')
    expect(fake.appended).toHaveLength(1)
    expect(fake.removed).toHaveLength(1)
    expect(fake.selected()).toBe(true)
    expect(fake.commands).toEqual(['copy'])
  })

  it('copy 兜底在 execCommand=false / 缺失 / DOM 异常时安全返回 false', () => {
    expect(copyTextViaInput(HREF, fakeCopyDom({ execResult: false }).dom)).toBe(false)
    expect(copyTextViaInput(HREF, fakeCopyDom({ withExec: false }).dom)).toBe(false)
    expect(copyTextViaInput(HREF, fakeCopyDom({ throwOnCreate: true }).dom)).toBe(false)
    expect(copyTextViaInput(HREF, fakeCopyDom({ throwOnAppend: true }).dom)).toBe(false)
    expect(copyTextViaInput(HREF, null)).toBe(false)
  })
})
