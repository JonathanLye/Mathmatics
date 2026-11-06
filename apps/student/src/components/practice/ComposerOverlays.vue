<script setup lang="ts">
/** 写证明的输入面板：行编辑器、手写、识别中占位、拍照逐行确认、单行确认卡。 */
import type { UnwrapNestedRefs } from 'vue'
import InkCanvas from '@ui-math/InkCanvas.vue'
import RecognitionConfirm from '@ui-math/RecognitionConfirm.vue'
import EditorSheet from '@/components/EditorSheet.vue'
import PhotoRecognitionPanel from '@/components/PhotoRecognitionPanel.vue'
import PgButton from '@/components/ui/PgButton.vue'
import type { ComposerHandle } from '@/composables/practice/useComposer'

defineProps<{ composer: UnwrapNestedRefs<ComposerHandle>; lineNo: number; busy?: boolean }>()
defineEmits<{ (e: 'draft', value: { statement: string; justification: string }): void }>()
</script>

<template>
  <EditorSheet
    :open="composer.editorOpen"
    :line-no="lineNo"
    :initial-statement="composer.editorInitialStatement"
    :initial-justification="composer.editorInitialJustification"
    :busy="busy"
    @update:open="composer.editorOpen = $event"
    @submit="composer.submitLine"
    @update:draft="$emit('draft', $event)"
  />

  <!-- #21 手写：全屏手写面板；「写完这一行」才调识别（不做实时识别） -->
  <view v-if="composer.inkOpen" class="pg-inksheet" data-testid="ink-sheet" role="dialog" aria-modal="true" aria-label="手写这一行">
    <view class="pg-inksheet__bar">
      <text class="pg-inksheet__title">手写第 {{ lineNo }} 行</text>
      <PgButton variant="secondary" size="sm" data-testid="ink-cancel" @tap="composer.cancelInk">取消</PgButton>
    </view>
    <view class="pg-inksheet__stage">
      <InkCanvas v-model="composer.inkValue" height="100%" @finish="composer.finishInk" />
    </view>
  </view>

  <!-- #15 拍照识别：识别中的占位（02 §4.5：超过 3 秒提示可先用键盘），拿到结果后进确认面板 -->
  <view v-if="composer.recogOpen && !composer.recognition" class="pg-recogmask">
    <view class="pg-recogloading pg-sheet">
      <text class="pg-recogloading__title" data-testid="photo-progress">{{ composer.photoProgress || '识别中…' }}</text>
      <text v-if="composer.recogSource === 'ink'" class="pg-recogloading__hint pg-small">识别结果只是候选，要你核对确认后才会用；识别不好可以改用键盘。</text>
      <text v-else class="pg-recogloading__hint pg-small">图片会先压缩（长边≤2000/≤2MB）再识别；结果要你逐行确认后才会用。</text>
      <PgButton variant="secondary" block @tap="composer.closeRecogLoading">取消</PgButton>
    </view>
  </view>
  <!-- #25 拍照整页识别：逐行确认（可勾选/编辑/全部加入/逐行加入/忽略） -->
  <PhotoRecognitionPanel
    v-if="composer.recognition && composer.photoPanelActive"
    :recognition="composer.recognition"
    :busy="composer.recogBusy || composer.photoAdding"
    @add="composer.addPhotoLines"
    @ignore="composer.ignoreRecognition"
  />
  <!-- 单行结果沿用 #15 两路确认卡 -->
  <RecognitionConfirm
    v-else-if="composer.recognition"
    :recognition="composer.recognition"
    :busy="composer.recogBusy"
    @rewrite="composer.rewriteRecognition"
    @confirm="composer.confirmRecognized"
    @discard="composer.discardRecognition"
  />
</template>

<style scoped>
.pg-inksheet {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.pg-inksheet__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: var(--bw) solid var(--rule);
}
.pg-inksheet__title { font-size: var(--fs-18); font-weight: var(--fw-black); color: var(--ink); }
.pg-inksheet__stage { flex: 1; min-height: 0; }
.pg-recogmask {
  position: fixed;
  inset: 0;
  z-index: 66;
  display: flex;
  align-items: flex-end;
  background: var(--mask);
}
.pg-recogloading {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  border-radius: var(--radius-24) var(--radius-24) 0 0;
  animation: pg-sheet-up var(--dur-slow) var(--ease-out) both;
}
.pg-recogloading__title {
  font-size: var(--fs-18);
  font-weight: var(--fw-black);
}
.pg-recogloading__hint { color: var(--ink-2); }
</style>
