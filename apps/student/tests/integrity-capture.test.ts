import { describe, expect, it } from 'vitest'
import { attachIntegrityCapture, isDesktopEnv, selectionChars, shortcutCombo, type IntegrityCaptureOptions } from '@/integrity/capture'

type Listener = (event?: unknown) => void

function fakeDom(options: { desktop?: boolean; selectedText?: string } = {}) {
  const docListeners = new Map<string, Set<Listener>>()
  const winListeners = new Map<string, Set<Listener>>()
  const document = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    fullscreenElement: null as unknown,
    activeElement: null as unknown,
    getSelection: () => ({ toString: () => options.selectedText ?? '' }),
    addEventListener(type: string, listener: Listener) {
      if (!docListeners.has(type)) docListeners.set(type, new Set())
      docListeners.get(type)?.add(listener)
    },
    removeEventListener(type: string, listener: Listener) {
      docListeners.get(type)?.delete(listener)
    },
  }
  const window = {
    addEventListener(type: string, listener: Listener) {
      if (!winListeners.has(type)) winListeners.set(type, new Set())
      winListeners.get(type)?.add(listener)
    },
    removeEventListener(type: string, listener: Listener) {
      winListeners.get(type)?.delete(listener)
    },
    matchMedia: () => ({ matches: Boolean(options.desktop) }),
    navigator: { onLine: true },
  }
  function dispatch(target: 'doc' | 'win', type: string, event?: unknown): void {
    const listeners = target === 'doc' ? docListeners.get(type) : winListeners.get(type)
    for (const listener of Array.from(listeners ?? [])) listener(event)
  }
  return { document, window, dispatch }
}

function setup(dom: ReturnType<typeof fakeDom>, extra: Partial<IntegrityCaptureOptions> = {}) {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = []
  let nowValue = 1000
  const calls: { hidden: number; returns: number[] } = { hidden: 0, returns: [] }
  const detach = attachIntegrityCapture({
    report: (type, payload = {}) => events.push({ type, payload }),
    doc: dom.document as unknown as Document,
    win: dom.window as unknown as Window,
    now: () => nowValue,
    isDesktop: Boolean((dom.window.matchMedia as () => { matches: boolean })().matches),
    onHidden: () => {
      calls.hidden += 1
    },
    onFirstReturn: (awayMs) => {
      calls.returns.push(awayMs)
    },
    onNetworkChange: () => {},
    ...extra,
  })
  return { events, calls, detach, setNow: (value: number) => { nowValue = value } }
}

