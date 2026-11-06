import { describe, expect, it } from 'vitest'
import { SITE, policySections } from '@/copy/privacy'

describe('隐私政策', () => {
  const text = JSON.stringify(policySections())

  it('写齐个人信息保护法第 17 条要告知的事项', () => {
    for (const word of ['运营', '联系', '学号', '保存', '2 年', '90 天', '查阅', '复制', '更正', '删除', '注销', '撤回']) {
      expect(text).toContain(word)
    }
  })

  it('列明接收方，并写明 AI 标识和投诉入口', () => {
    for (const word of ['DeepSeek', '通义千问', 'SimpleTex', 'AI 生成 · 仅作学习提示', 'AI 整理', '投诉举报']) expect(text).toContain(word)
  })

  it('服务器在境内，不提香港，也不写向境外发送', () => {
    expect(text).toContain('中国境内')
    expect(text).not.toContain('香港')
    expect(text).toContain('不向境外发送')
  })

  it('上线前必须填好运营方和联系方式', () => {
    expect(SITE.operator).not.toBe('')
    expect(SITE.contact).not.toBe('')
  })
})
