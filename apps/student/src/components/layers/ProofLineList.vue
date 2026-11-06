<script setup lang="ts">
/**
 * 证明行列表（issue #12；02 §3.1、§4.3、§7）。
 *
 * 只渲染服务端下发的 ProofLine / Note：
 * - 不做归类、不判对错。批注=助教在这一行有个问题想问，不是"错误"标记（02 §2.2）；
 * - 批注按 note.lineId 挂到对应行下方；找不到对应行的批注按契约统一挂在列表末尾；
 *   分组/尾部分拣是纯函数（./proofLines.ts），有 vitest 单测进 CI；
 * - ≥600px（平板/桌面）行内只留颜色标记，批注正文由页面页边栏（aside）渲染，
 *   避免同一条批注在两处各渲染一遍（02 §3.2；PR #90 复审第 4 条）；
 * - 颜色不读批注文案：annotation 一律 --sea，等 B 在契约加结构化字段（如 note.linked / note.cls）
 *   后再染色（PR #90 复审第 3 条）；
 * - 颜色/间距/字号只用 styles/tokens.css 的 CSS 变量，触控目标 ≥ 44px；
 * - 提交流程不在这里：本组件只 emit 'write-next'，加行由父级（practice 页）接 api。
 * - 做题页用轨道外观（rail / editable / animate / matchedLineIds / noteLayout，都默认关）；
 *   教师镜像不传这些，外观、动效和批注位置都不变。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import type { IconName } from '@/components/ui/icons'
import { noteWhoLabel } from '@/copy'
import { useViewport } from '@/composables/useViewport'
import { formatNoteTime, groupNotesByLine, notesForLine, selectTailNotes } from './proofLines'
import type { InputProvenance, Note, ProofLine } from '@/types/attempt'

const props = withDefaults(
  defineProps<{
    lines?: ProofLine[]
    notes?: Note[]
    busy?: boolean
    /** #43 镜像页：只读渲染，不显示「写下一行」等输入入口。 */
    readonly?: boolean
    /** 轨道外观：行连成一条带节点的竖线。 */
    rail?: boolean
    /** 每行可以改、可以删。 */
    editable?: boolean
    /** 新写的一行滑入。 */
    animate?: boolean
    /** 写到关键步骤的行（节点染绿）。 */
    matchedLineIds?: readonly string[]
    /** 批注放哪：auto 按宽度（≥600px 在页边）；inline 挂在行下；margin 只留标记。 */
    noteLayout?: 'auto' | 'inline' | 'margin'
  }>(),
  { lines: () => [], notes: () => [], busy: false, readonly: false, rail: false, editable: false, animate: false, matchedLineIds: () => [], noteLayout: 'auto' },
)
const emit = defineEmits<{
  (e: 'write-next'): void
  /** 学生手动关闭某条批注（#151）：只影响本页展示，由父级决定是否记入 dismissed 集合。 */
  (e: 'dismiss-note', noteId: string): void
  (e: 'edit-line', line: ProofLine): void
  (e: 'delete-line', line: ProofLine): void
}>()

const { mode } = useViewport()
/** 平板/桌面（≥600px）：行内只留标记，正文在页边（02 §3.2）。做题页按 noteLayout 指定。 */
const isWide = computed(() => (props.noteLayout === 'auto' ? mode.value !== 'mobile' : props.noteLayout === 'margin'))
const matched = computed(() => new Set(props.matchedLineIds))

/** 正在确认删除的行：删除放在行内，点两下才生效，不弹对话框。 */
const confirmingDelete = ref<string | null>(null)
function askDelete(line: ProofLine): void {
  confirmingDelete.value = line.lineId
}
function confirmDelete(line: ProofLine): void {
  confirmingDelete.value = null
  emit('delete-line', line)
}

/** 刚出现的行：带入场动画；首屏已有的行不动。 */
const enteringIds = ref<ReadonlySet<string>>(new Set())
let enterTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.lines.map((line) => line.lineId),
  (now, before) => {
    if (!props.animate || !before) return
    const known = new Set(before)
    const fresh = now.filter((id) => !known.has(id))
    if (fresh.length === 0) return
    enteringIds.value = new Set(fresh)
    if (enterTimer) clearTimeout(enterTimer)
    enterTimer = setTimeout(() => {
      enteringIds.value = new Set()
    }, 800)
  },
)
onBeforeUnmount(() => {
  if (enterTimer) clearTimeout(enterTimer)
})

