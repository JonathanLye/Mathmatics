<script setup lang="ts">
/**
 * 第 1 层微课（02 §4.9）：一步一屏（手机）/ 一卡（平板、电脑），顶部步骤点，底部上一步/下一步。
 *
 * - 内容由服务端下发（LessonView，已过闸门）；本组件只负责分步展示与「答对才能下一步」的交互。
 * - 小核验答错：卡片下方给一句引导（红笔样式），可重选；答对：绿色「对」+ 解释，下一步可点。
 * - 最后一步是「回到定义」，点了就关掉微课回到第 1 层表单。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import AiGeneratedTag from '@/components/AiGeneratedTag.vue'
import { generatedTextOf } from '@/components/aigc'
// #98 已提供统一的图解组件（N(ε) 只由 diagrams/seqBand.ts 计算）；#26 微课 + #47 图解接线共用。
import SeqBandDiagram from '@/components/diagrams/SeqBandDiagram.vue'
import AbsTriangleDiagram from '@/components/diagrams/AbsTriangleDiagram.vue'
// #47 剩余图解模板（03 §7）：partial-sums / func-band / monotone-steps；表达式由受限解析器求值。
import PartialSumsDiagram from '@/components/diagrams/PartialSumsDiagram.vue'
import FuncBandDiagram from '@/components/diagrams/FuncBandDiagram.vue'
import MonotoneStepsDiagram from '@/components/diagrams/MonotoneStepsDiagram.vue'
import type { LessonStep, LessonView } from '@/types/attempt'

type CheckVerdict = { correct: boolean; feedback: string } | null
const props = withDefaults(
  defineProps<{
    open?: boolean
    lesson?: LessonView | null
    busy?: boolean
    /** 服务端判定小核验（真实接口不下发答案）；缺省或返回 null 时用题目自带的 answer/right/wrong 本地判定（mock）。 */
    check?: (stepId: string, choice: number) => Promise<CheckVerdict>
  }>(),
  { open: false, lesson: null, busy: false, check: undefined },
)

const emit = defineEmits<{ (e: 'close'): void }>()

const KIND_LABEL: Record<LessonStep['kind'], string> = {
  intuition: '直观',
  map: '对应',
  distortion: '失真说明',
  boundary: '边界例子',
  build: '骨架',
  return: '回到定义',
}

const stepIndex = ref(0)
const choices = ref<Record<string, number>>({})
const checkStatus = ref<Record<string, 'idle' | 'wrong' | 'right'>>({})
/** 服务端给的反馈文案（真实接口）；没有时回退到题目自带的 right/wrong。 */
const feedbackText = ref<Record<string, string>>({})

const steps = computed(() => props.lesson?.steps ?? [])
/**
 * AI 生成补充讲解（LessonView.generated，已过闸门与异厂商复核；01 §3.1：放在微课第一步上方）。
 * 默认为空（P0 不启用生成）；非空时显示正文 + AIGC 显式标识，具体内容不加工、不伪造。
 */
const generatedText = computed(() => generatedTextOf(props.lesson?.generated))
const total = computed(() => steps.value.length)
const step = computed<LessonStep | null>(() => steps.value[stepIndex.value] ?? null)
const isLast = computed(() => total.value > 0 && stepIndex.value >= total.value - 1)
const currentChoice = computed(() => (step.value ? (choices.value[step.value.id] ?? -1) : -1))
const status = computed<'idle' | 'wrong' | 'right'>(() => (step.value ? (checkStatus.value[step.value.id] ?? 'idle') : 'idle'))
const canNext = computed(() => !step.value?.check || status.value === 'right')

/**
 * 把微课步骤的 VisualSpec 映射到 #98 的 SeqBandDiagram props（不执行 expr 求值）：
 * A = params.limit，ε = params.epsilon.init ?? 0.3，nMax = params.nMax ?? 20；
 * 序列点来自 mock/服务端预生成的 params.points（缺省时由 #98 组件用 sampleSeqPoints 兜底）。
 * 真实接口 #24 接 VisualSpec 时再由服务端下发渲染参数（B 复核口径）。
 */
