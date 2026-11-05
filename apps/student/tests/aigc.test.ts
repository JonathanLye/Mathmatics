import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AI_GENERATED_TAG_ARIA_LABEL,
  AI_GENERATED_TAG_TEXT,
  generatedTextOf,
  hasGeneratedContent,
} from '@/components/aigc'
import { MOCK_AIGC_GENERATED_TEXT, createMockLesson, mockGeneratedLesson, mockLesson } from '@/mocks/laterLayers'

// task-90 / Refs #37：AIGC 显式标识的渲染能力（12 §7 上线检查单；13 合规；02 §7 文案）。
// 口径：只做「服务端下发的 generated 非空 → 显示固定标识」；不生成、不改写、不伪造内容；默认不启用。

describe('AIGC 标识常量（12 §7 / 13 合规 / 02 §7）', () => {
  it('可见文案与服务端口径一致：AI 生成 · 仅作学习提示', () => {
    expect(AI_GENERATED_TAG_TEXT).toBe('AI 生成 · 仅作学习提示')
  })

  it('读屏 aria-label 非空、含「AI 生成」且补充完整含义', () => {
    expect(AI_GENERATED_TAG_ARIA_LABEL.length).toBeGreaterThan(AI_GENERATED_TAG_TEXT.length)
    expect(AI_GENERATED_TAG_ARIA_LABEL).toContain('AI 生成')
    expect(AI_GENERATED_TAG_ARIA_LABEL).toContain('仅作学习提示')
  })

  it('文案不夹带判定/营销词（批注口径：不出现 对了/错了/太棒）', () => {
    for (const word of ['对了', '错了', '太棒', '加油']) {
      expect(AI_GENERATED_TAG_TEXT).not.toContain(word)
    }
  })

  it('aigc.ts 是纯逻辑（无 import，无 DOM/Vue 依赖，可在 node 单测直接跑）', () => {
    const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/aigc.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\b/m)
  })
})

describe('generatedTextOf（LessonView.generated 字段解析）', () => {
  it.each([null, undefined, '', '   ', 0, 123, true, false, {}, []])('缺省/空白/非字符串 → 空串（%s）', (value) => {
    expect(generatedTextOf(value)).toBe('')
  })

  it('普通字符串会 trim（不改变内容本身）', () => {
    expect(generatedTextOf('  补充讲解  ')).toBe('补充讲解')
  })

  it('mock 占位文本原样返回（前端不加工生成内容）', () => {
    expect(generatedTextOf(MOCK_AIGC_GENERATED_TEXT)).toBe(MOCK_AIGC_GENERATED_TEXT)
  })
})

describe('hasGeneratedContent（标签显隐判定）', () => {
  it.each([null, undefined, '', '   ', 123, true])('无内容/非字符串 → false（%s）', (value) => {
    expect(hasGeneratedContent(value)).toBe(false)
  })

  it('有非空文本 → true', () => {
    expect(hasGeneratedContent('一条补充讲解')).toBe(true)
    expect(hasGeneratedContent(MOCK_AIGC_GENERATED_TEXT)).toBe(true)
  })
})

describe('mock 开关（默认不启用生成）', () => {
  it('默认 mockLesson.generated 为 null（与 P0 线上口径一致：无 AI 生成文本）', () => {
    expect(mockLesson.generated).toBeNull()
    expect(hasGeneratedContent(mockLesson.generated)).toBe(false)
  })

  it('mockGeneratedLesson 带非空 generated（仅供测试/演示渲染）', () => {
    expect(mockGeneratedLesson.generated).toBe(MOCK_AIGC_GENERATED_TEXT)
    expect(hasGeneratedContent(mockGeneratedLesson.generated)).toBe(true)
  })

  it('createMockLesson 默认不带 generated；generated=true 时与 mockGeneratedLesson 一致', () => {
    expect(createMockLesson().generated).toBeNull()
    expect(createMockLesson({ generated: false }).generated).toBeNull()
    expect(createMockLesson({ generated: true }).generated).toBe(MOCK_AIGC_GENERATED_TEXT)
  })

  it('createMockLesson 返回副本，不污染模块常量', () => {
    const lesson = createMockLesson({ generated: true })
    lesson.title = '被改掉的标题'
    expect(mockLesson.title).not.toBe('被改掉的标题')
    expect(mockGeneratedLesson.title).not.toBe('被改掉的标题')
  })
})

