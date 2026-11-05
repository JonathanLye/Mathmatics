<script setup lang="ts">
/**
 * 第 5 层 · 迁移题子作答（kind=transfer，01 §L5「完整流程」）。
 *
 * - 迁移题任务卡（MathText）+ #47 TransferOutlineDiagram 思路对照；
 * - 多行证明：行号 / 这一行 / 依据 / 来源徽标 / 行内批注（复用 #12 的列表形态做轻量版）；
 *   批注卡片与 L3 一致：署名 / 时间 / 正文 / 关闭（#151；readonly 只读镜像不显示关闭）；
 * - 行编辑器：结论 + 依据 + 来源（键盘/手写/拍照 mock），支持改写与删除一行；
 * - 「写完了」是否可点由服务端 state.canFinish 决定（mock reducer 判定，前端不判）。
 * 前端只渲染 state + 上抛事件；不显示任何标准答案/讲解。
 */
import { computed, ref } from 'vue'
import MathText from '@ui-math/MathText.vue'
import TransferOutlineDiagram from '@/components/diagrams/TransferOutlineDiagram.vue'
import { formatNoteTime, groupNotesByLine, notesForLine } from './proofLines'
import type { InputProvenance, Note, ProblemView, ProofLine } from '@/types/attempt'

const props = withDefaults(
  defineProps<{
    problem: ProblemView
    lines?: ProofLine[]
    notes?: Note[]
    canFinish?: boolean
    busy?: boolean
    /** 只读（教师镜像页）：批注卡片不渲染关闭按钮（#151 / #153）。 */
    readonly?: boolean
  }>(),
  { lines: () => [], notes: () => [], canFinish: false, busy: false, readonly: false },
)

interface TransferLineDraft {
  statement: string
  justification: string
  provenance: InputProvenance
}

const emit = defineEmits<{
  (e: 'add-line', draft: TransferLineDraft): void
  (e: 'edit-line', lineId: string, draft: TransferLineDraft): void
  (e: 'delete-line', lineId: string): void
  (e: 'finish'): void
  /** 学生关闭某条行内批注（#151 / #153）：父级用 filterDismissedNotes 只隐藏本页展示，不回写服务端。 */
  (e: 'dismiss-note', noteId: string): void
}>()

const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const statement = ref('')
const justification = ref('')
const provenance = ref<InputProvenance>('keyboard')

const PROVENANCE_LABEL: Record<string, string> = {
  keyboard: '键盘',
  ink: '手写',
  photo: '拍照',
  mixed: '混合',
  paste: '粘贴',
}
const PROVENANCE_OPTIONS: InputProvenance[] = ['keyboard', 'ink', 'photo']

const canSave = computed(() => statement.value.trim().length > 0 && !props.busy)

/** 行内批注只取 annotation；分组复用 #12/#151 的纯函数（与 L3 同一套口径，不另写过滤）。 */
const annotationNotesByLine = computed(() =>
  groupNotesByLine(props.notes.filter((note) => note.kind === 'annotation')),
)
function notesFor(lineId: string): Note[] {
  return notesForLine(annotationNotesByLine.value, lineId)
}
/** 批注卡片的无障碍说明（#151）：署名 + 时间 + 正文。 */
function noteAria(note: Note): string {
  const time = formatNoteTime(note.at)
  const meta = time ? note.who + '，' + time : note.who
  return meta + '：' + note.text
}
function dismissNote(note: Note): void {
  emit('dismiss-note', note.noteId)
}
function label(provenanceValue?: InputProvenance): string {
  return PROVENANCE_LABEL[provenanceValue ?? 'keyboard'] ?? '键盘'
}

function openAdd() {
  if (props.busy) return
  editingId.value = null
  statement.value = ''
  justification.value = ''
  provenance.value = 'keyboard'
  editorOpen.value = true
}

function openEdit(line: ProofLine) {
  if (props.busy) return
  editingId.value = line.lineId
  statement.value = line.statement
  justification.value = line.justification ?? ''
  provenance.value = line.provenance ?? 'keyboard'
  editorOpen.value = true
}

function cancel() {
  editorOpen.value = false
  editingId.value = null
}

function save() {
  if (!canSave.value) return
  const draft: TransferLineDraft = {
    statement: statement.value.trim(),
    justification: justification.value.trim(),
    provenance: provenance.value,
  }
  if (editingId.value) emit('edit-line', editingId.value, draft)
  else emit('add-line', draft)
  editorOpen.value = false
  editingId.value = null
}

function remove(line: ProofLine) {
  if (props.busy) return
  emit('delete-line', line.lineId)
}
</script>