const seqBandProps = computed(() => {
  const visual = step.value?.visual
  if (!visual || visual.type !== 'seq-band') return null
  const params = visual.params ?? {}
  const min = Number(params.epsilon?.min)
  const max = Number(params.epsilon?.max)
  const stepValue = Number(params.epsilon?.step)
  return {
    points: params.points ?? [],
    A: Number.isFinite(Number(params.limit)) ? Number(params.limit) : 0,
    epsilon: Number(params.epsilon?.init ?? 0.3),
    nMax: Number(params.nMax ?? 20),
    min: Number.isFinite(min) ? min : 0.1,
    max: Number.isFinite(max) ? max : 2,
    step: Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 0.05,
  }
})

/** #47 图解接线：abs-triangle 步骤（mock 扩展 type）→ AbsTriangleDiagram。 */
const absTriangle = computed(() => {
  const visual = step.value?.visual
  if (!visual || visual.type !== 'abs-triangle') return null
  return { a: Number(visual.params?.a ?? 3), b: Number(visual.params?.b ?? -1) }
})

function reset() {
  stepIndex.value = 0
  choices.value = {}
  checkStatus.value = {}
  feedbackText.value = {}
}
watch(() => props.open, (open) => { if (open) reset() })
watch(() => props.lesson, () => reset())

async function choose(index: number) {
  const s = step.value
  if (!s?.check || status.value === 'right') return
  choices.value = { ...choices.value, [s.id]: index }
  let verdict: CheckVerdict = null
  if (props.check) {
    try {
      verdict = await props.check(s.id, index)
    } catch {
      return // 网络失败：不改判定，学生可以再点一次
    }
  }
  if (verdict) {
    feedbackText.value = { ...feedbackText.value, [s.id]: verdict.feedback }
    checkStatus.value = { ...checkStatus.value, [s.id]: verdict.correct ? 'right' : 'wrong' }
    return
  }
  checkStatus.value = { ...checkStatus.value, [s.id]: index === s.check.answer ? 'right' : 'wrong' }
}

function prev() {
  if (stepIndex.value > 0) stepIndex.value -= 1
}

function next() {
  if (!canNext.value || isLast.value) return
  stepIndex.value += 1
}

function close() {
  emit('close')
}
</script>

