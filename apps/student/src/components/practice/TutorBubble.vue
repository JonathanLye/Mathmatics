<script setup lang="ts">
/**
 * 助教的回答：气泡 + 打字效果。AI 生成的回答带标识和「有用 / 没用」。
 * 只负责显示；关闭动效时直接显示全文。读屏读完整内容。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import AiGeneratedTag from '@/components/AiGeneratedTag.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { noteWhoLabel } from '@/copy'
import { feedbackAllowed } from '@/motion/useFeedbackPrefs'
import type { Note } from '@/types/attempt'
import { TYPING_STEP_MS, typingCuts, typingStride } from './tutorTyping'

const props = defineProps<{ note: Note }>()
const emit = defineEmits<{ (e: 'feedback', useful: boolean): void }>()

const shownLength = ref(0)
const voted = ref<boolean | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}

watch(
  () => props.note.noteId,
  () => {
    stop()
    voted.value = null
    const text = props.note.text
    if (!feedbackAllowed('motion')) {
      shownLength.value = text.length
      return
    }
    const cuts = typingCuts(text)
    const stride = typingStride(cuts.length)
    let index = 0
    shownLength.value = 0
    timer = setInterval(() => {
      index += stride
      shownLength.value = cuts[Math.min(index, cuts.length) - 1] ?? text.length
      if (index >= cuts.length) stop()
    }, TYPING_STEP_MS)
  },
  { immediate: true },
)
onBeforeUnmount(stop)

const typing = computed(() => shownLength.value < props.note.text.length)
const shownText = computed(() => props.note.text.slice(0, shownLength.value))

function vote(useful: boolean): void {
  if (voted.value !== null) return
  voted.value = useful
  emit('feedback', useful)
}
</script>

<template>
  <view
    class="pg-help__note"
    :class="'pg-help__note--' + note.kind"
    role="status"
    :aria-label="noteWhoLabel(note.who) + '：' + note.text"
    :data-typing="typing ? 'typing' : 'done'"
    data-testid="tutor-bubble"
  >
    <PgMascot class="pg-help__notemascot" expr="happy" :motion="null" :size="40" />
    <view class="pg-help__notebody">
      <text class="pg-help__notewho">{{ noteWhoLabel(note.who) }}</text>
      <MathText :text="shownText" block />
      <template v-if="note.aiGenerated && !typing">
        <AiGeneratedTag />
        <view v-if="voted === null" class="pg-help__thumbs">
          <PgButton variant="ghost" size="sm" data-testid="note-useful" @tap="vote(true)">有用</PgButton>
          <PgButton variant="ghost" size="sm" data-testid="note-not-useful" @tap="vote(false)">没用</PgButton>
        </view>
        <text v-else class="pg-help__thanks" data-testid="note-voted">收到，谢谢。</text>
      </template>
    </view>
  </view>
</template>

<style scoped>
.pg-help__note { display: flex; align-items: flex-start; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--radius-16) var(--radius-16) var(--radius-16) 4px; background: var(--paper-2); color: var(--ink); line-height: 1.6; animation: pg-item-in var(--dur-base) var(--ease-out) both; }
.pg-help__note--concept,
.pg-help__note--student { background: var(--accent-soft); }
.pg-help__note--annotation,
.pg-help__note--refusal { background: var(--sea-soft); }
.pg-help__note--hint { background: var(--bee-soft); }
.pg-help__notemascot { flex: none; }
.pg-help__notebody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.pg-help__notewho { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-help__thumbs { display: flex; gap: var(--sp-1); margin-left: calc(-1 * var(--sp-2)); }
.pg-help__thanks { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); }
</style>
