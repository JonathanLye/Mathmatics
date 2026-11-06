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
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
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
  <view class="pg-page pg-form-page pg-age" data-testid="age-page">
    <view class="pg-form-column pg-age__column pg-enter">
      <view class="pg-age__hero">
        <PgMascot expr="idle" :motion="['breathe', 'blink']" :size="88" />
        <text class="pg-age__title">先确认你的年龄段</text>
        <text class="pg-age__sub">未满 14 岁暂不开通；14–17 岁可用；18 岁及以上按成年人规则。年龄只会记录一次。</text>
      </view>

      <PgCard v-if="initializing" data-testid="age-loading">
        <PgSkeleton :count="2" />
        <text class="pg-age__hint pg-age__loading">正在读取你的分档…</text>
      </PgCard>

      <!-- 已记录 lt14：暂不开通，不提供继续入口 -->
      <PgCard v-else-if="blocked" tone="bee" class="pg-age__card" data-testid="age-blocked">
        <text class="pg-age__cardtitle">暂不开通</text>
        <text class="pg-age__risktext" data-testid="age-risk-note">{{ AGE_BAND_LT14_RISK }}</text>
        <text class="pg-age__hint">训练数据不采集；如果分档填写有误，请联系老师修改。</text>
      </PgCard>

      <!-- 已记录并允许使用：显示记录结果 + 继续原目标 -->
      <PgCard v-else-if="recordedNotice" class="pg-age__card" data-testid="age-recorded">
        <text class="pg-age__cardtitle">年龄已记录</text>
        <text class="pg-age__recorded" data-testid="age-recorded-value">当前分档：{{ ageBandLabel(recorded) }}</text>
        <text class="pg-age__hint">年龄只能设置一次，如需修改请联系老师。</text>
        <PgButton block size="lg" data-testid="age-continue" @tap="goNext">继续</PgButton>
      </PgCard>

      <!-- 尚未选择：三档 -->
      <template v-else>
        <view class="pg-age__options" role="radiogroup" aria-label="年龄段">
          <PgButton
            v-for="option in AGE_BAND_OPTIONS"
            :key="option.value"
            class="pg-age__option"
            :class="{ 'pg-age__option--selected': selected === option.value }"
            variant="secondary"
            block
            :data-testid="'age-option-' + option.value"
            :aria-pressed="selected === option.value"
            :disabled="!canChoose"
            @tap="choose(option.value)"
          >
            <text class="pg-age__optionlabel">{{ option.label }}</text>
            <text class="pg-age__optionhint">{{ option.hint }}</text>
          </PgButton>
        </view>
        <text class="pg-age__risk pg-age__risktext" data-testid="age-risk-note">{{ AGE_BAND_LT14_RISK }}</text>
        <text v-if="errorText" class="pg-age__error" data-testid="age-error" role="alert">{{ errorText }}</text>
        <PgButton block size="lg" data-testid="age-submit" :loading="loading" :disabled="submitDisabled" @tap="submit">
          {{ loading ? '提交中…' : '确认分档' }}
        </PgButton>
        <text class="pg-age__hint">年龄分档只用于未成年人规则，不影响你的成绩。</text>
      </template>

      <text v-if="errorText && (blocked || recordedNotice)" class="pg-age__error" data-testid="age-error" role="alert">{{ errorText }}</text>
    </view>
  </view>
</template>

<style scoped>
.pg-age__column { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-age__hero { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); text-align: center; }
.pg-age__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-age__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-age__card { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-age__cardtitle { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-age__recorded { color: var(--accent-text); font-size: var(--fs-13); }
.pg-age__loading { display: block; margin-top: var(--sp-3); }
.pg-age__options { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-age__option.pg-button {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 64px;
  padding: var(--sp-2) var(--sp-4);
  text-align: left;
}
.pg-age__option--selected.pg-button {
  --_lip: var(--accent-lip);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.pg-age__optionlabel { font-size: var(--fs-15); font-weight: var(--fw-black); }
.pg-age__optionhint { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-age__risk {
  padding: var(--sp-3);
  border: var(--bw) solid var(--bee);
  border-radius: var(--radius-12);
  background: var(--bee-soft);
}
.pg-age__risktext { color: var(--bee-text); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-age__error { color: var(--fox-text); font-size: var(--fs-13); }
.pg-age__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
</style>
