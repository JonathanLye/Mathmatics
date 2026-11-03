<script setup lang="ts">
/**
 * 证明行列表（issue #12；02 §3.1、§4.3、§7）。
 *
 * 只渲染服务端下发的 ProofLine / Note：
 * - 不做归类、不判对错。红笔批注=助教在这一行有个问题想问，不是"错误"标记（02 §2.2）；
 * - 批注按 note.lineId 挂到对应行下方；找不到对应行的批注按契约统一挂在列表末尾；
 *   分组/尾部分拣是纯函数（./proofLines.ts），有 vitest 单测进 CI；
 * - ≥600px（平板/桌面）行内只留颜色标记，批注正文由页面页边栏（aside）渲染，
 *   避免同一条批注在两处各渲染一遍（02 §3.2；PR #90 复审第 4 条）；
 * - 颜色不读批注文案：annotation 一律 --margin，等 B 在契约加结构化字段（如 note.linked / note.cls）
 *   后再染色（PR #90 复审第 3 条）；
 * - 颜色/间距/字号只用 styles/tokens.css 的 CSS 变量，触控目标 ≥ 44px；
 * - 提交流程不在这里：本组件只 emit 'write-next'，加行由父级（practice 页）接 api。
 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
import { useViewport } from '@/composables/useViewport'
import { groupNotesByLine, notesForLine, selectTailNotes } from './proofLines'
import type { InputProvenance, Note, ProofLine } from '@/types/attempt'

const props = withDefaults(
  defineProps<{
    lines?: ProofLine[]
    notes?: Note[]
    busy?: boolean
  }>(),
  { lines: () => [], notes: () => [], busy: false },
)
const emit = defineEmits<{ (e: 'write-next'): void }>()

const { mode } = useViewport()
/** 平板/桌面（≥600px）：行内只留标记，正文在页边（02 §3.2）。 */
const isWide = computed(() => mode.value !== 'mobile')

/** 来源徽标（02 §3.1 证明行右侧的小标签）：手写 / 键盘 / 拍照 / 粘贴。 */
const PROVENANCE_LABEL: Record<InputProvenance, string> = {
  ink: '✍ 手写',
  keyboard: '⌨ 键盘',
  photo: '📷 拍照',
  mixed: '✍⌨ 混合',
  paste: '📋 粘贴',
}

/** note.lineId → 该行下方的批注（纯函数，见 ./proofLines.ts）。 */
const notesByLine = computed(() => groupNotesByLine(props.notes))
/** 找不到对应行的批注：挂在列表末尾（手机）；≥600px 正文在页边栏，不重复渲染。 */
const tailNotes = computed(() => selectTailNotes(props.lines, props.notes))

function provenanceLabel(provenance?: InputProvenance | null): string {
  return provenance ? PROVENANCE_LABEL[provenance] : ''
}

function noteClass(note: Note): string[] {
  return ['pg-lines__note', 'pg-lines__note--' + note.kind]
}

function markerClass(note: Note): string[] {
  return ['pg-lines__marker', 'pg-lines__marker--' + note.kind]
}

/** 组件也兜一层 busy：不只靠按钮 :disabled（PR #90 复审建议）。 */
function onWriteNext() {
  if (props.busy) return
  emit('write-next')
}
</script>

<template>
  <view class="pg-lines" data-testid="proof-line-list">
    <view
      v-for="line in props.lines"
      :key="line.lineId"
      class="pg-lines__row"
      data-testid="proof-line"
      :data-line-id="line.lineId"
      :data-line-no="line.n"
    >
      <text class="pg-lines__no pg-mono">{{ line.n }}</text>
      <view class="pg-lines__body">
        <view class="pg-lines__stmt">
          <MathText :text="line.statement" block />
        </view>

        <view class="pg-lines__meta">
          <view class="pg-lines__just">
            <text class="pg-lines__justlabel pg-small">依据</text>
            <MathText v-if="line.justification" class="pg-lines__justtext" :text="line.justification" />
            <text v-else class="pg-lines__justempty pg-small">（未写）</text>
          </view>
          <text v-if="provenanceLabel(line.provenance)" class="pg-lines__badge">{{ provenanceLabel(line.provenance) }}</text>
        </view>

        <!-- 手机：行内批注全文；≥600px：只留颜色标记，正文在页边栏 -->
        <template v-if="!isWide">
          <view
            v-for="note in notesForLine(notesByLine, line.lineId)"
            :key="note.noteId"
            :class="noteClass(note)"
            data-testid="line-note"
            :data-note-kind="note.kind"
            :data-note-line-id="line.lineId"
          >
            <text class="pg-lines__notewho pg-small">{{ note.who }}</text>
            <MathText class="pg-lines__notetext" :text="note.text" block />
          </view>
        </template>
        <view v-else-if="notesForLine(notesByLine, line.lineId).length" class="pg-lines__markers" data-testid="line-markers" aria-hidden="true">
          <view
            v-for="note in notesForLine(notesByLine, line.lineId)"
            :key="note.noteId"
            :class="markerClass(note)"
            data-testid="line-note-marker"
            :data-note-kind="note.kind"
            :data-note-line-id="line.lineId"
          />
        </view>
      </view>
    </view>

    <view v-if="!isWide && tailNotes.length" class="pg-lines__tail" data-testid="tail-notes">
      <text class="pg-lines__tailtitle pg-small">更多批注</text>
      <view
        v-for="note in tailNotes"
        :key="note.noteId"
        :class="noteClass(note)"
        data-testid="line-note"
        :data-note-kind="note.kind"
      >
        <text class="pg-lines__notewho pg-small">{{ note.who }}</text>
        <MathText class="pg-lines__notetext" :text="note.text" block />
      </view>
    </view>

    <text v-if="props.lines.length === 0" class="pg-lines__empty pg-small" data-testid="lines-empty">
      还没有写证明行。每次写一行：这一行（结论）+ 依据，顺序由你决定。
    </text>

    <button class="pg-lines__add" data-testid="write-next" :disabled="props.busy" @tap="onWriteNext">
      <text class="pg-lines__addicon">＋</text>
      <text>写下一行</text>
    </button>
  </view>
