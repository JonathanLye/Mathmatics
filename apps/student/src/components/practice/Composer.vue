<script setup lang="ts">
/**
 * 写下一行：一个面板，手写 / 键盘 / 拍照切换。「这一行」和「依据」三种方式共用。
 * 键盘：证明键盘 + 实时预览。手写：画布 → 识别 → 核对，都在这一屏，不叠弹层。拍照：逐行确认，也在这一屏。
 * 识别失败只说一句人话并给出口，学生写的内容不动。
 */
import { computed, ref, watch, type UnwrapNestedRefs } from 'vue'
import InkCanvas from '@ui-math/InkCanvas.vue'
import MathText from '@ui-math/MathText.vue'
import MathTextEditor from '@ui-math/MathTextEditor.vue'
import ProofKeyboard from '@ui-math/ProofKeyboard.vue'
import RecognitionConfirm from '@ui-math/RecognitionConfirm.vue'
import PhotoRecognitionPanel from '@/components/PhotoRecognitionPanel.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgField from '@/components/ui/PgField.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { useViewport } from '@/composables/useViewport'
import type { ComposerHandle, ComposerTab } from '@/composables/practice/useComposer'
import { justificationCandidates } from './proofRail'
import type { ProofLine } from '@/types/attempt'

const props = defineProps<{
  composer: UnwrapNestedRefs<ComposerHandle>
  lineNo: number
  lines: ProofLine[]
  busy?: boolean
  /** 测验模式：拍照关闭。 */
  photoDisabled?: boolean
}>()

const { mode } = useViewport()
const statementEditor = ref<InstanceType<typeof MathTextEditor> | null>(null)
const justificationEditor = ref<InstanceType<typeof MathTextEditor> | null>(null)
const activeField = ref<'statement' | 'justification'>('statement')
const keyboardOpen = ref(false)

const editing = computed(() => Boolean(props.composer.editingLine))
const title = computed(() => (editing.value ? '改第 ' + props.composer.editingLine?.n + ' 行' : '第 ' + props.lineNo + ' 行'))
const tabOptions = computed(() => [
  { value: 'hand' as const, label: '手写', testid: 'composer-tab-hand' },
  { value: 'keyboard' as const, label: '键盘', testid: 'composer-tab-keyboard' },
  { value: 'photo' as const, label: '拍照', testid: 'composer-tab-photo', disabled: props.photoDisabled },
])
const activeTab = computed<ComposerTab>(() => (editing.value ? 'keyboard' : props.composer.tab))
const hasStatement = computed(() => props.composer.statement.trim().length > 0)
const candidates = computed(() => justificationCandidates(props.lines))
const recognizingInk = computed(() => props.composer.recogBusy && props.composer.recogSource === 'ink')
const workingPhoto = computed(() => props.composer.recogBusy && props.composer.recogSource === 'photo' && !props.composer.photoAdding)
/** 拍照逐行确认时只有这一件事要做：不显示依据和提交。 */
const lineFieldsVisible = computed(() => !(activeTab.value === 'photo' && props.composer.photoConfirming) && !(activeTab.value === 'hand' && props.composer.inkConfirming))

// 打开面板或切到键盘时：手机和平板默认弹证明键盘；桌面有实体键盘，要用再开。
watch(
  () => [props.composer.editorOpen, activeTab.value] as const,
  ([open, tab]) => {
    activeField.value = 'statement'
    keyboardOpen.value = open && tab === 'keyboard' && mode.value !== 'desktop'
  },
)

const activeEditor = computed(() => (activeField.value === 'justification' ? justificationEditor.value : statementEditor.value))

function onStatement(value: string): void {
  props.composer.statement = value
  props.composer.saveDraft()
}
function onJustification(value: string): void {
  props.composer.justification = value
  props.composer.saveDraft()
}
function pickCandidate(text: string): void {
  onJustification(text)
}
function toggleKeyboard(): void {
  keyboardOpen.value = !keyboardOpen.value
  if (keyboardOpen.value) activeEditor.value?.focus()
}
function switchTab(next: ComposerTab): void {
  props.composer.chooseTab(next)
}
/** 键盘上的 ✍ 切到手写；其余动作交给当前输入框。 */
function onKeyboardAction(action: string): void {
  if (action === 'ink') switchTab('hand')
  else activeEditor.value?.applyAction(action)
}
</script>

