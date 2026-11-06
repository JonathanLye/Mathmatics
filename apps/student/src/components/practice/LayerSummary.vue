<script setup lang="ts">
/** 第 6 层屏：总结。表单本身在 layers/SummaryForm，这里只接线。 */
import SummaryForm from '@/components/layers/SummaryForm.vue'
import type { SummaryView } from '@/types/attempt'

defineProps<{ view?: SummaryView | null; busy?: boolean }>()
defineEmits<{ (e: 'submit', answers: string[]): void }>()
</script>

<template>
  <SummaryForm :view="view ?? null" :busy="busy" @submit="$emit('submit', $event)" />
</template>
