import { describe, expect, it } from 'vitest'
import { MultitabMonitor, type MultitabMessage, type TabChannelLike } from '@/integrity/multitab'

class FakeChannel implements TabChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null
  sent: MultitabMessage[] = []
  postMessage(message: unknown): void {
    this.sent.push(message as MultitabMessage)
  }
  close(): void {}
}

describe('#27 多标签页检测（integ.multitab）', () => {
  it('收到其他标签 hello → 上报 tabs=2，且同一标签数只报一次', () => {
    const channel = new FakeChannel()
    const reports: number[] = []
    const monitor = new MultitabMonitor({ channel, report: (tabs) => reports.push(tabs), now: () => 1000, tabId: 'A' })
    monitor.start()
    expect(channel.sent[0]?.kind).toBe('hello')
    monitor.handleMessage({ tab: 'B', at: 900, kind: 'hello' })
    monitor.handleMessage({ tab: 'B', at: 950, kind: 'ping' })
    expect(reports).toEqual([2])
    expect(monitor.tabCount()).toBe(2)
  })

  it('第三个标签加入 → 上报 3；bye 离开 → 只统计且不重复报相同数量', () => {
    const channel = new FakeChannel()
    const reports: number[] = []
    const monitor = new MultitabMonitor({ channel, report: (tabs) => reports.push(tabs), now: () => 1000, tabId: 'A' })
    monitor.handleMessage({ tab: 'B', at: 1000, kind: 'ping' })
    monitor.handleMessage({ tab: 'C', at: 1000, kind: 'ping' })
    expect(reports).toEqual([2, 3])
    monitor.handleMessage({ tab: 'C', at: 1000, kind: 'bye' })
    expect(reports).toEqual([2, 3, 2])
  })

  it('心跳超时后清除过期标签', () => {
    const channel = new FakeChannel()
    let now = 1000
    const reports: number[] = []
    const monitor = new MultitabMonitor({ channel, report: (tabs) => reports.push(tabs), now: () => now, tabId: 'A', staleMs: 6000 })
    monitor.handleMessage({ tab: 'B', at: 1000, kind: 'ping' })
    expect(monitor.tabCount()).toBe(2)
    now = 9000
    expect(monitor.tabCount()).toBe(1)
  })

  it('忽略自己的消息与非法消息（无 PII，只认 tab/at/kind）', () => {
    const channel = new FakeChannel()
    const reports: number[] = []
    const monitor = new MultitabMonitor({ channel, report: (tabs) => reports.push(tabs), now: () => 1000, tabId: 'A' })
    monitor.handleMessage({ tab: 'A', at: 1000, kind: 'ping' })
    monitor.handleMessage(null)
    monitor.handleMessage({ tab: 'B' })
    monitor.handleMessage({ tab: 42, at: 1000, kind: 'ping' })
    expect(reports).toEqual([])
    expect(channel.sent.filter((message) => message.kind === 'hello')).toHaveLength(0)
  })

  it('stop 会广播 bye 并停止监听', () => {
    const channel = new FakeChannel()
    const monitor = new MultitabMonitor({ channel, report: () => {}, now: () => 1000, tabId: 'A' })
    monitor.start()
    monitor.stop()
    expect(channel.sent.at(-1)?.kind).toBe('bye')
    expect(channel.onmessage).toBeNull()
  })
})