</template>

<style scoped>
.pg-lines {
  display: flex;
  flex-direction: column;
}

.pg-lines__row {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--rule);
}

.pg-lines__no {
  flex: 0 0 24px;
  width: 24px;
  padding-top: 2px;
  text-align: right;
  color: var(--ink-2);
  font-size: var(--fs-mono);
}

.pg-lines__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pg-lines__stmt {
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  overflow-wrap: anywhere;
}

.pg-lines__meta {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
  flex-wrap: wrap;
  margin-top: 2px;
}

.pg-lines__just {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  color: var(--ink-2);
  font-size: var(--fs-small);
}

.pg-lines__justlabel {
  flex: 0 0 auto;
  color: var(--ink-2);
}

.pg-lines__justtext {
  min-width: 0;
}

.pg-lines__justempty {
  color: var(--ink-2);
}

.pg-lines__badge {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1px var(--sp-2);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-2);
  /* 元信息 12–13px（02 §2.3），用 --fs-mono=12px，不写死 11px。 */
  font-size: var(--fs-mono);
  line-height: 1.5;
  white-space: nowrap;
}

/* 行内批注（手机）：红笔左边线 + 批注底色（02 §3.1 / §4.8）。
   颜色只表达含义：--margin=助教提问，--hint=计透露量的提示，--accent=概念回答。
   annotation 一律 --margin；不读 note.text 推断"衔接上了"（PR #90 复审第 3 条：
   等 B 在契约加结构化字段 note.linked / note.cls 后再染色）。 */
.pg-lines__note {
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-left: 3px solid var(--rule);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  background: var(--paper);
  color: var(--ink);
  animation: pg-note-in var(--dur-fast) ease-out;
}

.pg-lines__notewho {
  display: block;
  margin-bottom: 2px;
  color: var(--ink-2);
}

.pg-lines__notetext {
  color: var(--ink);
}

.pg-lines__note--annotation {
  border-left-color: var(--margin);
  background: var(--margin-soft);
}
.pg-lines__note--annotation .pg-lines__notewho {
  color: var(--margin);
}

.pg-lines__note--hint {
  border-left-color: var(--hint);
  background: var(--hint-soft);
}
.pg-lines__note--hint .pg-lines__notewho {
  color: var(--hint);
}

.pg-lines__note--concept {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}
.pg-lines__note--concept .pg-lines__notewho {
  color: var(--accent);
}

.pg-lines__note--system,
.pg-lines__note--refusal,
.pg-lines__note--lesson,
.pg-lines__note--nudge,
.pg-lines__note--student {
  border-left-color: var(--rule);
  background: var(--paper);
}

/* ≥600px 行内标记：只用一个颜色点，正文在页边栏（02 §3.2；PR #90 复审第 4 条）。 */
.pg-lines__markers {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.pg-lines__marker {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-2);
}

.pg-lines__marker--annotation {
  background: var(--margin);
}

.pg-lines__marker--hint {
  background: var(--hint);
}

.pg-lines__marker--concept {
  background: var(--accent);
}

.pg-lines__tail {
  padding: var(--sp-3) 0 0;
}

.pg-lines__tailtitle {
  display: block;
  margin-bottom: var(--sp-1);
  color: var(--ink-2);
}

.pg-lines__empty {
  display: block;
  padding: var(--sp-4) 0;
  color: var(--ink-2);
  line-height: var(--lh-body);
}

.pg-lines__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 48px;
  margin-top: var(--sp-3);
  border: 1px dashed var(--rule);
  border-radius: var(--radius-input);
  background: transparent;
  color: var(--accent);
  font-size: 15px;
}

.pg-lines__add::after {
  border: 0;
}

.pg-lines__add:disabled {
  opacity: 0.45;
}

.pg-lines__addicon {
  font-size: 18px;
  line-height: 1;
}

@keyframes pg-note-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
