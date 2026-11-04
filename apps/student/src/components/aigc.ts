/**
 * AIGC 标识（12 §7 上线检查单「AI 生成文本下有『AI 生成 · 仅作学习提示』」；
 * 13-合规与运营.md §AIGC 显式/隐式标识；02 §7 文案）。
 *
 * 口径：
 * - 本文件只做「服务端下发的 generated 是否是可展示的 AI 生成文本」的解析与固定文案，
 *   不生成、不改写、不伪造任何内容；是否生成由 B 侧决定，A 侧只负责标识与渲染。
 * - 契约字段：openapi LessonView.generated（MathText | null，已过闸门与异厂商复核）。
 * - 当前 P0 main 不启用生成文本（见 GitHub-Issues/AIGC-darkmode-审计-2026-11-04.md）；
 *   本能力默认静默：只有服务端下发非空 generated 时才显示标签，前端不自行打开生成。
 */
export const AI_GENERATED_TAG_TEXT = 'AI 生成 · 仅作学习提示'

/** 读屏用的完整说明（可见文案保持短句，aria-label 补充含义）。 */
export const AI_GENERATED_TAG_ARIA_LABEL = 'AI 生成内容，仅作学习提示；请以教材与老师的讲解为准'

/** 取出可展示的 generated 文本：只接受字符串并 trim；null/空串/非字符串一律视为「无生成内容」。 */
export function generatedTextOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 是否应展示 AIGC 标识（有非空 generated 文本才展示；缺省/false 不显示）。 */
export function hasGeneratedContent(value: unknown): boolean {
  return generatedTextOf(value).length > 0
}