<template>
  <view v-if="props.open && props.lesson" class="pg-micro" role="dialog" aria-modal="true" data-testid="micro-course">
    <view class="pg-micro__shell">
      <view class="pg-micro__head">
        <button class="pg-micro__close" role="button" aria-label="关闭" data-testid="micro-close" @tap="close"><PgIcon name="close" :size="28" /></button>
        <view class="pg-micro__dots" aria-hidden="true">
          <view
            v-for="(s, i) in steps"
            :key="s.id"
            class="pg-micro__dot"
            :class="{
              'pg-micro__dot--done': i < stepIndex,
              'pg-micro__dot--current': i === stepIndex,
            }"
          ><view class="pg-micro__dotfill" /></view>
        </view>
        <text class="pg-micro__stepno" data-testid="micro-stepno">第 {{ stepIndex + 1 }} / {{ total }} 步</text>
      </view>
      <text class="pg-micro__title">{{ props.lesson.title }}</text>

      <view
        v-if="generatedText && stepIndex === 0"
        class="pg-micro__generated"
        data-testid="micro-generated"
      >
        <text class="pg-micro__generatedtitle pg-small">补充讲解</text>
        <MathText :text="generatedText" block />
        <AiGeneratedTag />
      </view>

      <view v-if="step" class="pg-micro__card pg-sheet">
        <text class="pg-micro__kind pg-small">{{ KIND_LABEL[step.kind] }}</text>
        <view class="pg-micro__text">
          <MathText :text="step.text" serif block />
        </view>

        <view v-if="step.visual" class="pg-micro__visual" data-testid="micro-visual">
          <MathText v-if="step.visual.params?.exprLatex" :text="step.visual.params.exprLatex" block />
          <SeqBandDiagram
            v-if="step.visual.type === 'seq-band' && seqBandProps"
            :points="seqBandProps.points"
            :A="seqBandProps.A"
            :epsilon="seqBandProps.epsilon"
            :nMax="seqBandProps.nMax"
            :min="seqBandProps.min"
            :max="seqBandProps.max"
            :step="seqBandProps.step"
          />
          <view v-else-if="step.visual.type === 'abs-triangle' && absTriangle" data-testid="abs-triangle">
            <AbsTriangleDiagram :a="absTriangle.a" :b="absTriangle.b" />
          </view>
          <PartialSumsDiagram v-else-if="step.visual.type === 'partial-sums'" :spec="step.visual" />
          <FuncBandDiagram v-else-if="step.visual.type === 'func-band'" :spec="step.visual" />
          <MonotoneStepsDiagram v-else-if="step.visual.type === 'monotone-steps'" :spec="step.visual" />
          <text v-else class="pg-micro__visualunknown pg-small" data-testid="micro-visual-unknown">
            图解类型「{{ step.visual.type }}」暂不支持展示，先看上面的文字说明。
          </text>
        </view>

        <view v-if="step.check" class="pg-micro__check" data-testid="micro-check">
          <MathText :text="step.check.q" block />
          <view class="pg-micro__options">
            <button
              v-for="(option, i) in step.check.options"
              :key="i"
              class="pg-micro__option"
              :class="{
                'pg-micro__option--picked': currentChoice === i,
                'pg-micro__option--right': currentChoice === i && status === 'right',
                'pg-micro__option--wrong': currentChoice === i && status === 'wrong',
              }"
              role="button"
              :data-testid="'micro-option-' + i"
              @tap="choose(i)"
            >
              <MathText :text="option" />
            </button>
          </view>
          <view v-if="status === 'wrong'" class="pg-micro__feedback pg-micro__feedback--wrong" data-testid="micro-feedback-wrong">
            <PgMascot expr="oops" :size="56" />
            <view class="pg-micro__fbtext"><text class="pg-micro__fbtitle">差一点</text><MathText :text="feedbackText[step.id] ?? step.check.wrong ?? ''" block /></view>
          </view>
          <view v-if="status === 'right'" class="pg-micro__feedback pg-micro__feedback--right" data-testid="micro-feedback-right">
            <PgMascot expr="happy" :size="56" />
            <view class="pg-micro__fbtext"><text class="pg-micro__fbtitle">答对了</text><MathText :text="feedbackText[step.id] ?? '对。' + (step.check.right ?? '')" block /></view>
          </view>
        </view>
      </view>

      <view class="pg-micro__foot">
        <button class="pg-micro__btn" role="button" data-testid="micro-prev" :disabled="stepIndex === 0 || props.busy" @tap="prev">
          上一步
        </button>
        <button
          v-if="!isLast"
          class="pg-micro__btn pg-micro__btn--primary"
          role="button"
          data-testid="micro-next"
          :disabled="!canNext || props.busy"
          @tap="next"
        >
          下一步
        </button>
        <button
          v-else
          class="pg-micro__btn pg-micro__btn--primary"
          role="button"
          data-testid="micro-return"
          @tap="close"
        >
          回到定义
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-micro { position: fixed; inset: 0; z-index: 90; background: var(--paper); overflow-y: auto; -webkit-overflow-scrolling: touch; }
.pg-micro__shell { display: flex; flex-direction: column; gap: var(--sp-3); min-height: 100%; width: 100%; max-width: 720px; margin: 0 auto; padding: calc(var(--safe-top) + var(--sp-3)) max(var(--sp-4), var(--safe-left)) calc(var(--sp-4) + var(--safe-bottom)) max(var(--sp-4), var(--safe-right)); }
.pg-micro__head { display: flex; align-items: center; gap: var(--sp-3); }
.pg-micro__close { flex: 0 0 auto; width: 44px; min-height: 44px; margin: 0 0 0 -8px; padding: 0; border: 0; background: transparent; color: var(--ink-3); display: inline-flex; align-items: center; justify-content: center; }
.pg-micro__close::after { display: none; }
.pg-micro__dots { flex: 1; min-width: 0; display: flex; gap: 4px; }
/* 进度条：每步一段，16px 高、顶部高光 */
.pg-micro__dot { position: relative; flex: 1; height: 16px; border-radius: 8px; background: var(--rule); overflow: hidden; }
.pg-micro__dotfill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 8px; background: var(--accent); }
.pg-micro__dotfill::after { content: ''; position: absolute; left: 6px; right: 6px; top: 4px; height: 4px; border-radius: 2px; background: #fff; opacity: 0.35; }
.pg-micro__dot--done .pg-micro__dotfill { width: 100%; }
.pg-micro__dot--current .pg-micro__dotfill { width: 45%; }
.pg-micro__stepno { flex: 0 0 auto; color: var(--ink-2); font-size: 13px; font-weight: 900; letter-spacing: 0.4px; }
.pg-micro__title { font-size: 12px; font-weight: 900; letter-spacing: 0.9px; color: var(--margin-text); }
.pg-micro__generated { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); border: 2px solid var(--accent); border-radius: var(--radius-card); background: var(--accent-soft); }
.pg-micro__generatedtitle { color: var(--ink-2); font-weight: 800; }
.pg-micro__card { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4); min-width: 0; }
.pg-micro__kind { color: var(--ink-2); font-weight: 900; letter-spacing: 0.6px; }
.pg-micro__text { font-size: 19px; line-height: 1.55; color: var(--ink); font-weight: 700; }
.pg-micro__visual { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-micro__visualunknown { color: var(--ink-2); }
.pg-micro__check { display: flex; flex-direction: column; gap: var(--sp-3); padding-top: var(--sp-3); border-top: 2px dashed var(--rule); }
.pg-micro__options { display: flex; flex-direction: column; gap: var(--sp-3); }
/* 选项：厚边行，选中=蓝，答对=绿，答错=红（微课是唯一有对错判决的地方） */
.pg-micro__option { width: 100%; min-height: 54px; margin: 0; padding: var(--sp-2) var(--sp-4); border: 2px solid var(--rule); border-bottom-width: var(--lip); border-radius: var(--radius-card); background: var(--sheet); color: var(--ink); font-size: 16px; font-weight: 800; text-align: left; line-height: 1.5; display: flex; align-items: center; }
.pg-micro__option::after { display: none; }
.pg-micro__option:active { transform: translateY(2px); border-bottom-width: 2px; }
.pg-micro__option--picked { border-color: var(--margin); border-bottom-color: var(--margin-lip); background: var(--margin-soft); color: var(--margin-text); }
.pg-micro__option--right { border-color: var(--accent); border-bottom-color: var(--accent-lip); background: var(--accent-soft); color: var(--ink); }
.pg-micro__option--wrong { border-color: var(--danger); border-bottom-color: var(--danger-face); background: var(--danger-soft); color: var(--danger-text); animation: pg-shake 240ms 1; }
.pg-micro__feedback { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); border-radius: var(--radius-card); font-size: 15px; font-weight: 700; line-height: 1.55; animation: pg-note-pop 260ms var(--ease-pop) both; }
.pg-micro__fbtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-micro__fbtitle { font-size: 18px; font-weight: 900; }
.pg-micro__feedback--wrong { background: var(--danger-soft); color: var(--danger-text); }
.pg-micro__feedback--right { background: var(--accent-soft); color: var(--accent-text); }
@keyframes pg-note-pop { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.pg-micro__foot { display: flex; gap: var(--sp-3); margin-top: auto; padding: var(--sp-3) 0 calc(var(--sp-2) + var(--safe-bottom)); position: sticky; bottom: 0; background: var(--paper); }
.pg-micro__btn { flex: 1; min-height: 52px; margin: 0; padding: 0 var(--sp-3); border: 2px solid var(--rule); border-radius: var(--radius-card); box-shadow: 0 2px 0 var(--rule); background: var(--sheet); color: var(--margin-text); font-size: 16px; font-weight: 900; line-height: 1.2; }
.pg-micro__btn::after { display: none; }
.pg-micro__btn--primary { border: 0; background: var(--accent); box-shadow: 0 var(--lip) 0 var(--accent-lip); color: var(--on-accent); }
.pg-micro__btn:active { transform: translateY(2px); }
.pg-micro__btn[disabled] { background: var(--rule); box-shadow: none; color: var(--ink-3); }
</style>
