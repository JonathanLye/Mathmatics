<script setup lang="ts">
/** #46 严格测验覆盖层：水印（不遮挡交互）→ 退出全屏 → 切出警告 → 锁定遮罩 → 说明页。 */
import type { UnwrapNestedRefs } from 'vue'
import PgButton from '@/components/ui/PgButton.vue'
import ExamIntro from '@/components/exam/ExamIntro.vue'
import ExamLeaveModal from '@/components/exam/ExamLeaveModal.vue'
import ExamLockOverlay from '@/components/exam/ExamLockOverlay.vue'
import ExamWatermark from '@/components/exam/ExamWatermark.vue'
import type { ExamHandle } from '@/composables/practice/useExamMode'

defineProps<{ exam: UnwrapNestedRefs<ExamHandle>; completed?: boolean }>()
</script>

<template>
  <ExamWatermark v-if="exam.strictExamActive" :text="exam.watermarkContent" />

  <view
    v-if="exam.fullscreenExitVisible && exam.strictExamActive && !exam.examIsLocked"
    class="pg-fsexit"
    data-testid="exam-fullscreen-exit"
    role="alertdialog"
    aria-modal="true"
  >
    <view class="pg-fsexit__sheet">
      <text class="pg-fsexit__title">你已退出全屏</text>
      <text class="pg-fsexit__text pg-small">请回到全屏继续本场测验；退出全屏会被记录。</text>
      <PgButton block size="lg" data-testid="exam-return-fullscreen" @tap="exam.returnFullscreen">回到全屏</PgButton>
    </view>
  </view>

  <ExamLeaveModal
    :visible="exam.leaveWarningVisible"
    :count="exam.leaveWarningCount"
    :max-warnings="exam.maxWarnings"
    @dismiss="exam.leaveWarningVisible = false"
  />
  <ExamLockOverlay
    :visible="exam.examIsLocked"
    :warnings="exam.warnings"
    :max-warnings="exam.maxWarnings"
    :retrying="exam.examRefreshing"
    @retry="exam.refreshExamState"
  />
  <ExamIntro
    v-if="exam.strictExam && !exam.examStarted && !completed"
    :remaining-text="exam.countdownText"
    :max-warnings="exam.maxWarnings"
    :fullscreen-note="exam.fullscreenNote"
    :busy="exam.examStartBusy"
    @start="exam.startExam"
  />
</template>

<style scoped>
.pg-fsexit {
  position: fixed;
  inset: 0;
  z-index: 87;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: var(--mask-strong);
}
.pg-fsexit__sheet {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--sheet);
  border: 2px solid var(--rule);
  border-radius: var(--radius-24);
}
.pg-fsexit__title { font-size: var(--fs-22); font-weight: var(--fw-black); color: var(--ink); }
.pg-fsexit__text { color: var(--ink-2); line-height: 1.6; }
</style>