<template>
  <PgSheet
    :open="composer.editorOpen"
    :persistent="busy"
    :z-index="65"
    :width="640"
    mask-testid="editor-mask"
    class="pg-composer"
    :class="{ 'pg-composer--keyboard': keyboardOpen && activeTab === 'keyboard' }"
    data-testid="editor-sheet"
    :aria-label="title"
    @update:open="composer.closeComposer"
  >
    <view class="pg-composer__head">
      <PgButton class="pg-composer__close" variant="ghost" size="icon" aria-label="取消" data-testid="editor-cancel" :disabled="busy" @tap="composer.closeComposer">
        <PgIcon name="close" :size="24" />
      </PgButton>
      <text class="pg-composer__title">{{ title }}</text>
      <PgButton
        v-if="lineFieldsVisible"
        class="pg-composer__submit"
        data-testid="editor-submit"
        sound="tap"
        :loading="busy"
        :disabled="!composer.canSubmit"
        @tap="composer.submit"
      >{{ busy ? '正在加入…' : editing ? '保存改写' : '加入证明' }}</PgButton>
    </view>

    <PgSegmented v-if="!editing" :model-value="composer.tab" :options="tabOptions" label="用什么方式写" @update:model-value="switchTab" />

    <view class="pg-composer__body">
      <!-- 键盘 -->
      <PgField v-if="activeTab === 'keyboard'" label="这一行">
        <MathTextEditor
          ref="statementEditor"
          data-testid="editor-statement"
          :model-value="composer.statement"
          :keyboard-open="keyboardOpen"
          :disabled="busy"
          :min-rows="2"
          :maxlength="2000"
          :show-meta="false"
          placeholder="写下结论或算式"
          @update:model-value="onStatement"
          @focus="activeField = 'statement'"
          @request-system-keyboard="keyboardOpen = false"
          @close-keyboard="keyboardOpen = false"
        />
      </PgField>

      <!-- 手写：画布 → 识别 → 核对，都在这一屏 -->
      <view v-else-if="activeTab === 'hand'" class="pg-composer__stage" data-testid="ink-sheet">
        <view v-if="recognizingInk" class="pg-composer__working" role="status">
          <PgMascot expr="think" motion="think-tilt" :size="72" />
          <text class="pg-composer__workingtext" data-testid="photo-progress">{{ composer.photoProgress || '正在识别这一行…' }}</text>
          <text class="pg-composer__note">结果只是候选，要你核对确认后才会用。</text>
          <PgButton variant="secondary" data-testid="ink-cancel" @tap="composer.cancelRecognition">取消</PgButton>
        </view>
        <RecognitionConfirm
          v-else-if="composer.inkConfirming && composer.recognition"
          inline
          title="这样写对吗？"
          :recognition="composer.recognition"
          :busy="composer.recogBusy"
          @confirm="composer.confirmRecognized"
          @rewrite="composer.discardRecognition"
          @discard="composer.discardRecognition"
        />
        <view v-else-if="hasStatement" class="pg-composer__filled" data-testid="composer-statement-preview">
          <text class="pg-composer__filledlabel">这一行</text>
          <MathText :text="composer.statement" block />
          <view class="pg-layer__row">
            <PgButton variant="secondary" size="sm" data-testid="composer-rewrite" :disabled="busy" @tap="composer.rewriteInk">重写</PgButton>
            <PgButton variant="secondary" size="sm" data-testid="composer-edit-keyboard" :disabled="busy" @tap="switchTab('keyboard')">用键盘改</PgButton>
          </view>
        </view>
        <template v-else>
          <view class="pg-composer__canvas">
            <InkCanvas v-model="composer.inkValue" height="100%" @finish="composer.finishInk" />
          </view>
          <view v-if="composer.inkFailure" class="pg-composer__inkfail" role="status" data-testid="ink-failure">
            <text class="pg-composer__inkfailtext">{{ composer.inkFailure }}</text>
            <PgButton variant="secondary" size="sm" data-testid="ink-failure-keyboard" @tap="switchTab('keyboard')">用键盘</PgButton>
          </view>
        </template>
      </view>

      <!-- 拍照：选图 → 识别 → 逐行确认，都在这一屏 -->
      <view v-else class="pg-composer__stage" data-testid="composer-photo">
        <view v-if="workingPhoto" class="pg-composer__working" role="status">
          <PgMascot expr="think" motion="think-tilt" :size="72" />
          <text class="pg-composer__workingtext" data-testid="photo-progress">{{ composer.photoProgress || '识别中…' }}</text>
          <text class="pg-composer__note">结果要你逐行确认后才会用。</text>
          <PgButton variant="secondary" @tap="composer.cancelRecognition">取消</PgButton>
        </view>
        <PhotoRecognitionPanel
          v-else-if="composer.photoConfirming && composer.recognition"
          :recognition="composer.recognition"
          :busy="composer.recogBusy || composer.photoAdding"
          @add="composer.addPhotoLines"
          @ignore="composer.ignoreRecognition"
        />
        <view v-else-if="composer.photoFailure" class="pg-composer__failure" role="status" data-testid="photo-failure">
          <PgMascot expr="think" :motion="null" :size="72" />
          <text class="pg-composer__failuretitle" data-testid="photo-failure-title">{{ composer.photoFailure.title }}</text>
          <text class="pg-composer__note">{{ composer.photoFailure.body }}</text>
          <view class="pg-layer__row pg-composer__failureactions">
            <PgButton data-testid="photo-failure-hand" @tap="switchTab('hand')"><PgIcon name="pen" :size="20" color="currentColor" /><text>用手写</text></PgButton>
            <PgButton data-testid="photo-failure-keyboard" @tap="switchTab('keyboard')"><PgIcon name="keys" :size="20" color="currentColor" /><text>用键盘</text></PgButton>
          </view>
          <PgButton variant="ghost" size="sm" data-testid="photo-failure-retry" @tap="composer.retryPhoto">再试一次拍照</PgButton>
        </view>
        <view v-else class="pg-composer__photoidle">
          <view v-if="hasStatement" class="pg-composer__filled" data-testid="composer-statement-preview">
            <text class="pg-composer__filledlabel">这一行</text>
            <MathText :text="composer.statement" block />
          </view>
          <text class="pg-composer__note">拍一整页也可以，识别后你逐行确认，选中的行才会加入证明。</text>
          <view class="pg-layer__row">
            <PgButton data-testid="photo-take" @tap="composer.startPhoto('camera')"><PgIcon name="camera" :size="20" color="currentColor" /><text>拍照</text></PgButton>
            <PgButton variant="secondary" data-testid="photo-album" @tap="composer.startPhoto('album')">从相册选</PgButton>
          </view>
        </view>
      </view>

      <!-- 依据：三种方式共用 -->
      <PgField v-if="lineFieldsVisible" label="依据" optional="可空">
        <MathTextEditor
          ref="justificationEditor"
          data-testid="editor-justification"
          :model-value="composer.justification"
          :keyboard-open="keyboardOpen && activeTab === 'keyboard'"
          :disabled="busy"
          :min-rows="2"
          :maxlength="1000"
          :show-preview="false"
          :show-meta="false"
          placeholder="这一行由哪条定义或已证结论得到？"
          @update:model-value="onJustification"
          @focus="activeField = 'justification'"
          @request-system-keyboard="keyboardOpen = false"
          @close-keyboard="keyboardOpen = false"
        />
        <view v-if="candidates.length && !composer.justification" class="pg-composer__candidates">
          <view
            v-for="candidate in candidates"
            :key="candidate"
            class="pg-composer__candidate"
            role="button"
            tabindex="0"
            data-testid="justification-candidate"
            @tap="pickCandidate(candidate)"
            @keydown.enter.prevent="pickCandidate(candidate)"
          ><MathText :text="candidate" /></view>
        </view>
      </PgField>

      <PgButton
        v-if="activeTab === 'keyboard' && !keyboardOpen"
        class="pg-composer__kbtoggle"
        variant="ghost"
        size="sm"
        data-testid="composer-keyboard-toggle"
        :aria-pressed="keyboardOpen ? 'true' : 'false'"
        @tap="toggleKeyboard"
      >
        <PgIcon name="keys" :size="18" color="currentColor" /><text>证明键盘</text>
      </PgButton>
    </view>

    <view v-if="activeTab === 'keyboard' && keyboardOpen" class="pg-composer__keyboard">
      <ProofKeyboard :visible="keyboardOpen" :disabled="busy" @insert="activeEditor?.insertPayload($event)" @action="onKeyboardAction" />
    </view>
  </PgSheet>
