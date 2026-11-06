<script setup lang="ts">
/**
 * <MathText :text="MathText 字符串" />
 * H5：KaTeX 渲染；非 H5（小程序 P2）：降级为纯文本/rich-text 预留。
 * 对外接口固定为 text: MathText（02 §9），后续小程序端替换内部实现即可。
 *
 * 长公式横向滚动，两侧按实际可滚方向渐隐；渲染失败显示原文加一句轻提示（不是红字）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseMathText } from './mathText'
import { MATH_RENDER_FAILED_HINT, isLongInlineMath, renderMath } from './mathRender'

const props = withDefaults(
  defineProps<{
    text?: string
    /** 行内(span) 还是整段(div)，默认 span */
    block?: boolean
    /** 题面等需要更宽松的行高 */
    serif?: boolean
  }>(),
  { text: '', block: false, serif: false },
)

const CLOSING_PUNCTUATION = /^[。，、；：！？）》」』】”’.,;:!?)]+/

type ViewSegment =
  | { kind: 'text'; value: string }
  | { kind: 'failed'; value: string }
  | { kind: 'math'; html: string; display: boolean; scroll: boolean; tail?: string }

const segments = computed<ViewSegment[]>(() => {
  const out: ViewSegment[] = []
  for (const seg of parseMathText(props.text ?? '')) {
    if (seg.kind === 'text') {
      // 公式后面紧跟的标点跟公式放在一起，不单独掉到下一行。
      const last = out[out.length - 1]
      const tail = last?.kind === 'math' && !last.scroll ? (seg.value.match(CLOSING_PUNCTUATION)?.[0] ?? '') : ''
      if (tail && last?.kind === 'math') last.tail = tail
      const rest = seg.value.slice(tail.length)
      if (rest) out.push({ kind: 'text', value: rest })
      continue
    }
    const display = seg.display === true
    const rendered = renderMath(seg.value, { display })
    if (!rendered.ok) out.push({ kind: 'failed', value: seg.value })
    else out.push({ kind: 'math', html: rendered.html, display, scroll: display || isLongInlineMath(seg.value) })
  }
  return out
})
const hasScrollable = computed(() => segments.value.some((seg) => seg.kind === 'math' && seg.scroll))

// ---- 两侧渐隐：只给真的放不下的公式加 mask，能往哪边滚就渐隐哪边 ----
const rootRef = ref<unknown>(null)
let observer: ResizeObserver | null = null

function rootElement(): HTMLElement | null {
  if (typeof HTMLElement === 'undefined') return null
  const value = rootRef.value as { $el?: unknown } | null
  const node = value?.$el ?? value
  return node instanceof HTMLElement ? node : null
}

function syncFade(el: Element): void {
  const max = el.scrollWidth - el.clientWidth
  el.classList.toggle('ui-math-fade-l', max > 1 && el.scrollLeft > 1)
  el.classList.toggle('ui-math-fade-r', max > 1 && el.scrollLeft < max - 1)
}

function syncFades(): void {
  rootElement()?.querySelectorAll('.ui-math-scroll').forEach(syncFade)
}

function onScroll(event: Event): void {
  const target = event.target as Element | null
  if (target?.classList?.contains('ui-math-scroll')) syncFade(target)
}

function attachFades(): void {
  const root = rootElement()
  if (!root || !hasScrollable.value) return
  root.addEventListener('scroll', onScroll, true)
  if (typeof ResizeObserver === 'function' && !observer) {
    observer = new ResizeObserver(syncFades)
    observer.observe(root)
  }
  // KaTeX 字体晚到时公式宽度会变。
  void (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(syncFades)
  syncFades()
}

onMounted(attachFades)
watch(segments, () => void nextTick(attachFades))
onBeforeUnmount(() => {
  rootElement()?.removeEventListener('scroll', onScroll, true)
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <text v-if="segments.length === 0" class="ui-math-text" />
  <text
    v-else
    ref="rootRef"
    class="ui-math-text"
    :class="{ 'ui-math-text--serif': serif }"
    :style="block ? 'display:block' : ''"
  >
    <template v-for="(seg, i) in segments" :key="i">
      <template v-if="seg.kind === 'text'">{{ seg.value }}</template>
      <span v-else-if="seg.kind === 'failed'" class="ui-math-raw" :title="MATH_RENDER_FAILED_HINT" data-testid="math-raw"><span class="ui-math-raw__src">{{ seg.value }}</span><span class="ui-math-raw__hint">{{ MATH_RENDER_FAILED_HINT }}</span></span>
      <span v-else-if="seg.tail" class="ui-math-glue"><span class="ui-math-tex" v-html="seg.html" />{{ seg.tail }}</span>
      <span
        v-else
        :class="[seg.display ? 'ui-math-display' : 'ui-math-tex', { 'ui-math-scroll': seg.scroll }]"
        v-html="seg.html"
      />
    </template>
  </text>
</template>

<style>
.ui-math-text {
  font: inherit;
  color: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 100%;
}
.ui-math-text--serif {
  font-family: var(--font-serif);
  font-weight: 400;
}
.ui-math-tex .katex {
  font-size: 1.05em;
}
/* 公式和后面的标点之间不断行；公式内部（等号处）还可以断。 */
.ui-math-glue {
  white-space: nowrap;
}
.ui-math-glue .katex {
  white-space: normal;
}
.ui-math-display {
  display: block;
  max-width: 100%;
  margin: var(--sp-2) 0;
}
.ui-math-display .katex-display {
  margin: 0;
  text-align: left;
}
.ui-math-display .katex-display > .katex {
  text-align: left;
}
.ui-math-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.ui-math-scroll::-webkit-scrollbar {
  display: none;
}
.ui-math-tex.ui-math-scroll {
  display: inline-block;
  max-width: 100%;
  vertical-align: middle;
  white-space: nowrap;
}
.ui-math-fade-r {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}
.ui-math-fade-l {
  -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 24px), transparent);
  mask-image: linear-gradient(to left, #000 calc(100% - 24px), transparent);
}
.ui-math-fade-l.ui-math-fade-r {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent);
}
.ui-math-raw {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-1) var(--sp-2);
  max-width: 100%;
}
.ui-math-raw__src {
  font-family: var(--font-mono);
  font-size: 0.92em;
  font-weight: var(--fw-bold);
  overflow-wrap: anywhere;
  border-bottom: 2px dotted var(--rule-2);
}
.ui-math-raw__hint {
  font-family: var(--font-sans);
  font-size: var(--fs-12);
  font-weight: var(--fw-bold);
  color: var(--ink-2);
}
</style>
