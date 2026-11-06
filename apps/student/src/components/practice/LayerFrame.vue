<script setup lang="ts">
/** 第 2 层屏：骨架表单。表单本身在 layers/Layer2Form，这里只接线。 */
import Layer2Form from '@/components/layers/Layer2Form.vue'
import type { FrameView } from '@/types/attempt'

defineProps<{ view?: FrameView; busy?: boolean; hideSkip?: boolean }>()
defineEmits<{
  (e: 'submit', text: string): void
  (e: 'lesson'): void
  (e: 'skip'): void
}>()
</script>

<template>
  <Layer2Form layer="L2" :view="view ?? {}" :busy="busy" :hide-skip="hideSkip" @submit="$emit('submit', $event)" @lesson="$emit('lesson')" @skip="$emit('skip')" />
</template>
