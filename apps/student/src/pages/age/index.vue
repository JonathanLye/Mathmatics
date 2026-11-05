<script setup lang="ts">
/**
 * 年龄选择页（issue #145 / 13 §4；契约 #131 POST /auth/student/age-band）。
 *
 * - 登录后、同意/练习前，Me.ageBand 为 null 时由路由守卫送到这里；
 * - 三档 + 「< 14 暂不开通」风险说明；提交 loading/错误处理；
 * - 成功后（以服务端返回的 Me 为准，再刷新一次 /me）继续原目标（?next= / store 里记录的原路由）；
 * - 409 AGE_BAND_LOCKED：展示「已记录，如需修改请联系老师」，按刷新后的真实分档继续或停在暂不开通；
 * - lt14：记录后展示「暂不开通」，不继续（合规判定以服务端为准，写接口仍会 403 AGE_RESTRICTED）。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { errorMessage, isApiError } from '@/api/client'
import { useSession } from '@/stores/session'
import {
  AGE_BAND_LT14_RISK,
  AGE_BAND_OPTIONS,
  ageBandErrorMessage,
  ageBandLabel,
  safeNextRoute,
} from '@/auth/ageBand'
import type { AgeBand } from '@/types/attempt'

const session = useSession()
const loading = session.loading
const selected = ref<AgeBand | null>(null)
/** 服务端已记录的年龄分档（null=未选择）；用于「已记录」「暂不开通」两种状态。 */
const recorded = ref<AgeBand | null>(null)
const initializing = ref(true)
const errorText = ref('')
const nextRoute = ref('')

const blocked = computed(() => !initializing.value && recorded.value === 'lt14')
const recordedNotice = computed(() => !initializing.value && recorded.value !== null && recorded.value !== 'lt14')
const canChoose = computed(() => !initializing.value && recorded.value === null && !loading.value)
const submitDisabled = computed(() => !canChoose.value || selected.value === null)

function resolveTarget(query: Record<string, unknown> | undefined): string {
  const fromQuery = safeNextRoute(query?.next)
  if (fromQuery) return fromQuery
  const fromStore = safeNextRoute(session.takePendingRoute())
  if (fromStore) return fromStore
  return session.consented.value ? '/pages/home/index' : '/pages/consent/index'
}

onLoad(async (query) => {
  nextRoute.value = resolveTarget(query as Record<string, unknown> | undefined)
  await session.refreshMe()
  recorded.value = session.ageBand.value
  if (recorded.value) selected.value = recorded.value
  initializing.value = false
})

function choose(band: AgeBand): void {
  if (!canChoose.value) return
  selected.value = band
  errorText.value = ''
}

function goNext(): void {
  uni.redirectTo({ url: nextRoute.value || '/pages/home/index' })
}

async function submit(): Promise<void> {
  const band = selected.value
  if (!band || loading.value) return
  errorText.value = ''
  try {
    const me = await session.submitAgeBand(band)
    recorded.value = me.ageBand
    if (me.ageBand === 'lt14') return // blocked 视图，不继续
    goNext()
  } catch (e) {
    const code = isApiError(e) ? e.code : ''
    if (code === 'AGE_BAND_LOCKED') {
      // 已记录：刷新 Me 后按真实分档处理（不伪造「设置成功」）
      errorText.value = ageBandErrorMessage(code) ?? '年龄已记录'
      const me = await session.refreshMe()
      recorded.value = me?.ageBand ?? null
      if (recorded.value && recorded.value !== 'lt14') return // 展示「已记录」+ 继续
      return
    }
    errorText.value = ageBandErrorMessage(code) || errorMessage(e)
  }
}
</script>

