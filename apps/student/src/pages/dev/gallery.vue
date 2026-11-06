<script setup lang="ts">
/**
 * 组件陈列（只在开发和演示构建里可见，生产构建直接跳回首页）。
 * 用来肉眼检查设计系统：tests/screenshots.mjs 也会截这一页。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgCelebration from '@/components/ui/PgCelebration.vue'
import PgCoachmark from '@/components/ui/PgCoachmark.vue'
import PgDialog from '@/components/ui/PgDialog.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgFeedbackPanel from '@/components/ui/PgFeedbackPanel.vue'
import PgField from '@/components/ui/PgField.vue'
import PgFold from '@/components/ui/PgFold.vue'
import PgListRow from '@/components/ui/PgListRow.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import PgStatChip from '@/components/ui/PgStatChip.vue'
import PgSwitch from '@/components/ui/PgSwitch.vue'
import { MASCOT_EXPRESSIONS } from '@/components/ui/icons'
import { useToast } from '@/components/ui/useToast'
import type { ButtonVariant, MascotMotion, SegmentState } from '@/components/ui/uiLogic'
import { useTheme } from '@/composables/useTheme'

const { theme, setTheme } = useTheme()
const toast = useToast()
const allowed = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK === '1'

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'hint', 'sea']
const MOTIONS: MascotMotion[] = ['breathe', 'blink', 'hop', 'cheer', 'think-tilt', 'droop']
const SEGMENTS: SegmentState[] = ['done', 'done', 'active', 'todo', 'off', 'skipped']

const sw = ref(true)
const seg = ref<'a' | 'b' | 'c'>('a')
const progress = ref(0.3)
const steps = computed<SegmentState[]>(() => SEGMENTS)
const sheetOpen = ref(false)
const dialogOpen = ref(false)
const celebrating = ref(false)
const feedback = ref<'ok' | 'sea' | 'bee' | null>(null)
const coachOpen = ref(false)
const coachIndex = ref(0)
const boom = ref(false)
const coachSteps = [
  { target: '[data-testid="gallery-buttons"]', title: '这里是按钮', body: '按下去有回弹，禁用时是平的。' },
  { target: '[data-testid="gallery-progress"]', title: '这里是进度条', body: '往前走的时候闪一下光。' },
]

onLoad(() => {
  if (!allowed) uni.reLaunch({ url: '/pages/home/index' })
})

function crash(): never {
  throw new Error('gallery render crash')
}
</script>

<template>
  <view v-if="allowed" class="pg-page pg-gallery" data-testid="gallery-page">
    <PgSegmented
      :model-value="theme"
      :options="[
        { value: 'system', label: '跟随系统' },
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' },
      ]"
      @update:model-value="setTheme"
    />

    <text class="pg-gallery__h">按钮</text>
    <view class="pg-gallery__row" data-testid="gallery-buttons">
      <PgButton v-for="v in VARIANTS" :key="v" :variant="v">{{ v }}</PgButton>
      <PgButton size="sm">小按钮</PgButton>
      <PgButton size="lg">大按钮</PgButton>
      <PgButton loading>提交中</PgButton>
      <PgButton disabled>写完了</PgButton>
      <PgButton variant="secondary" disabled>不可用</PgButton>
    </view>
    <PgButton block>整行按钮</PgButton>

    <text class="pg-gallery__h">小方</text>
    <view class="pg-gallery__row">
      <view v-for="e in MASCOT_EXPRESSIONS" :key="e" class="pg-gallery__cell">
        <PgMascot :expr="e" :size="88" />
        <text class="pg-gallery__cap">{{ e }}</text>
      </view>
    </view>
    <view class="pg-gallery__row">
      <view v-for="m in MOTIONS" :key="m" class="pg-gallery__cell">
        <PgMascot expr="idle" :motion="m" :size="72" />
        <text class="pg-gallery__cap">{{ m }}</text>
      </view>
    </view>

    <text class="pg-gallery__h">卡片</text>
    <view class="pg-gallery__stack">
      <PgCard>普通卡片</PgCard>
      <PgCard lip>带唇的卡片</PgCard>
      <PgCard tone="sea">助教在问：<MathText text="这个 $N$ 依赖 $\varepsilon$ 吗？" /></PgCard>
      <PgCard tone="bee">提示</PgCard>
      <PgCard tone="ok">完成</PgCard>
      <PgCard tone="fox">注意</PgCard>
    </view>

    <text class="pg-gallery__h">公式</text>
    <PgCard class="pg-gallery__stack">
      <MathText text="行内 $a_n=\frac{1}{n}$，块级 $$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$" block />
      <MathText text="裸命令：\varepsilon > 0，\frac{1}{n}，卡在 |a_n-3|" block />
      <MathText text="$\sum_{k=1}^{n}\frac{1}{k^2+k}=\sum_{k=1}^{n}\left(\frac{1}{k}-\frac{1}{k+1}\right)=1-\frac{1}{n+1}\quad\text{而且}\quad\lim_{n\to\infty}\left(1-\frac{1}{n+1}\right)=1\quad\text{这是一条很长的公式}$" block />
      <MathText text="坏公式 $\frac{1}{$ 不应该变红" block />
    </PgCard>

    <text class="pg-gallery__h">表单</text>
    <view class="pg-gallery__stack">
      <PgField label="邀请码" hint="找老师要">
        <textarea class="pg-input-area pg-input-area--xs" placeholder="六位字母数字" />
      </PgField>
      <PgField label="学号" error="这个学号好像没有登记">
        <textarea class="pg-input-area pg-input-area--xs" />
      </PgField>
      <PgSwitch v-model="sw" label="开关" />
      <PgSegmented
        v-model="seg"
        :options="[
          { value: 'a', label: '手写' },
          { value: 'b', label: '键盘' },
          { value: 'c', label: '拍照', disabled: true },
        ]"
      />
    </view>

    <text class="pg-gallery__h">进度</text>
    <view class="pg-gallery__stack" data-testid="gallery-progress">
      <PgProgress :segments="steps" />
      <PgProgress :value="progress" />
      <PgButton size="sm" variant="secondary" @tap="progress = Math.min(1, progress + 0.15)">前进</PgButton>
    </view>

    <text class="pg-gallery__h">数字和列表</text>
    <view class="pg-gallery__row">
      <PgStatChip icon="qed" value="12" label="题" tone="bee" />
      <PgStatChip icon="flame" value="3" label="连续" tone="fox" />
      <PgStatChip icon="star" value="240" tone="accent" />
    </view>
    <PgCard flush>
      <PgListRow title="音效" sub="答对和提示时的短音" icon="sound"><template #right><PgSwitch v-model="sw" /></template></PgListRow>
      <PgListRow title="可点的行" sub="带箭头" icon="book" clickable />
    </PgCard>
    <PgFold title="延伸"><text>折叠内容</text></PgFold>

    <text class="pg-gallery__h">加载和空态</text>
    <PgSkeleton :count="3" />
    <PgSkeleton variant="block" />
    <PgEmpty title="这里还没有内容" body="写完第一道证明，这里就亮起来了。" action="去做一题" />

    <text class="pg-gallery__h">浮层</text>
    <view class="pg-gallery__row">
      <PgButton variant="secondary" data-testid="gallery-open-sheet" @tap="sheetOpen = true">弹层</PgButton>
      <PgButton variant="secondary" @tap="dialogOpen = true">对话框</PgButton>
      <PgButton variant="secondary" @tap="toast.show('已保存')">轻提示</PgButton>
      <PgButton variant="secondary" data-testid="gallery-celebrate" @tap="celebrating = true">庆祝</PgButton>
      <PgButton variant="secondary" @tap="feedback = 'ok'">反馈 ok</PgButton>
      <PgButton variant="secondary" @tap="feedback = 'sea'">反馈 sea</PgButton>
      <PgButton variant="secondary" @tap="feedback = 'bee'">反馈 bee</PgButton>
      <PgButton variant="secondary" data-testid="gallery-coach" @tap="coachOpen = true; coachIndex = 0">引导</PgButton>
      <PgButton variant="danger" data-testid="gallery-crash" @tap="boom = true">渲染崩溃</PgButton>
    </view>

    <view v-if="boom">{{ crash() }}</view>

    <PgSheet v-model:open="sheetOpen" aria-label="示例弹层">
      <text class="pg-gallery__h">弹层</text>
      <text>手机从底部滑上来，宽屏居中。</text>
      <PgButton block @tap="sheetOpen = false">好</PgButton>
    </PgSheet>
    <PgDialog v-model:open="dialogOpen" title="退出登录？" body="写到一半的内容已经保存。" confirm-text="退出" danger @confirm="dialogOpen = false" />
    <PgCelebration :open="celebrating" title="写完了！">
      <text>4 步里 3 步靠自己</text>
      <template #actions><PgButton block size="lg" @tap="celebrating = false">继续</PgButton></template>
    </PgCelebration>
    <PgFeedbackPanel :open="feedback !== null" :tone="feedback ?? 'ok'" title="答对了" action-text="继续" @action="feedback = null">
      <text>说得很清楚。</text>
    </PgFeedbackPanel>
    <PgCoachmark v-model:index="coachIndex" :open="coachOpen" :steps="coachSteps" @skip="coachOpen = false" @done="coachOpen = false" />
  </view>
</template>

<style scoped>
.pg-gallery { display: flex; flex-direction: column; gap: var(--sp-3); max-width: 720px; padding-bottom: 160px; }
.pg-gallery__h { margin-top: var(--sp-4); color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-gallery__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
.pg-gallery__stack { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-gallery__cell { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); }
.pg-gallery__cap { color: var(--ink-2); font-size: var(--fs-12); }
</style>
