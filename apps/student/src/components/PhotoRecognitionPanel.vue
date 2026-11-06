<script setup lang="ts">
/**
 * 拍照识别 · 逐行确认面板（#25 / 03 §3.3、02 §4.6）。
 *
 * - 服务端 /recognitions/photo 返回整页切出的 lines（含 text、可选 bbox/confidence）；
 * - 逐行展示 MathText；可勾选、可编辑（编辑的是 MathText 源文本，选中/加入时才生效）；
 * - 动作：「全部加入」（勾选行）、每行「加入这行」、忽略；
 * - 只渲染服务端结果，不做识别/一致性判定；加入行由父级（practice）走既有 addLine 路径。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { Recognition } from '@/types/attempt'

interface PhotoLine {
  text: string
  checked: boolean
  editing: boolean
  bbox?: number[]
  confidence?: number
}

const props = withDefaults(defineProps<{ recognition: Recognition; busy?: boolean }>(), { busy: false })
const emit = defineEmits<{
  (e: 'add', payload: { texts: string[]; indices: number[] }): void
  (e: 'ignore'): void
}>()

const lines = ref<PhotoLine[]>([])

watch(
  () => props.recognition,
  (value) => {
    const source = value.lines && value.lines.length > 0 ? value.lines : value.text ? [{ text: value.text }] : []
    lines.value = source.map((line) => ({
      text: line.text,
      checked: true,
      editing: false,
      bbox: line.bbox,
      confidence: line.confidence,
    }))
  },
  { immediate: true },
)

const selectedCount = computed(() => lines.value.filter((line) => line.checked).length)
const summary = computed(() => '识别出 ' + lines.value.length + ' 行 · 已选 ' + selectedCount.value + ' 行')
const statusHint = computed(() => {
  if (props.recognition.status === 'empty') return '没有识别到文字；可以重新拍照或用键盘。'
  if (props.recognition.status === 'low_confidence') return '识别置信度较低，请逐行核对后再加入。'
  if (props.recognition.status === 'error') return '这次识别失败；可以重新拍照或用键盘。'
  return ''
})

function toggle(index: number): void {
  if (props.busy) return
  const line = lines.value[index]
  if (line) line.checked = !line.checked
}

function startEdit(index: number): void {
  if (props.busy) return
  const line = lines.value[index]
  if (line) line.editing = true
}

function finishEdit(index: number): void {
  const line = lines.value[index]
  if (line) line.editing = false
}

function bboxText(bbox?: number[]): string {
  if (!bbox || bbox.length !== 4) return ''
  return '位置 ' + bbox.map((value) => Math.round(value)).join(',')
}

function confidenceText(confidence?: number): string {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return ''
  return '置信度 ' + Math.round(confidence * 100) + '%'
}

function addSelected(): void {
  if (props.busy) return
  const texts: string[] = []
  const indices: number[] = []
  lines.value.forEach((line, index) => {
    if (!line.checked) return
    const text = line.text.trim()
    if (!text) return
    texts.push(text)
    indices.push(index)
  })
  if (texts.length === 0) return
  emit('add', { texts, indices })
}

function addOne(index: number): void {
  if (props.busy) return
  const line = lines.value[index]
  const text = line?.text.trim() ?? ''
  if (!text) return
  emit('add', { texts: [text], indices: [index] })
}

function ignore(): void {
  if (props.busy) return
  emit('ignore')
}
</script>

<template>
  <view class="pg-photo" data-testid="photo-recognition-panel" role="dialog" aria-modal="true" aria-label="拍照识别逐行确认">
    <view class="pg-photo__sheet">
      <view class="pg-photo__head">
        <view class="pg-photo__headtext">
          <text class="pg-photo__title">拍照识别 · 逐行确认</text>
          <text class="pg-photo__summary pg-small" data-testid="photo-lines-summary">{{ summary }}</text>
        </view>
        <button class="pg-photo__close" :disabled="props.busy" @tap="ignore">关闭</button>
      </view>

      <text v-if="statusHint" class="pg-photo__hint pg-small">{{ statusHint }}</text>

      <scroll-view scroll-y class="pg-photo__list">
        <view
          v-for="(line, index) in lines"
          :key="index"
          class="pg-photo__line"
          :data-testid="'photo-line-' + index"
        >
          <view class="pg-photo__linehead">
            <button
              class="pg-photo__check"
              role="checkbox"
              :aria-checked="line.checked"
              :aria-label="'第 ' + (index + 1) + ' 行，' + (line.checked ? '已选中' : '未选中')"
              :data-testid="'photo-line-check-' + index"
              :disabled="props.busy"
              @tap="toggle(index)"
            >{{ line.checked ? '☑' : '☐' }}</button>
            <text class="pg-photo__lineno pg-small">第 {{ index + 1 }} 行</text>
            <text v-if="bboxText(line.bbox)" class="pg-photo__meta pg-small" :data-testid="'photo-line-bbox-' + index">{{ bboxText(line.bbox) }}</text>
            <text v-if="confidenceText(line.confidence)" class="pg-photo__meta pg-small">{{ confidenceText(line.confidence) }}</text>
            <button
              v-if="!line.editing"
              class="pg-photo__editbtn pg-small"
              :data-testid="'photo-line-edit-' + index"
              :disabled="props.busy"
              @tap="startEdit(index)"
            >编辑</button>
            <button
              v-else
              class="pg-photo__editbtn pg-small"
              :data-testid="'photo-line-edit-done-' + index"
              :disabled="props.busy"
              @tap="finishEdit(index)"
            >完成</button>
          </view>

          <view class="pg-photo__linebody">
            <textarea
              v-if="line.editing"
              v-model="line.text"
              class="pg-photo__input"
              :data-testid="'photo-line-input-' + index"
              :disabled="props.busy"
            />
            <MathText v-else :text="line.text" block />
          </view>

          <view class="pg-photo__lineactions">
            <button
              class="pg-photo__addone pg-small"
              role="button"
              :data-testid="'photo-line-add-' + index"
              :disabled="props.busy"
              @tap="addOne(index)"
            >加入这行</button>
          </view>
        </view>
      </scroll-view>

      <view class="pg-photo__actions">
        <button class="pg-photo__btn pg-photo__ignore" role="button" data-testid="photo-ignore" :disabled="props.busy" @tap="ignore">忽略</button>
        <button
          class="pg-photo__btn pg-photo__btn--primary"
          role="button"
          data-testid="photo-add-selected"
          :disabled="props.busy || selectedCount === 0"
          @tap="addSelected"
        >全部加入（{{ selectedCount }} 行）</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-photo {
  position: fixed;
  inset: 0;
  z-index: 68;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.48);
}
.pg-photo__sheet {
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  background: var(--sheet);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--shadow-sheet);
}
.pg-photo__head { display: flex; align-items: flex-start; gap: var(--sp-2); }
.pg-photo__headtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pg-photo__title { font-size: var(--fs-stem); font-weight: 900; color: var(--ink); }
.pg-photo__summary { color: var(--ink-2); }
.pg-photo__close {
  margin-left: auto;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-photo__hint { color: var(--hint); }
.pg-photo__list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-photo__line {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: 2px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--paper);
}
.pg-photo__linehead { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.pg-photo__check {
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--accent-text);
  font-size: 20px;
}
.pg-photo__lineno { color: var(--ink-2); }
.pg-photo__meta { color: var(--ink-2); }
.pg-photo__editbtn { margin-left: auto; color: var(--accent-text); background: transparent; border: 2px solid var(--rule); border-radius: var(--radius-input); min-height: 32px; padding: 0 var(--sp-2); }
.pg-photo__linebody { color: var(--ink); }
.pg-photo__input {
  width: 100%;
  min-height: 64px;
  padding: var(--sp-2);
  border: 2px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: var(--fs-body);
}
.pg-photo__lineactions { display: flex; justify-content: flex-end; }
.pg-photo__addone {
  min-height: 36px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent-text);
  border-radius: var(--radius-input);
  padding: 0 var(--sp-3);
}
.pg-photo__actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
.pg-photo__btn {
  flex: 1;
  min-height: 44px;
  border-radius: var(--radius-input);
  border: 2px solid var(--rule);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
}
.pg-photo__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.pg-photo__btn:disabled { opacity: 0.45; }
</style>
