<script setup lang="ts">
/** #27 草稿恢复提示：重新打开时告诉学生内容来自本机未提交的草稿。 */
import PgButton from '@/components/ui/PgButton.vue'

defineEmits<{ (e: 'dismiss'): void }>()
</script>

<template>
  <view class="pg-draftnotice" data-testid="draft-restored" role="status">
    <text class="pg-draftnotice__text pg-small">已恢复上次未提交的草稿</text>
    <PgButton variant="ghost" size="sm" data-testid="draft-restored-dismiss" @tap="$emit('dismiss')">知道了</PgButton>
  </view>
</template>

<style scoped>
.pg-draftnotice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border: 2px solid var(--accent);
  border-radius: var(--radius-16);
  background: var(--accent-soft);
  color: var(--ink);
  font-weight: var(--fw-bold);
}
.pg-draftnotice__text { flex: 1; min-width: 0; }
</style>
