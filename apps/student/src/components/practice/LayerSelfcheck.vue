<script setup lang="ts">
/** 第 4 层屏：自检。表单本身在 layers/SelfcheckForm，这里只接线。 */
import SelfcheckForm from '@/components/layers/SelfcheckForm.vue'
import type { ProofLine, SelfcheckView } from '@/types/attempt'

defineProps<{ view?: SelfcheckView | null; lines?: ProofLine[]; busy?: boolean; hideSkip?: boolean }>()
defineEmits<{
  (e: 'submit', itemId: string, text: string): void
  (e: 'skip'): void
}>()
</script>

<template>
  <SelfcheckForm :view="view ?? null" :lines="lines" :busy="busy" :hide-skip="hideSkip" @submit="(itemId, text) => $emit('submit', itemId, text)" @skip="$emit('skip')" />
</template>
