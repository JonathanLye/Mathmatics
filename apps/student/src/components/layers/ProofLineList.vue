<script setup lang="ts">
/**
 * 证明行列表（issue #12；02 §3.1、§4.3、§7）。
 *
 * 只渲染服务端下发的 ProofLine / Note：
 * - 不做归类、不判对错。红笔批注=助教在这一行有个问题想问，不是"错误"标记（02 §2.2）；
 * - 行内批注按 note.lineId 挂到对应行下方；找不到对应行的批注按契约统一挂在列表末尾；
 * - 颜色/间距/字号只用 styles/tokens.css 里的 CSS 变量，触控目标 ≥ 44px；
 * - 提交流程不在这里：本组件只 emit 'write-next'，加行由父级（practice 页）接 api。
 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
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

/** 来源徽标（02 §3.1 证明行右侧的小标签）：手写 / 键盘 / 拍照 / 粘贴。 */
const PROVENANCE_LABEL: Record<InputProvenance, string> = {
  ink: '✍ 手写',
  keyboard: '⌨ 键盘',
  photo: '📷 拍照',
  mixed: '✍⌨ 混合',
  paste: '📋 粘贴',
}

const lineIds = computed(() => new Set(props.lines.map((line) => line.lineId)))

/** note.lineId → 该行下方的批注（保持服务端下发的时间正序）。 */
const notesByLine = computed(() => {
  const map = new Map<string, Note[]>()
  for (const note of props.notes) {
    if (!note.lineId) continue
    const list = map.get(note.lineId)
    if (list) list.push(note)
    else map.set(note.lineId, [note])
  }
  return map
})

/** 找不到对应行的批注（lineId 为空或该行已不在 state 里）：按契约挂在列表末尾。 */
const tailNotes = computed(() => props.notes.filter((note) => !note.lineId || !lineIds.value.has(note.lineId)))

function notesFor(lineId: string): Note[] {
  return notesByLine.value.get(lineId) ?? []
}

function provenanceLabel(provenance?: InputProvenance | null): string {
  return provenance ? PROVENANCE_LABEL[provenance] : ''
}

function noteClass(note: Note): string[] {
  const classes = ['pg-lines__note', 'pg-lines__note--' + note.kind]
  // 命中关键步骤且有依据时，服务端的说法是"…衔接上了。"（01 §3 L3）：用绿色边线（02 §3.1）。
  // 这仍然只是助教的一句陈述，不是前端判定。
  if (note.kind === 'annotation' && note.text.includes('衔接上了')) classes.push('pg-lines__note--linked')
  return classes
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

        <view
          v-for="note in notesFor(line.lineId)"
          :key="note.noteId"
          :class="noteClass(note)"
          data-testid="line-note"
          :data-note-kind="note.kind"
          :data-note-line-id="line.lineId"
        >
          <text class="pg-lines__notewho pg-small">{{ note.who }}</text>
          <MathText class="pg-lines__notetext" :text="note.text" block />
        </view>
      </view>
    </view>

    <view v-if="tailNotes.length" class="pg-lines__tail" data-testid="tail-notes">
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

    <button class="pg-lines__add" data-testid="write-next" :disabled="props.busy" @tap="emit('write-next')">
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
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}

/* 行内批注：红笔左边线 + 批注底色（02 §3.1 / §4.8）。
   颜色只表达含义：--margin=助教提问，--ok=衔接上了，--hint=计透露量的提示，--accent=概念回答。 */
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

/* 服务端说"衔接上了"时用绿色边线（02 §3.1）；写在 --annotation 之后以覆盖红色。 */
.pg-lines__note--linked {
  border-left-color: var(--ok);
  background: var(--paper);
}
.pg-lines__note--linked .pg-lines__notewho {
  color: var(--ok);
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
