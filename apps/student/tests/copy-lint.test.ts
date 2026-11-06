/**
 * 文案检查：学生看得到的字里不能有开发者术语。
 *
 * 扫 .vue 模板（文本节点、可见属性）和 <script> 里的中文字符串。
 * - mock：开发门控（v-if="isDev / mockEnabled / mockMode"）里面允许；
 * - mathlib：只能出现在 PgFold（“延伸”）里面；
 * - 开发陈列页不进生产，不扫。登录页自 v3 起和其他页面一样要扫。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const EXEMPT = new Set(['pages/dev/gallery.vue'])

/** 模板 AST 的最小形状（@vue/compiler-sfc）。 */
interface TemplateNode {
  type: number
  tag?: string
  content?: string | { content?: string }
  props?: Array<{ type: number; name: string; value?: { content: string }; exp?: { content?: string } }>
  children?: TemplateNode[]
  branches?: TemplateNode[]
}
const NODE_ELEMENT = 1
const NODE_TEXT = 2
const NODE_ATTRIBUTE = 6
const NODE_DIRECTIVE = 7

const VISIBLE_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'label', 'body', 'hint', 'action', 'confirm-text', 'cancel-text', 'action-text', 'optional'])
const DEV_GATE = /\b(isDev|mockEnabled|mockMode)\b/

interface Finding {
  text: string
  devGated: boolean
  inFold: boolean
}

let parseSfc: (source: string, options: { filename: string }) => { descriptor: { template: { ast?: TemplateNode } | null; scriptSetup: { content: string } | null; script: { content: string } | null } }

function collect(node: TemplateNode, devGated: boolean, inFold: boolean, out: Finding[]): void {
  if (node.type === NODE_TEXT) {
    out.push({ text: String(node.content ?? ''), devGated, inFold })
    return
  }
  let gated = devGated
  let fold = inFold
  if (node.type === NODE_ELEMENT) {
    if (node.tag === 'PgFold') fold = true
    for (const prop of node.props ?? []) {
      if (prop.type === NODE_ATTRIBUTE && VISIBLE_ATTRS.has(prop.name) && prop.value) out.push({ text: prop.value.content, devGated: gated, inFold: fold })
      if (prop.type === NODE_DIRECTIVE && prop.name === 'if' && DEV_GATE.test(prop.exp?.content ?? '')) gated = true
    }
    // v-if 写在同一个标签上时，标签自身的属性也算门控内；上面按属性顺序处理已足够。
  }
  for (const child of node.children ?? []) collect(child, gated, fold, out)
  for (const branch of node.branches ?? []) collect(branch, gated, fold, out)
}

/** 去掉注释后，<script> 里含中文的字符串字面量。 */
function scriptStrings(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const out: string[] = []
  for (const match of withoutComments.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    if (/[一-鿿]/.test(value)) out.push(value)
  }
  return out
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const BANNED: Array<{ label: string; pattern: RegExp; allow?: (finding: Finding) => boolean }> = [
  { label: 'P0', pattern: /\bP0\b/ },
  { label: 'P1', pattern: /\bP1\b/ },
  { label: 'mock', pattern: /mock/i, allow: (f) => f.devGated },
  { label: 'dependent', pattern: /dependent/i },
  { label: 'mathlib', pattern: /mathlib/i, allow: (f) => f.inFold },
  { label: '透露', pattern: /透露/ },
  { label: '04 §', pattern: /\b\d{2} §/ },
  { label: 'SSE', pattern: /\bSSE\b/ },
]

function violations(findings: Finding[]): string[] {
  const out: string[] = []
  for (const finding of findings) {
    for (const rule of BANNED) {
      if (rule.pattern.test(finding.text) && !rule.allow?.(finding)) out.push(rule.label + ': ' + finding.text.trim().slice(0, 60))
    }
  }
  return out
}

function lint(file: string, source: string): string[] {
  const { descriptor } = parseSfc(source, { filename: file })
  const findings: Finding[] = []
  if (descriptor.template?.ast) collect(descriptor.template.ast, false, false, findings)
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  for (const text of scriptStrings(script)) findings.push({ text, devGated: false, inFold: false })
  return violations(findings)
}

beforeAll(async () => {
  const nodeRequire = createRequire(import.meta.url)
  let entry: string
  try {
    entry = nodeRequire.resolve('@vue/compiler-sfc')
  } catch {
    entry = createRequire(nodeRequire.resolve('@dcloudio/uni-cli-shared/package.json')).resolve('@vue/compiler-sfc')
  }
  const loaded: Record<string, unknown> = await import(pathToFileURL(entry).href)
  parseSfc = ((loaded.default ?? loaded) as { parse: typeof parseSfc }).parse
})

describe('学生端 .vue 没有开发者术语', () => {
  it('全部页面和组件', () => {
    const report: Record<string, string[]> = {}
    for (const file of walk(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file).split(path.sep).join('/')
      if (EXEMPT.has(rel)) continue
      const hits = lint(rel, fs.readFileSync(file, 'utf8'))
      if (hits.length > 0) report[rel] = hits
    }
    expect(report).toEqual({})
  })
})

describe('检查器自身', () => {
  const sfc = (template: string, script = '') => `<script setup lang="ts">${script}</script>\n<template>${template}</template>`

  it('文本节点里的 P0、透露、SSE、章节号都会被抓到', () => {
    expect(lint('a.vue', sfc('<view>P0 只核对</view>'))).toHaveLength(1)
    expect(lint('a.vue', sfc('<view>透露 0.5</view>'))).toHaveLength(1)
    expect(lint('a.vue', sfc('<view>走 SSE 推送</view>'))).toHaveLength(1)
    expect(lint('a.vue', sfc('<view>见 04 §5</view>'))).toHaveLength(1)
  })

  it('可见属性也扫；class、testid 不算', () => {
    expect(lint('a.vue', sfc('<input placeholder="透露量" />'))).toHaveLength(1)
    expect(lint('a.vue', sfc('<view class="mock" data-testid="mock-x" />'))).toEqual([])
  })

  it('mock 在开发门控里允许，在外面不允许', () => {
    expect(lint('a.vue', sfc('<view v-if="isDev">mock: x</view>'))).toEqual([])
    expect(lint('a.vue', sfc('<view v-if="mockMode"><text>mock 数据</text></view>'))).toEqual([])
    expect(lint('a.vue', sfc('<view>mock 数据</view>'))).toHaveLength(1)
  })

  it('mathlib 只能在 PgFold 里', () => {
    expect(lint('a.vue', sfc('<PgFold title="延伸"><text>mathlib4 对照</text></PgFold>'))).toEqual([])
    expect(lint('a.vue', sfc('<text>mathlib4 对照</text>'))).toHaveLength(1)
  })

  it('脚本里的中文字符串也扫，注释不算', () => {
    expect(lint('a.vue', sfc('<view />', "show('P0 层跳转')"))).toHaveLength(1)
    expect(lint('a.vue', sfc('<view />', "// P0 只是注释\nshow('好')"))).toEqual([])
    expect(lint('a.vue', sfc('<view />', "const mockKey = 'l1-active'"))).toEqual([])
  })
})