<template>
  <view class="pg-layer pg-attempt" data-testid="transfer-attempt">
    <view class="pg-layer__head">
      <text class="pg-layer__title">迁移题 · 完整作答</text>
      <text class="pg-layer__step pg-small">{{ props.lines.length }} 行 · {{ props.canFinish ? '可以写完了' : '未达标' }}</text>
    </view>

    <view class="pg-attempt__task pg-sheet" data-testid="transfer-attempt-task">
      <text class="pg-attempt__label pg-small">迁移题</text>
      <MathText :text="props.problem.stem" serif block />
    </view>

    <view data-testid="transfer-outline">
      <TransferOutlineDiagram />
    </view>

    <text class="pg-layer__hint pg-small">
      和第 3 层一样：一行一个结论，再写依据；至少两行、关键步骤齐全才能点「写完了」。
    </text>

    <view class="pg-attempt__lines" data-testid="transfer-lines">
      <view v-if="props.lines.length === 0" class="pg-attempt__empty pg-sheet pg-small" data-testid="transfer-empty">
        还没有写证明行。点「＋ 写下一行」开始。
      </view>
      <view v-for="line in props.lines" :key="line.lineId" class="pg-attempt__row pg-sheet" :data-testid="'transfer-line-' + line.n">
        <view class="pg-attempt__rowhead">
          <text class="pg-attempt__no pg-mono">{{ line.n }}</text>
          <text class="pg-attempt__badge pg-small">{{ label(line.provenance) }}</text>
          <text v-if="(line.justification || '').trim()" class="pg-attempt__badge pg-attempt__badge--ok pg-small">有依据</text>
          <text v-else class="pg-attempt__badge pg-attempt__badge--warn pg-small">依据没写</text>
          <view class="pg-attempt__actions">
            <button class="pg-attempt__link" role="button" :data-testid="'transfer-edit-' + line.n" :disabled="props.busy" @tap="openEdit(line)">
              改一行
            </button>
            <button class="pg-attempt__link pg-attempt__link--danger" role="button" :data-testid="'transfer-delete-' + line.n" :disabled="props.busy" @tap="remove(line)">
              删除
            </button>
          </view>
        </view>
        <MathText :text="line.statement" block />
        <text class="pg-attempt__just pg-small">依据 {{ (line.justification || '').trim() || '（未写）' }}</text>
        <view
          v-for="note in notesFor(line.lineId)"
          :key="note.noteId"
          class="pg-attempt__note"
          role="note"
          :aria-label="noteAria(note)"
          :data-testid="'transfer-note-' + line.n"
          :data-note-kind="note.kind"
        >
          <view class="pg-attempt__notehead">
            <text class="pg-attempt__notewho pg-small">{{ note.who }}</text>
            <text
              v-if="formatNoteTime(note.at)"
              class="pg-attempt__notetime pg-small"
              :data-testid="'transfer-note-time-' + line.n"
            >{{ formatNoteTime(note.at) }}</text>
            <button
              v-if="!props.readonly"
              class="pg-attempt__notedismiss"
              role="button"
              aria-label="关闭这条批注"
              :data-testid="'transfer-note-dismiss-' + line.n"
              :data-note-id="note.noteId"
              @tap.stop="dismissNote(note)"
            >×</button>
          </view>
          <MathText :text="note.text" block />
        </view>
      </view>
    </view>

    <view v-if="editorOpen" class="pg-attempt__editor pg-sheet" data-testid="transfer-editor">
      <text class="pg-attempt__editortitle">{{ editingId ? '改这一行' : '写下一行' }}</text>
      <textarea
        v-model="statement"
        class="pg-attempt__input"
        data-testid="transfer-statement"
        :maxlength="2000"
        :disabled="props.busy"
        placeholder="这一行（结论）……例如：当 0<|x-1|<δ 时，"
        placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
      />
      <textarea
        v-model="justification"
        class="pg-attempt__input pg-attempt__input--short"
        data-testid="transfer-justification"
        :maxlength="500"
        :disabled="props.busy"
        placeholder="依据：为什么成立……"
        placeholder-style="font-size:16px;line-height:1.65;color:#9aa5b5;padding:10px 12px"
      />
      <view class="pg-attempt__provenance">
        <text class="pg-small pg-attempt__provlabel">来源</text>
        <button
          v-for="option in PROVENANCE_OPTIONS"
          :key="option"
          class="pg-attempt__prov"
          :class="{ 'pg-attempt__prov--active': provenance === option }"
          role="button"
          :data-testid="'transfer-provenance-' + option"
          @tap="provenance = option"
        >
          {{ PROVENANCE_LABEL[option] }}
        </button>
      </view>
      <view class="pg-layer__row">
        <button class="pg-layer__btn" role="button" data-testid="transfer-editor-cancel" :disabled="props.busy" @tap="cancel">取消</button>
        <button class="pg-layer__btn pg-layer__btn--primary" role="button" data-testid="transfer-editor-save" :disabled="!canSave" @tap="save">
          {{ editingId ? '保存这一行' : '加入证明' }}
        </button>
      </view>
    </view>

    <view class="pg-attempt__footer">
      <button class="pg-layer__btn" role="button" data-testid="transfer-add-line" :disabled="props.busy || editorOpen" @tap="openAdd">
        ＋ 写下一行
      </button>
      <button
        class="pg-layer__btn pg-layer__btn--primary"
        role="button"
        data-testid="transfer-finish"
        :disabled="!props.canFinish || props.busy"
        @tap="emit('finish')"
      >
        写完了
      </button>
    </view>
  </view>
