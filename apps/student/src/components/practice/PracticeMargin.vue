<script setup lang="ts">
/** 页边（桌面 ≥1024px）：助教的批注和求助入口。手机和平板上批注在行内，这里不渲染。 */
import MathText from '@ui-math/MathText.vue'
import { formatNoteTime } from '@/components/layers/proofLines'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import { noteWhoLabel } from '@/copy'
import type { Note } from '@/types/attempt'

defineProps<{ notes: Note[]; helpDisabled?: boolean; strictExam?: boolean }>()
defineEmits<{ (e: 'dismiss', noteId: string): void; (e: 'help'): void }>()
</script>

<template>
  <view class="pg-practice__aside" data-testid="practice-margin">
    <text class="pg-practice__asidetitle">助教的批注</text>
    <view
      v-for="n in notes"
      :key="n.noteId"
      class="pg-practice__note pg-sheet"
      :class="'pg-practice__note--' + n.kind"
      role="note"
      :aria-label="noteWhoLabel(n.who) + '：' + n.text"
    >
      <view class="pg-practice__notehead">
        <text class="pg-practice__notewho pg-small">{{ noteWhoLabel(n.who) }}</text>
        <text
          v-if="formatNoteTime(n.at)"
          class="pg-practice__notetime pg-small"
          data-testid="aside-note-time"
        >{{ formatNoteTime(n.at) }}</text>
        <PgButton
          class="pg-practice__notedismiss"
          variant="ghost"
          size="icon"
          aria-label="关闭这条批注"
          data-testid="aside-note-dismiss"
          :data-note-id="n.noteId"
          @tap.stop="$emit('dismiss', n.noteId)"
        ><PgIcon name="close" :size="18" /></PgButton>
      </view>
      <MathText class="pg-practice__notetext pg-small" :text="n.text" block />
    </view>
    <text v-if="notes.length === 0" class="pg-practice__empty pg-small">还没有批注。写完一行，助教的问题会出现在这一行旁边。</text>
    <view class="pg-practice__asidehelp">
      <PgButton
        class="pg-practice__btn"
        variant="hint"
        block
        :disabled="helpDisabled"
        :data-testid="strictExam ? 'exam-help-aside' : undefined"
        @tap="$emit('help')"
      >求助</PgButton>
    </view>
  </view>
</template>

<style scoped>
.pg-practice__aside {
  position: sticky;
  top: calc(var(--safe-top) + 64px);
  align-self: start;
  max-height: calc(100vh - 88px);
  overflow-y: auto;
  padding: var(--sp-1) var(--sp-1) var(--sp-3);
  min-width: 0;
}
.pg-practice__asidetitle {
  display: block;
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  margin-bottom: var(--sp-2);
}
.pg-practice__note {
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-2);
  border-radius: var(--radius-12);
}
.pg-practice__note--annotation { border-color: var(--sea); background: var(--sea-soft); }
.pg-practice__note--hint { border-color: var(--bee); background: var(--bee-soft); }
.pg-practice__note--concept { border-color: var(--accent); background: var(--accent-soft); }
.pg-practice__notehead { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: 2px; }
.pg-practice__notewho { display: block; color: var(--ink-2); }
.pg-practice__notetime { color: var(--ink-2); font-family: var(--font-mono); font-size: var(--fs-12); }
/* 关闭批注（#151）：触控目标 ≥44px，不额外撑高页边卡片。 */
.pg-practice__notedismiss.pg-button { margin: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) auto; color: var(--ink-2); }
.pg-practice__notetext { display: block; margin-top: 2px; color: var(--ink); }
.pg-practice__empty { color: var(--ink-2); }
.pg-practice__asidehelp { margin-top: var(--sp-3); }
</style>
