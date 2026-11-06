<script setup lang="ts">
/**
 * 各层共用的输入项：PgField 的外观 + 一个能写公式的输入框 + 小巧的「符号键盘」开关。
 * 键盘贴在屏幕底部，不挤表单；系统键盘照常可用。data-testid 等属性透传到输入框。
 */
import { computed, ref } from 'vue'
import MathTextEditor from '@ui-math/MathTextEditor.vue'
import ProofKeyboard from '@ui-math/ProofKeyboard.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgField from '@/components/ui/PgField.vue'
import PgIcon from '@/components/ui/PgIcon.vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    placeholder?: string
    maxlength?: number
    disabled?: boolean
    minRows?: number
  }>(),
  { label: undefined, placeholder: '', maxlength: undefined, disabled: false, minRows: 3 },
)
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const editor = ref<InstanceType<typeof MathTextEditor> | null>(null)
const keyboardOpen = ref(false)
const toggleLabel = computed(() => (keyboardOpen.value ? '收起符号键盘' : '符号键盘'))

function toggleKeyboard(): void {
  keyboardOpen.value = !keyboardOpen.value
  if (keyboardOpen.value) editor.value?.focus()
}
function closeKeyboard(): void {
  keyboardOpen.value = false
}
</script>

<template>
  <PgField :label="props.label">
    <MathTextEditor
      ref="editor"
      v-bind="$attrs"
      :model-value="props.modelValue"
      :placeholder="props.placeholder"
      :maxlength="props.maxlength"
      :disabled="props.disabled"
      :min-rows="props.minRows"
      :show-preview="false"
      :show-meta="false"
      :keyboard-open="keyboardOpen"
      @update:model-value="emit('update:modelValue', $event)"
      @request-system-keyboard="closeKeyboard"
      @close-keyboard="closeKeyboard"
    />
    <view class="pg-mathfield__tools">
      <PgButton
        class="pg-mathfield__toggle"
        variant="ghost"
        size="sm"
        :disabled="props.disabled"
        :aria-pressed="keyboardOpen ? 'true' : 'false'"
        data-testid="mathfield-keyboard-toggle"
        @tap="toggleKeyboard"
      >
        <PgIcon name="keys" :size="18" color="currentColor" /><text>{{ toggleLabel }}</text>
      </PgButton>
      <slot name="tools" />
    </view>
    <view v-if="keyboardOpen" class="pg-mathfield__kb" data-testid="mathfield-keyboard">
      <ProofKeyboard :visible="keyboardOpen" @insert="editor?.insertPayload($event)" @action="editor?.applyAction($event)" />
    </view>
    <view v-if="keyboardOpen" class="pg-mathfield__kbspace" aria-hidden="true" />
  </PgField>
</template>

<style scoped>
.pg-mathfield__tools { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); min-height: var(--touch); }
.pg-mathfield__toggle.pg-button { margin-left: calc(-1 * var(--sp-2)); gap: var(--sp-1); color: var(--ink-2); }
/* 键盘贴底（高于主按钮）；占位块让表单还能滚到键盘上方。 */
.pg-mathfield__kb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 35; }
.pg-mathfield__kbspace { height: max(38vh, 360px); }
</style>