</template>

<style scoped>
.pg-layer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3) 0 var(--sp-4);
  min-width: 0;
}
.pg-layer__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-layer__title { font-size: 17px; font-weight: 900; color: var(--ink); }
.pg-layer__step { color: var(--ink-2); flex: 0 0 auto; }
.pg-layer__hint { color: var(--ink-2); }
.pg-layer__row { display: flex; gap: var(--sp-2); }
.pg-layer__row .pg-layer__btn { flex: 1; }
.pg-layer__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.2;
}
.pg-layer__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.pg-layer__btn[disabled] { opacity: 0.45; }
.pg-attempt__task { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-3); font-family: var(--font-serif); color: var(--ink); }
.pg-attempt__label { color: var(--ink-2); font-family: var(--font-sans); }
.pg-attempt__lines { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-attempt__empty { padding: var(--sp-3); color: var(--ink-2); }
.pg-attempt__row { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-attempt__rowhead { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.pg-attempt__no { color: var(--ink-2); font-size: 12px; }
.pg-attempt__badge { padding: 1px var(--sp-2); border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-2); }
.pg-attempt__badge--ok { border-color: var(--ok); color: var(--ok); }
.pg-attempt__badge--warn { border-color: var(--hint); color: var(--hint); }
.pg-attempt__actions { margin-left: auto; display: flex; gap: var(--sp-2); }
.pg-attempt__link {
  min-height: 32px;
  padding: 0 var(--sp-2);
  border: 0;
  background: transparent;
  color: var(--accent-text);
  font-size: 13px;
}
.pg-attempt__link--danger { color: var(--margin-text); }
.pg-attempt__just { color: var(--ink-2); }
.pg-attempt__note { margin-top: var(--sp-1); padding: var(--sp-1) var(--sp-2); border-left: 3px solid var(--margin); background: var(--margin-soft); }
.pg-attempt__notehead { display: flex; align-items: center; gap: var(--sp-1); }
.pg-attempt__notewho { color: var(--ink-2); }
.pg-attempt__notetime { color: var(--ink-2); font-family: var(--font-mono); font-size: var(--fs-mono); }
/* 关闭批注（#151 / #153）：触控目标 ≥44px；负外边距避免撑高轻量卡片。 */
.pg-attempt__notedismiss {
  flex: 0 0 auto;
  margin-left: auto;
  margin-top: calc(-1 * var(--sp-1));
  margin-bottom: calc(-1 * var(--sp-1));
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 1;
}
.pg-attempt__notedismiss::after { border: 0; }
.pg-attempt__editor { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); }
.pg-attempt__editortitle { font-size: 15px; font-weight: 900; }
.pg-attempt__input {
  display: block;
  width: 100%;
  height: 96px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--paper);
  overflow: hidden;
}
.pg-attempt__input--short { height: 64px; }
.pg-attempt__input :deep(.uni-textarea-wrapper) { height: 100%; }
.pg-attempt__input :deep(textarea) {
  width: 100%;
  height: 94px;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.65;
  resize: none;
}
.pg-attempt__input--short :deep(textarea) { height: 62px; }
.pg-attempt__provenance { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.pg-attempt__provlabel { color: var(--ink-2); }
.pg-attempt__prov {
  min-height: 32px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
}
.pg-attempt__prov--active { border-color: var(--accent); color: var(--accent-text); background: var(--accent-soft); }
.pg-attempt__footer { display: flex; gap: var(--sp-2); }
.pg-attempt__footer .pg-layer__btn { flex: 1; }
</style>