// ---------------------------------------------------------------------------
// 组件 SFC 编译检查：@vue/compiler-sfc 是 @dcloudio/uni-cli-shared 的传递依赖，
// pnpm 严格 node_modules 下不能从 apps/student 直接 import，用 createRequire 从 uni-cli-shared 解析。
// ---------------------------------------------------------------------------

interface CompilerSfcLike {
  parse: (source: string, options?: Record<string, unknown>) => { descriptor: Record<string, any>; errors: unknown[] }
  compileScript: (descriptor: Record<string, any>, options?: Record<string, unknown>) => { content: string }
  compileTemplate: (options: Record<string, unknown>) => { code: string; errors: unknown[] }
  compileStyle: (options: Record<string, unknown>) => { errors: unknown[] }
}

let sfc: CompilerSfcLike
const COMPONENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components')
const SFC_FILES = ['AiGeneratedTag.vue', 'MicroCourse.vue']

function resolveCompilerSfcEntry(): string {
  const nodeRequire = createRequire(import.meta.url)
  try {
    return nodeRequire.resolve('@vue/compiler-sfc')
  } catch {
    const uniCliShared = nodeRequire.resolve('@dcloudio/uni-cli-shared/package.json')
    return createRequire(uniCliShared).resolve('@vue/compiler-sfc')
  }
}

function readSfc(file: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8')
}

beforeAll(async () => {
  const entry = pathToFileURL(resolveCompilerSfcEntry()).href
  const loaded: Record<string, unknown> = await import(entry)
  sfc = (loaded.default ?? loaded) as unknown as CompilerSfcLike
})

describe('AIGC 组件 SFC 编译检查（@vue/compiler-sfc）', () => {
  it.each(SFC_FILES)('%s 可以解析且含 script setup / template', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    expect(result.errors).toEqual([])
    expect(result.descriptor.scriptSetup).toBeTruthy()
    expect(result.descriptor.template).toBeTruthy()
  })

  it.each(SFC_FILES)('%s 的 script setup 与 template 可以编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const id = 'aigc-' + file.replace('.vue', '')
    expect(() => sfc.compileScript(result.descriptor, { id })).not.toThrow()
    const template = sfc.compileTemplate({
      source: result.descriptor.template.content,
      filename: file,
      id,
      scoped: true,
    })
    expect(template.errors).toEqual([])
    expect(template.code.length).toBeGreaterThan(0)
  })

  it.each(SFC_FILES)('%s 的 scoped style 可以编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const styles = result.descriptor.styles ?? []
    for (const style of styles) {
      const compiled = sfc.compileStyle({
        source: style.content,
        filename: file,
        id: 'data-v-aigc',
        scoped: Boolean(style.scoped),
      })
      expect(compiled.errors).toEqual([])
    }
  })

  it.each(SFC_FILES)('%s 不含 console 输出', (file) => {
    expect(readSfc(file)).not.toMatch(/console\./)
  })

  it('AiGeneratedTag 使用 tokens、role=note/aria-label/data-testid，无硬编码色值', () => {
    const source = readSfc('AiGeneratedTag.vue')
    expect(source).toContain('aigc-tag')
    expect(source).toContain('role="note"')
    expect(source).toContain('aria-label')
    expect(source).toContain('var(--ink-2)')
    expect(source).toContain('var(--fs-small)')
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}/)
  })

  it('MicroCourse 已接线 AiGeneratedTag，且只在 generated 非空时渲染', () => {
    const source = readSfc('MicroCourse.vue')
    expect(source).toContain('AiGeneratedTag')
    expect(source).toContain('generatedText')
    expect(source).toContain('micro-generated')
    expect(source).toContain('generatedTextOf')
  })
})