/** 来源徽标（02 §3.1 证明行右侧的小标签）：手写 / 键盘 / 拍照 / 粘贴。 */
const PROVENANCE_LABEL: Record<InputProvenance, string> = {
  ink: '手写',
  keyboard: '键盘',
  photo: '拍照',
  mixed: '混合',
  paste: '粘贴',
}
const PROVENANCE_ICON: Partial<Record<InputProvenance, IconName>> = {
  ink: 'pen',
  keyboard: 'keys',
  photo: 'camera',
}

/** note.lineId → 该行下方的批注（纯函数，见 ./proofLines.ts）。 */
const notesByLine = computed(() => groupNotesByLine(props.notes))
/** 找不到对应行的批注：挂在列表末尾（手机）；≥600px 正文在页边栏，不重复渲染。 */
const tailNotes = computed(() => selectTailNotes(props.lines, props.notes))

function provenanceLabel(provenance?: InputProvenance | null): string {
  return provenance ? PROVENANCE_LABEL[provenance] : ''
}
/** 轨道上不标键盘（大多数行都是键盘，标了只是噪音）；手写和拍照来的行还是标出来。 */
function showBadge(provenance?: InputProvenance | null): boolean {
  if (props.rail) return provenance === 'ink' || provenance === 'photo'
  return Boolean(provenanceLabel(provenance))
}

function noteClass(note: Note): (string | false)[] {
  // 教师镜像是静态回放，批注不做进入动画。
  return ['pg-lines__note', 'pg-lines__note--' + note.kind, !props.readonly && 'pg-lines__note--enter']
}

function markerClass(note: Note): string[] {
  return ['pg-lines__marker', 'pg-lines__marker--' + note.kind]
}

/** 组件也兜一层 busy：不只靠按钮 :disabled（PR #90 复审建议）。 */
function onWriteNext() {
  if (props.busy) return
  emit('write-next')
}

/** 批注卡片的无障碍说明（#151）：署名 + 时间 + 正文，交给读屏。 */
function noteAria(note: Note): string {
  const time = formatNoteTime(note.at)
  const who = noteWhoLabel(note.who)
  const meta = time ? who + '，' + time : who
  return meta + '：' + note.text
}

function onDismissNote(note: Note): void {
  emit('dismiss-note', note.noteId)
}
</script>

