<script setup lang="ts">
/** 第 1 层屏：定义表单。表单本身在 layers/Layer1Form，这里只接线。 */
import Layer1Form from '@/components/layers/Layer1Form.vue'
import type { DefView } from '@/types/attempt'

defineProps<{ view?: DefView; busy?: boolean; initialText?: string; reviewing?: boolean }>()
defineEmits<{
  (e: 'submit', text: string): void
  (e: 'update:text', value: string): void
  (e: 'lesson'): void
  (e: 'skip'): void
}>()
</script>

<template>
  <Layer1Form
    layer="L1"
    :view="view ?? {}"
    :busy="busy"
    :initial-text="initialText"
    :reviewing="reviewing"
    @submit="$emit('submit', $event)"
    @update:text="$emit('update:text', $event)"
    @lesson="$emit('lesson')"
    @skip="$emit('skip')"
  />
</template>