describe('#27 诚信信号采集（11 §3）', () => {
  it('selectionChars：选区文字长度；input/textarea 退化为 selectionStart/End', () => {
    const withSelection = fakeDom({ selectedText: 'abcd' })
    expect(selectionChars(withSelection.document as unknown as Document)).toBe(4)
    const textareaDom = fakeDom()
    textareaDom.document.activeElement = { tagName: 'TEXTAREA', selectionStart: 2, selectionEnd: 7 }
    expect(selectionChars(textareaDom.document as unknown as Document)).toBe(5)
  })

  it('shortcutCombo：Ctrl/Cmd 敏感键、F12、Ctrl+Shift+I', () => {
    expect(shortcutCombo({ key: 'c', ctrlKey: true })).toBe('ctrl+copy')
    expect(shortcutCombo({ key: 'v', metaKey: true })).toBe('meta+paste')
    expect(shortcutCombo({ key: 'F12' })).toBe('f12')
    expect(shortcutCombo({ key: 'i', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+i')
    expect(shortcutCombo({ key: 'a', ctrlKey: true })).toBeNull()
  })

  it('visibility hidden/visible：awayMs 精确、onHidden/onFirstReturn 各一次', () => {
    const dom = fakeDom()
    const { events, calls, detach, setNow } = setup(dom)
    dom.document.visibilityState = 'hidden'
    dom.dispatch('doc', 'visibilitychange')
    expect(events[0]).toMatchObject({ type: 'integ.visibility', payload: { state: 'hidden' } })
    expect(calls.hidden).toBe(1)
    setNow(31000)
    dom.document.visibilityState = 'visible'
    dom.dispatch('doc', 'visibilitychange')
    expect(events[1]).toMatchObject({ type: 'integ.visibility', payload: { state: 'visible', awayMs: 30000 } })
    expect(calls.returns).toEqual([30000])
    // 第二次切回不再提醒
    dom.document.visibilityState = 'hidden'
    dom.dispatch('doc', 'visibilitychange')
    setNow(40000)
    dom.document.visibilityState = 'visible'
    dom.dispatch('doc', 'visibilitychange')
    expect(calls.returns).toEqual([30000])
    detach()
  })

  it('pagehide/pageshow 与 visibilitychange 去重（hidden 只报一次）', () => {
    const dom = fakeDom()
    const { events, detach } = setup(dom)
    dom.document.visibilityState = 'hidden'
    dom.dispatch('doc', 'visibilitychange')
    dom.dispatch('win', 'pagehide')
    expect(events.filter((event) => event.type === 'integ.visibility')).toHaveLength(1)
    detach()
  })

  it('blur/focus 仅在桌面端记录 awayMs', () => {
    const desktop = fakeDom({ desktop: true })
    const desktopSetup = setup(desktop)
    desktop.dispatch('win', 'blur')
    desktopSetup.setNow(3500)
    desktop.dispatch('win', 'focus')
    expect(desktopSetup.events[0]).toMatchObject({ type: 'integ.blur', payload: { awayMs: 2500 } })
    desktopSetup.detach()

    const mobile = fakeDom({ desktop: false })
    const mobileSetup = setup(mobile)
    mobile.dispatch('win', 'blur')
    mobile.dispatch('win', 'focus')
    expect(mobileSetup.events).toHaveLength(0)
  })

  it('copy/cut/paste/contextmenu/shortcut/fullscreen 都按 08 目录上报', () => {
    const dom = fakeDom({ selectedText: 'hello' })
    const { events, detach } = setup(dom)
    dom.document.activeElement = { dataset: { pgTarget: 'def' }, tagName: 'TEXTAREA' }
    dom.dispatch('doc', 'copy')
    dom.dispatch('doc', 'cut')
    dom.dispatch('doc', 'paste', { clipboardData: { getData: () => 'xy' } })
    dom.dispatch('doc', 'contextmenu')
    dom.dispatch('win', 'keydown', { key: 'c', ctrlKey: true })
    dom.document.fullscreenElement = { tagName: 'DIV' }
    dom.dispatch('doc', 'fullscreenchange')
    expect(events.map((event) => event.type)).toEqual([
      'integ.copy',
      'integ.cut',
      'paste',
      'integ.contextmenu',
      'integ.shortcut',
      'integ.fullscreen',
    ])
    expect(events[0]?.payload).toEqual({ chars: 5 })
    expect(events[2]?.payload).toEqual({ target: 'def', chars: 2, blocked: false })
    expect(events[4]?.payload).toEqual({ combo: 'ctrl+copy' })
    expect(events[5]?.payload).toEqual({ state: 'enter' })
    detach()
  })

  it('online/offline 上报 integ.network 并通知队列', () => {
    const dom = fakeDom()
    const network: boolean[] = []
    const sdk = setup(dom, { onNetworkChange: (online) => network.push(online) })
    dom.dispatch('win', 'offline')
    dom.dispatch('win', 'online')
    expect(sdk.events.map((event) => event.payload)).toEqual([{ online: false }, { online: true }])
    expect(network).toEqual([false, true])
  })

  it('detach 后不再采集', () => {
    const dom = fakeDom()
    const { events, detach } = setup(dom)
    detach()
    dom.dispatch('win', 'keydown', { key: 'F12' })
    expect(events).toHaveLength(0)
  })

  it('isDesktopEnv 无 matchMedia 时返回 false', () => {
    expect(isDesktopEnv({} as Window)).toBe(false)
  })
})