<template>
  <view class="pg-lines" :class="{ 'pg-lines--rail': props.rail }" :data-testid="props.rail ? 'practice-rail' : undefined">
    <view
      v-for="line in props.lines"
      :key="line.lineId"
      class="pg-lines__row"
      :class="{ 'pg-lines__row--matched': matched.has(line.lineId), 'pg-lines__row--enter': enteringIds.has(line.lineId) }"
      data-testid="proof-line"
      :data-line-id="line.lineId"
      :data-line-no="line.n"
    >
      <text class="pg-lines__no">{{ line.n }}</text>
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
          <view v-if="showBadge(line.provenance)" class="pg-lines__badge">
            <PgIcon v-if="line.provenance && PROVENANCE_ICON[line.provenance]" :name="PROVENANCE_ICON[line.provenance]!" :size="14" />
            <text>{{ provenanceLabel(line.provenance) }}</text>
          </view>
          <view v-if="props.editable && confirmingDelete !== line.lineId" class="pg-lines__actions">
            <PgButton variant="ghost" size="sm" data-testid="line-edit" :aria-label="'改第 ' + line.n + ' 行'" :disabled="props.busy" @tap="emit('edit-line', line)">改</PgButton>
            <PgButton variant="ghost" size="sm" data-testid="line-delete" :aria-label="'删第 ' + line.n + ' 行'" :disabled="props.busy" @tap="askDelete(line)">删</PgButton>
          </view>
        </view>

        <!-- 删除放在行内，要再点一下确认 -->
        <view v-if="props.editable && confirmingDelete === line.lineId" class="pg-lines__confirm" role="group" aria-label="确认删除这一行">
          <text class="pg-lines__confirmtext">删掉这一行？</text>
          <PgButton variant="danger" size="sm" data-testid="line-delete-confirm" :disabled="props.busy" @tap="confirmDelete(line)">删掉</PgButton>
          <PgButton variant="ghost" size="sm" data-testid="line-delete-cancel" @tap="confirmingDelete = null">留着</PgButton>
        </view>

        <!-- 手机：行内批注全文；≥600px：只留颜色标记，正文在页边栏 -->
        <template v-if="!isWide">
          <view
            v-for="note in notesForLine(notesByLine, line.lineId)"
            :key="note.noteId"
            :class="noteClass(note)"
            role="note"
            :aria-label="noteAria(note)"
            data-testid="line-note"
            :data-note-kind="note.kind"
            :data-note-line-id="line.lineId"
          >
            <view class="pg-lines__notehead">
              <text class="pg-lines__notewho pg-small">{{ noteWhoLabel(note.who) }}</text>
              <text
                v-if="formatNoteTime(note.at)"
                class="pg-lines__notetime pg-small"
                data-testid="line-note-time"
              >{{ formatNoteTime(note.at) }}</text>
              <PgButton
                v-if="!props.readonly"
                class="pg-lines__notedismiss"
                variant="ghost"
                size="icon"
                aria-label="关闭这条批注"
                data-testid="line-note-dismiss"
                :data-note-id="note.noteId"
                @tap.stop="onDismissNote(note)"
              ><PgIcon name="close" :size="18" /></PgButton>
            </view>
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
        role="note"
        :aria-label="noteAria(note)"
        data-testid="line-note"
        :data-note-kind="note.kind"
      >
        <view class="pg-lines__notehead">
          <text class="pg-lines__notewho pg-small">{{ noteWhoLabel(note.who) }}</text>
          <text v-if="formatNoteTime(note.at)" class="pg-lines__notetime pg-small" data-testid="line-note-time">
            {{ formatNoteTime(note.at) }}
          </text>
          <PgButton
            v-if="!props.readonly"
            class="pg-lines__notedismiss"
            variant="ghost"
            size="icon"
            aria-label="关闭这条批注"
            data-testid="line-note-dismiss"
            :data-note-id="note.noteId"
            @tap.stop="onDismissNote(note)"
          ><PgIcon name="close" :size="18" /></PgButton>
        </view>
        <MathText class="pg-lines__notetext" :text="note.text" block />
      </view>
    </view>

    <text v-if="props.lines.length === 0" class="pg-lines__empty pg-small" data-testid="lines-empty">
      还没有写证明行。每次写一行：这一行（结论）+ 依据，顺序由你决定。
    </text>

    <view v-if="!props.readonly" class="pg-lines__next">
      <view v-if="props.rail" class="pg-lines__nextnode" aria-hidden="true" />
      <PgButton class="pg-lines__add" variant="secondary" block data-testid="write-next" sound="tap" :disabled="props.busy" @tap="onWriteNext">
        <PgIcon name="plus" :size="20" />
        <text>写下一行</text>
      </PgButton>
    </view>
  </view>
</template>

<style scoped>
.pg-lines { display: flex; flex-direction: column; gap: var(--sp-3); }

/* 证明行：一块厚边卡，行号是小方块 */
.pg-lines__row {
  display: flex;
  gap: var(--sp-3);
  padding: var(--sp-3);
  background: var(--sheet);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-16);
}
.pg-lines__no {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
}
.pg-lines__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-lines__stmt { color: var(--ink); font-size: var(--fs-18); line-height: 1.5; overflow-wrap: anywhere; }
.pg-lines__meta { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-1); }
.pg-lines__just {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 26px;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-13);
  font-weight: var(--fw-heavy);
}
.pg-lines__justlabel { flex: none; color: var(--ink-2); font-size: var(--fs-12); }
.pg-lines__justtext { min-width: 0; color: var(--ink-2); }
.pg-lines__justempty { color: var(--ink-2); }
.pg-lines__badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  margin-left: auto;
  color: var(--ink-2);
  font-size: var(--fs-12);
  line-height: 1.5;
  white-space: nowrap;
}

