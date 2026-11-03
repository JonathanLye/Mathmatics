<script setup lang="ts">
/**
 * 证明键盘（#13，03-手写键盘与识别.md §4，02-学生端设计规范.md §4.7）。
 *
 * - 布局只读自 contracts/keyboard-layout.json（唯一源 10-开发文档/contracts/，经 keyboard.ts 归一化）；
 * - 6 层标签（常用 / 证明句式 / 关系·集合 / 希腊 / 函数·分析 / 123）+ 右侧固定动作列 ← → ⇥ ⌫ 中 ✍ 完成；
 * - 点键 emit insert(payload)：载荷里的 #0/#1… 占位标记由 MathTextEditor 解释落字；
 * - 长按 variants 的键弹出变体条，点选后插入（03 §4.2「长按显示变体」）；
 * - 「中」同时 emit action('system') 与 toggle-system-keyboard，父级把 keyboardOpen 置 false 并让编辑器聚焦；
 * - 记住学生上次停留的层（uni storage / 03 §4.2）；每次按键轻微震动，可用 haptics=false 关闭。
 *
 * 推荐接线：
 *   <ProofKeyboard :visible="kbOpen" @insert="editor?.insertPayload($event)" @action="editor?.applyAction($event)" />
 */
import { computed, ref, watch } from 'vue'
import {
  keyboardLayout,
  normalizeKeyboardLayout,
  variantLabel,
  type KeyboardActionId,
  type KeyboardInsertPayload,
  type KeyboardKeyMode,
  type KeyboardLayout,
  type KeyboardLayoutKey,
} from './keyboard'

// haptics 默认 true：布尔 prop 缺省会被转换成 false，必须显式给默认值
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** 默认读 contracts/keyboard-layout.json；也接受该 JSON 原文或已归一化布局 */
    layout?: unknown
    disabled?: boolean
    /** 每次按键轻微震动（03 §4.2），默认开 */
    haptics?: boolean
  }>(),
  { haptics: true },
)

const emit = defineEmits<{
  (e: 'insert', payload: KeyboardInsertPayload): void
  (e: 'action', id: KeyboardActionId): void
  (e: 'toggle-system-keyboard'): void
  (e: 'layer-change', layerId: string): void
}>()

const STORAGE_KEY = 'pg.kbd.layer'