</template>

<!-- 面板本身由 PgSheet 渲染，class 落在它上面，所以这段不能 scoped。 -->
<style>
.pg-composer.pg-overlay__panel { overflow: hidden; }
.pg-composer--keyboard.pg-overlay__panel { height: 92vh; height: 92dvh; max-height: 92dvh; padding-bottom: 0; }
.pg-composer__head { flex: none; display: flex; align-items: center; gap: var(--sp-2); }
.pg-composer__close.pg-button { margin-left: calc(-1 * var(--sp-2)); color: var(--ink-2); }
.pg-composer__title { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-composer__submit.pg-button { flex: none; }
.pg-composer__body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-3); overflow-y: auto; }
.pg-composer__stage { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
.pg-composer__canvas { height: 280px; min-height: 240px; border: var(--bw) solid var(--rule); border-radius: var(--radius-16); overflow: hidden; }
.pg-composer__working,
.pg-composer__failure { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); padding: var(--sp-4) var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); background: var(--paper-2); text-align: center; }
.pg-composer__workingtext,
.pg-composer__failuretitle { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-composer__note { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); line-height: 1.5; }
.pg-composer__failureactions { align-self: stretch; }
.pg-composer__failureactions .pg-button { gap: var(--sp-1); }
.pg-composer__photoidle { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3); border: var(--bw) dashed var(--rule-2); border-radius: var(--radius-16); }
.pg-composer__photoidle .pg-button { gap: var(--sp-1); }
.pg-composer__filled { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); background: var(--paper-2); color: var(--ink); }
.pg-composer__filledlabel { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-composer__inkfail { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--sea-soft); color: var(--ink); }
.pg-composer__inkfailtext { flex: 1; min-width: 0; font-size: var(--fs-13); font-weight: var(--fw-bold); line-height: 1.5; }
.pg-composer__candidates { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-top: var(--sp-1); }
.pg-composer__candidate { min-height: 36px; display: inline-flex; align-items: center; padding: 0 var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-pill); background: var(--paper); color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); cursor: pointer; }
/* 键盘开着时输入框矮一点：预览、这一行、依据都要露在键盘上方。 */
.pg-composer--keyboard .ui-mte__input { height: 52px !important; min-height: 52px !important; }
.pg-composer--keyboard .pg-field { gap: 2px; }
.pg-composer--keyboard .pg-composer__body { gap: var(--sp-2); }
.pg-composer__kbtoggle.pg-button { align-self: flex-start; margin-left: calc(-1 * var(--sp-2)); gap: var(--sp-1); color: var(--ink-2); }
/* 键盘贴在面板底部，铺满面板宽度。 */
.pg-composer__keyboard { flex: none; margin: 0 calc(-1 * var(--sp-4)); }
@media (min-width: 768px) {
  .pg-composer__keyboard { margin: 0 calc(-1 * var(--sp-6)) calc(-1 * var(--sp-6)); }
  .pg-composer--keyboard.pg-overlay__panel { height: auto; max-height: 92vh; padding-bottom: var(--sp-6); }
}
</style>
