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

const props = withDefaults(defineProps<{ open?: boolean; lesson?: LessonView | null; busy?: boolean }>(), {
  open: false,
  lesson: null,
  busy: false,
})

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
}
watch(() => props.open, (open) => { if (open) reset() })
watch(() => props.lesson, () => reset())

function choose(index: number) {
  const s = step.value
  if (!s?.check || status.value === 'right') return
  choices.value = { ...choices.value, [s.id]: index }
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
        <text class="pg-micro__stepno pg-mono" data-testid="micro-stepno">第 {{ stepIndex + 1 }} / {{ total }} 步</text>
        <text class="pg-micro__title">{{ props.lesson.title }}</text>
        <button class="pg-micro__close pg-small" role="button" data-testid="micro-close" @tap="close">关闭</button>
      </view>

      <view class="pg-micro__dots" aria-hidden="true">
        <view
          v-for="(s, i) in steps"
          :key="s.id"
          class="pg-micro__dot"
          :class="{
            'pg-micro__dot--done': i < stepIndex,
            'pg-micro__dot--current': i === stepIndex,
          }"
        />
      </view>

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
            <MathText :text="step.check.wrong" block />
          </view>
          <view v-if="status === 'right'" class="pg-micro__feedback pg-micro__feedback--right" data-testid="micro-feedback-right">
            <MathText :text="'对。' + step.check.right" block />
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
.pg-micro {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--paper);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.pg-micro__shell {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 100%;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: calc(var(--safe-top) + var(--sp-3)) max(var(--sp-4), var(--safe-left)) calc(var(--sp-4) + var(--safe-bottom))
    max(var(--sp-4), var(--safe-right));
}
.pg-micro__head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.pg-micro__stepno { color: var(--ink-2); flex: 0 0 auto; }
.pg-micro__title { flex: 1; min-width: 0; font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--ink); }
.pg-micro__close {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
}
.pg-micro__dots { display: flex; gap: 6px; }
.pg-micro__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--rule); }
.pg-micro__dot--done { background: var(--ok); }
.pg-micro__dot--current { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
/* AI 生成补充讲解：与系统消息同底色（accent-soft），标识在正文下方（12 §7）。 */
.pg-micro__generated {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  background: var(--accent-soft);
}
.pg-micro__generatedtitle { color: var(--ink-2); }
.pg-micro__card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  min-width: 0;
}
.pg-micro__kind { color: var(--ink-2); }
.pg-micro__text { font-family: var(--font-serif); font-size: 16px; line-height: 1.65; color: var(--ink); }
.pg-micro__visual { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-micro__visualunknown { color: var(--ink-2); }
.pg-micro__check { display: flex; flex-direction: column; gap: var(--sp-2); padding-top: var(--sp-2); border-top: 1px dashed var(--rule); }
.pg-micro__options { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-micro__option {
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
  text-align: left;
  line-height: 1.5;
  display: flex;
  align-items: center;
}
.pg-micro__option--picked { border-color: var(--accent); }
.pg-micro__option--right { border-color: var(--ok); background: var(--accent-soft); }
.pg-micro__option--wrong { border-color: var(--margin); background: var(--margin-soft); }
.pg-micro__feedback {
  display: block;
  padding: var(--sp-2);
  border-left: 3px solid var(--rule);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  font-size: 14px;
  line-height: 1.55;
}
.pg-micro__feedback--wrong { border-left-color: var(--margin); background: var(--margin-soft); color: var(--ink); }
.pg-micro__feedback--right { border-left-color: var(--ok); background: var(--accent-soft); color: var(--ink); }
.pg-micro__foot {
  display: flex;
  gap: var(--sp-2);
  margin-top: auto;
  padding: var(--sp-2) 0 calc(var(--sp-2) + var(--safe-bottom));
  position: sticky;
  bottom: 0;
  background: var(--paper);
}
.pg-micro__btn {
  flex: 1;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.2;
}
.pg-micro__btn--primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.pg-micro__btn[disabled] { opacity: 0.45; }
</style>