function readStoredLayer(): string {
  try {
    const value = uni.getStorageSync(STORAGE_KEY)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function storeLayer(layerId: string): void {
  try {
    uni.setStorageSync(STORAGE_KEY, layerId)
  } catch {
    /* 隐私模式/平台限制：记住层失败不影响使用 */
  }
}

const resolvedLayout = computed<KeyboardLayout>(() => {
  if (!props.layout) return keyboardLayout
  try {
    return normalizeKeyboardLayout(props.layout)
  } catch (error) {
    console.warn('[ProofKeyboard] layout 不合法，回退到 contracts/keyboard-layout.json', error)
    return keyboardLayout
  }
})

const activeLayerId = ref<string>(readStoredLayer())
const activeLayer = computed(() => {
  const layout = resolvedLayout.value
  const found = layout.layers.find((layer) => layer.id === activeLayerId.value)
  return found ?? layout.layers[0]
})

watch(
  () => resolvedLayout.value,
  (layout) => {
    if (!layout.layers.some((layer) => layer.id === activeLayerId.value)) {
      activeLayerId.value = layout.layers[0]?.id ?? ''
    }
  },
)

function selectLayer(layerId: string): void {
  if (!resolvedLayout.value.layers.some((layer) => layer.id === layerId)) return
  activeLayerId.value = layerId
  storeLayer(layerId)
  emit('layer-change', layerId)
}

function haptic(): void {
  if (!props.haptics) return
  try {
    const vibrate = (uni as unknown as { vibrateShort?: (options?: unknown) => void }).vibrateShort
    if (typeof vibrate === 'function') vibrate({ type: 'light' })
  } catch {
    /* 桌面浏览器/不支持震动的设备：忽略 */
  }
}

const variantKey = ref<KeyboardLayoutKey | null>(null)

function emitInsert(text: string, key: KeyboardLayoutKey): void {
  const payload: KeyboardInsertPayload = {
    text,
    mode: key.mode as KeyboardKeyMode,
    kind: key.kind,
    keyId: key.id,
    label: key.label,
    cursorOffset: 0,
  }
  if (key.latex !== undefined) payload.latex = key.latex
  emit('insert', payload)
}

function pressKey(key: KeyboardLayoutKey): void {
  if (props.disabled) return
  // 长按弹出的变体条还在时，松手产生的 tap 不再插入基础键
  if (variantKey.value) return
  haptic()
  emitInsert(key.insert, key)
}

function openVariants(key: KeyboardLayoutKey): void {
  if (props.disabled || key.variants.length === 0) return
  variantKey.value = key
  haptic()
}

function chooseVariant(variant: string): void {
  const key = variantKey.value
  variantKey.value = null
  if (!key || props.disabled) return
  haptic()
  emitInsert(variant, key)
}

function closeVariants(): void {
  variantKey.value = null
}

function pressAction(id: KeyboardActionId): void {
  if (props.disabled && id !== 'done') return
  haptic()
  emit('action', id)
  if (id === 'system') emit('toggle-system-keyboard')
}

function isDenseRow(row: KeyboardLayoutKey[]): boolean {
  return row.length >= 9
}

defineExpose({ selectLayer, closeVariants, activeLayerId, resolvedLayout })
</script>

<template>
  <view
    v-if="visible"
    class="ui-pk"
    :class="{ 'ui-pk--disabled': props.disabled }"
    role="group"
    aria-label="证明键盘"
    data-testid="proof-keyboard"
  >
    <view class="ui-pk__tabs" role="tablist">
      <view
        v-for="layer in resolvedLayout.layers"
        :key="layer.id"
        class="ui-pk__tab"
        :class="{ 'ui-pk__tab--active': layer.id === activeLayer.id }"
        :aria-selected="layer.id === activeLayer.id"
        :data-layer-id="layer.id"
        @tap="selectLayer(layer.id)"
      >{{ layer.label }}</view>
    </view>

    <view class="ui-pk__body">
      <view class="ui-pk__rows">
        <view
          v-for="(row, rowIndex) in activeLayer.rows"
          :key="rowIndex"
          class="ui-pk__row"
          :class="{ 'ui-pk__row--dense': isDenseRow(row) }"
        >
          <view
            v-for="key in row"
            :key="key.id"
            class="ui-pk__key"
            :class="{ 'ui-pk__key--template': key.kind === 'template', 'ui-pk__key--phrase': key.kind === 'phrase' }"
            hover-class="ui-pk__key--press"
            :aria-label="key.hint || key.label"
            :data-key-id="key.id"
            :data-key-label="key.label"
            @tap="pressKey(key)"
            @longpress="openVariants(key)"
          >
            <text class="ui-pk__keylabel">{{ key.label }}</text>
            <text v-if="key.variants.length > 0" class="ui-pk__variantdot">·</text>
          </view>
        </view>
      </view>

      <view class="ui-pk__actions">
        <view
          v-for="action in resolvedLayout.actions"
          :key="action.id"
          class="ui-pk__action"
          :class="'ui-pk__action--' + action.id"
          hover-class="ui-pk__action--press"
          :aria-label="action.hint || action.label"
          :data-action-id="action.id"
          @tap="pressAction(action.id)"
        >{{ action.label }}</view>
      </view>
    </view>

    <view v-if="variantKey" class="ui-pk__variantmask" @tap="closeVariants" />
    <view v-if="variantKey" class="ui-pk__variants" data-testid="proof-keyboard-variants">
      <view class="ui-pk__varianthead">
        <text class="ui-pk__varianttitle">{{ variantKey.label }} 的长按变体</text>
        <text class="ui-pk__variantclose" @tap="closeVariants">取消</text>
      </view>
      <view class="ui-pk__variantrow">
        <view
          v-for="(variant, index) in variantKey.variants"
          :key="index"
          class="ui-pk__variant"
          hover-class="ui-pk__variant--press"
          :data-variant-index="index"
          @tap="chooseVariant(variant)"
        >{{ variantLabel(variant) }}</view>
      </view>
    </view>
  </view>
</template>

<style>
.ui-pk {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: max(38vh, 360px); /* 02 §4.7：高度约屏高 38%；矮屏保底 360px 保证 44px 触控 */
  box-sizing: border-box;
  padding-bottom: var(--safe-bottom, 0px);
  background: var(--sheet, #fff);
  border-top: 1px solid var(--rule, #e2e4e8);
  box-shadow: var(--shadow-dock, 0 -1px 0 #e2e4e8, 0 -6px 18px rgba(29, 36, 48, 0.06));
}
.ui-pk--disabled {
  opacity: 0.55;
}
.ui-pk__tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
  padding: var(--sp-1, 4px) var(--sp-2, 8px) 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.ui-pk__tab {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0 var(--sp-2, 8px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-small, 13px);
  color: var(--ink-2, #5d6878);
  border-radius: var(--radius-input, 6px) var(--radius-input, 6px) 0 0;
}
.ui-pk__tab--active {
  color: var(--accent, #2b4fa3);
  background: var(--accent-soft, #e8eefb);
  font-weight: 600;
}
.ui-pk__body {
  flex: 1 1 auto;
  display: flex;
  gap: var(--sp-1, 4px);
  min-height: 0;
  padding: 2px var(--sp-2, 8px) 0;
}
.ui-pk__rows {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  overflow-y: auto;
}
.ui-pk__row {
  flex: 1 1 0;
  display: flex;
  gap: 4px;
  min-height: 44px;
  max-height: 78px;
}
.ui-pk__key {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-input, 6px);
  background: var(--sheet, #fff);
  color: var(--ink, #1d2430);
}
.ui-pk__key--template {
  background: var(--accent-soft, #e8eefb);
  color: var(--accent, #2b4fa3);
}
.ui-pk__key--phrase {
  background: var(--paper, #f7f6f2);
  font-size: var(--fs-small, 13px);
  padding: 2px 4px;
}
/* 证明句式键文字较长（如「当 0<|x−x₀|<δ 时」），允许换行而不是被截断 */
.ui-pk__key--phrase .ui-pk__keylabel {
  white-space: normal;
  text-align: center;
  line-height: 1.2;
  font-size: 11px;
}
.ui-pk__key--press {
  background: var(--accent-soft, #e8eefb);
}
.ui-pk__keylabel {
  font-size: 15px;
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ui-pk__row--dense .ui-pk__keylabel {
  font-size: 11px;
  letter-spacing: -0.2px;
}
.ui-pk__variantdot {
  position: absolute;
  right: 3px;
  bottom: 1px;
  font-size: 10px;
  line-height: 1;
  color: var(--ink-2, #5d6878);
}
.ui-pk__actions {
  flex: 0 0 56px;
  display: grid;
  grid-template-rows: repeat(7, minmax(44px, 1fr));
  gap: 1px;
}
.ui-pk__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-input, 6px);
  background: var(--paper, #f7f6f2);
  color: var(--ink, #1d2430);
  font-size: 15px;
}
.ui-pk__action--press {
  background: var(--accent-soft, #e8eefb);
}
.ui-pk__action--system {
  color: var(--accent, #2b4fa3);
  font-weight: 600;
}
.ui-pk__action--done {
  border-color: var(--accent, #2b4fa3);
  background: var(--accent, #2b4fa3);
  color: #fff;
}
.ui-pk__variantmask {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(29, 36, 48, 0.18);
}
.ui-pk__variants {
  position: absolute;
  left: var(--sp-2, 8px);
  right: var(--sp-2, 8px);
  bottom: calc(var(--sp-2, 8px) + var(--safe-bottom, 0px));
  z-index: 6;
  padding: var(--sp-2, 8px) var(--sp-3, 12px);
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-card, 10px);
  background: var(--sheet, #fff);
  box-shadow: var(--shadow-sheet, 0 -8px 28px rgba(29, 36, 48, 0.16));
}
.ui-pk__varianthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-1, 4px);
}
.ui-pk__varianttitle {
  font-size: var(--fs-small, 13px);
  color: var(--ink-2, #5d6878);
}
.ui-pk__variantclose {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: var(--fs-small, 13px);
  color: var(--accent, #2b4fa3);
}
.ui-pk__variantrow {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2, 8px);
}
.ui-pk__variant {
  min-width: 64px;
  min-height: 44px;
  padding: 0 var(--sp-3, 12px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-input, 6px);
  background: var(--paper, #f7f6f2);
  color: var(--ink, #1d2430);
  font-size: 17px;
}
.ui-pk__variant--press {
  background: var(--accent-soft, #e8eefb);
}
</style>