<template>
  <view class="pg-page pg-age" data-testid="age-page">
    <text class="pg-age__title">先确认你的年龄段</text>
    <text class="pg-age__sub pg-small">
      按 13 §4：未满 14 岁暂不开通；14–17 岁可用；18 岁及以上按成年人规则。年龄只会记录一次。
    </text>

    <view v-if="initializing" class="pg-age__card pg-sheet" data-testid="age-loading">
      <text class="pg-age__hint pg-small">正在读取你的分档…</text>
    </view>

    <!-- 已记录 lt14：暂不开通，不提供继续入口 -->
    <view v-else-if="blocked" class="pg-age__card pg-sheet pg-age__card--blocked" data-testid="age-blocked">
      <text class="pg-age__cardtitle">暂不开通</text>
      <text class="pg-age__risk" data-testid="age-risk-note">{{ AGE_BAND_LT14_RISK }}</text>
      <text class="pg-age__hint pg-small">训练数据不采集；如果分档填写有误，请联系老师修改。</text>
    </view>

    <!-- 已记录并允许使用：显示记录结果 + 继续原目标 -->
    <view v-else-if="recordedNotice" class="pg-age__card pg-sheet" data-testid="age-recorded">
      <text class="pg-age__cardtitle">年龄已记录</text>
      <text class="pg-age__recorded pg-small" data-testid="age-recorded-value">当前分档：{{ ageBandLabel(recorded) }}</text>
      <text class="pg-age__hint pg-small">年龄只能设置一次，如需修改请联系老师。</text>
      <button class="pg-age__submit" data-testid="age-continue" @tap="goNext">继续</button>
    </view>

    <!-- 尚未选择：三档 -->
    <template v-else>
      <view class="pg-age__options">
        <button
          v-for="option in AGE_BAND_OPTIONS"
          :key="option.value"
          class="pg-age__option"
          :class="{ 'pg-age__option--selected': selected === option.value }"
          :data-testid="'age-option-' + option.value"
          :aria-pressed="selected === option.value"
          :disabled="!canChoose"
          @tap="choose(option.value)"
        >
          <text class="pg-age__optionlabel">{{ option.label }}</text>
          <text class="pg-age__optionhint pg-small">{{ option.hint }}</text>
        </button>
      </view>
      <text class="pg-age__risk" data-testid="age-risk-note">{{ AGE_BAND_LT14_RISK }}</text>
      <text v-if="errorText" class="pg-age__error pg-small" data-testid="age-error" role="alert">{{ errorText }}</text>
      <button class="pg-age__submit" data-testid="age-submit" :disabled="submitDisabled" @tap="submit">
        {{ loading ? '提交中…' : '确认分档' }}
      </button>
      <text class="pg-age__hint pg-small">提交后由服务端记录；年龄分档只用于未成年人规则，不影响你的成绩。</text>
    </template>

    <text v-if="errorText && (blocked || recordedNotice)" class="pg-age__error pg-small" data-testid="age-error" role="alert">
      {{ errorText }}
    </text>
  </view>
</template>

<style scoped>
.pg-age {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: calc(var(--safe-top) + var(--sp-6));
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.pg-age__title {
  font-size: 22px;
  font-weight: 900;
  color: var(--ink);
}
.pg-age__sub { color: var(--ink-2); }
.pg-age__card { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-age__card--blocked { border-left: 3px solid var(--margin); }
.pg-age__cardtitle { font-size: 18px; font-weight: 900; color: var(--ink); }
.pg-age__recorded { color: var(--accent-text); }
.pg-age__options { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-age__option {
  /* uni-app H5 的 <button> 默认按内容收缩，这里显式撑满整行 */
  width: 100%;
  box-sizing: border-box;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 56px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--sheet);
  color: var(--ink);
  text-align: left;
}
.pg-age__option--selected { border-color: var(--accent); background: var(--accent-soft); }
.pg-age__optionlabel { font-size: var(--fs-body); }
.pg-age__optionhint { color: var(--ink-2); }
.pg-age__risk {
  padding: var(--sp-2) var(--sp-3);
  border-left: 3px solid var(--hint);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  background: var(--hint-soft);
  color: var(--hint);
  font-size: var(--fs-small);
  line-height: 1.6;
}
.pg-age__error { color: var(--margin-text); }
.pg-age__submit {
  width: 100%;
  box-sizing: border-box;
  align-self: stretch;
  min-height: 52px;
  border: 0;
  border-radius: var(--radius-card);
  background: var(--accent);
  box-shadow: 0 var(--lip) 0 var(--accent-lip);
  color: var(--on-accent);
  font-size: var(--fs-body);
  font-weight: 900;
  letter-spacing: 0.5px;
}
/* uni-app H5 的 <uni-button> 不是原生表单控件，:disabled 伪类不生效，用属性选择器统一禁用态 */
.pg-age__option[disabled] { opacity: 0.7; }
.pg-age__submit[disabled] {
  background: var(--rule);
  box-shadow: none;
  color: var(--ink-3);
}
/* 去掉 uni-app H5 <button> 自带的 ::after 边框，避免与外层边框叠成双线 */
.pg-age__option::after,
.pg-age__submit::after {
  border: 0 !important;
}
.pg-age__hint { color: var(--ink-2); }
</style>