/* 行内批注：助教的话 = 蓝；提示 = 金；概念回答 = 绿（颜色只表达含义，02 §4.8） */
.pg-lines__note {
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink);
}
.pg-lines__note--enter { animation: pg-item-in var(--dur-slow) var(--ease-out) both; }
.pg-lines__notehead { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: 2px; }
.pg-lines__notewho { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pg-lines__notetime { color: var(--ink-2); font-family: var(--font-mono); font-size: var(--fs-12); }
/* 关闭批注（#151）：触控目标 ≥44px；不额外撑高卡片（用负外边距抵消）。 */
.pg-lines__notedismiss.pg-button { margin: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) auto; color: var(--ink-2); }
.pg-lines__notetext { color: var(--ink); line-height: 1.5; }
.pg-lines__note--annotation { background: var(--sea-soft); border-left: var(--bw) solid var(--margin); }
.pg-lines__note--annotation .pg-lines__notewho { color: var(--sea-text); }
.pg-lines__note--hint { background: var(--bee-soft); }
.pg-lines__note--hint .pg-lines__notewho { color: var(--bee-text); }
.pg-lines__note--concept { background: var(--accent-soft); }
.pg-lines__note--concept .pg-lines__notewho { color: var(--accent-text); }

/* ≥600px 行内标记：只用一个颜色点，正文在页边栏（02 §3.2）。 */
.pg-lines__markers { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-1); }
.pg-lines__marker { width: 10px; height: 10px; border-radius: 50%; background: var(--ink-3); }
.pg-lines__marker--annotation { background: var(--sea); }
.pg-lines__marker--hint { background: var(--bee); }
.pg-lines__marker--concept { background: var(--accent); }

.pg-lines__tail { padding: var(--sp-3) 0 0; }
.pg-lines__tailtitle { display: block; margin-bottom: var(--sp-1); color: var(--ink-2); font-weight: var(--fw-heavy); }
.pg-lines__empty { display: block; padding: var(--sp-4) 0; color: var(--ink-2); line-height: var(--lh-body); }
.pg-lines__add.pg-button { border-style: dashed; min-height: 56px; color: var(--ink-2); }
.pg-lines__next { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }

/* 轨道：行连成一条竖线，节点是行号；写到关键步骤的节点染绿。只有 rail 才生效，镜像不受影响。 */
.pg-lines--rail { gap: 0; margin-top: var(--sp-2); }
.pg-lines--rail .pg-lines__badge { margin-left: 0; }
.pg-lines--rail .pg-lines__row {
  position: relative;
  padding: 0 0 var(--sp-4);
  background: transparent;
  border: 0;
  border-radius: 0;
}
.pg-lines--rail .pg-lines__row::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  background: var(--rule-2);
}
.pg-lines--rail .pg-lines__no {
  position: relative;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border: var(--bw) solid var(--rule-2);
  border-radius: var(--radius-pill);
  background: var(--paper);
  transition: background-color var(--dur-base) ease-out, border-color var(--dur-base) ease-out;
}
.pg-lines__row--matched .pg-lines__no { border-color: var(--ok); background: var(--ok-soft); color: var(--ok-text); }
.pg-lines--rail .pg-lines__body { padding-top: 3px; }
.pg-lines__row--enter { animation: pg-item-in var(--dur-slow) var(--ease-out) both; }
.pg-lines__row--enter.pg-lines__row--matched .pg-lines__no { animation: pg-pop 380ms var(--ease-spring) both; }
.pg-lines__actions { display: flex; gap: 0; margin: calc(-1 * var(--sp-1)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-1)) auto; }
.pg-lines__actions .pg-button { min-width: var(--touch); color: var(--ink-2); }
.pg-lines__confirm { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); padding: var(--sp-1) var(--sp-2); border-radius: var(--radius-12); background: var(--paper-2); }
.pg-lines__confirmtext { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
/* 下一行的空节点：轨道的尽头就是「写下一行」。 */
.pg-lines__nextnode { flex: 0 0 32px; width: 32px; height: 32px; border: var(--bw) dashed var(--rule-2); border-radius: var(--radius-pill); }
.pg-lines--rail .pg-lines__tail { padding: 0 0 var(--sp-3); }
.pg-lines--rail .pg-lines__empty { padding: 0 0 var(--sp-3); }
</style>
