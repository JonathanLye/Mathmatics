<script setup lang="ts">
/**
 * 同意页（02 §4.1 / 13 §2 / #145）：
 * - 文本与签署状态来自 GET /consents；必选三段固定同意，可选两段默认关；
 * - 14–17 岁服务端会多返回一段 guardianNotice（建议告知监护人）：**只读展示，不做开关、不参与签署**
 *   （POST /consents 的 items 只有契约的 5 个可签键；14 岁以下不产生同意书）；
 * - 进入前先过年龄门（Me.ageBand 为 null / lt14 → 年龄选择页）。
 */
import { POLICY_TITLE } from '@/copy/privacy'
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgFold from '@/components/ui/PgFold.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import PgSwitch from '@/components/ui/PgSwitch.vue'
import { shouldGoWelcome } from '@/composables/useOnboarding'
import { consentVersionLabel } from '@/copy'
import { CONSENT_COPY } from '@/copy/onboarding'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'

const session = useSession()
useFeedbackPrefs() // 读出本机的动效开关：登录前的页面也要尊重“关闭动效”
const items = session.items
const version = session.docVersion
const requiredOk = session.requiredOk
const loading = session.loading
const error = ref('')
const errorText = computed(() => error.value || session.error.value || '')

onLoad(async () => {
  // #145：年龄门（登录后、同意前）；被重定向时不继续加载/签署。
  if (!ageGatePassed(await enforceAgeGate())) return
  await session.loadConsentDoc()
  if (session.consented.value) uni.redirectTo({ url: (await shouldGoWelcome()) ? '/pages/welcome/index' : '/pages/home/index' })
})

function toggle(id: string) {
  const item = items.value.find((entry) => entry.id === id)
  if (!item || item.required || item.readOnly) return
  item.value = !item.value
}

async function submit() {
  error.value = ''
  if (!requiredOk.value) { error.value = '必选三项都要同意才能开始练习；有疑问请联系老师。'; return }
  const ok = await session.submitConsent()
  if (!ok) { error.value = session.error.value || '提交失败，请重试'; return }
  // 第一次进来先去欢迎页（昵称、每日目标、默认输入）；读不到设置或已走过就直接首页。
  uni.redirectTo({ url: (await shouldGoWelcome()) ? '/pages/welcome/index' : '/pages/home/index' })
}

function goPolicy(): void {
  uni.navigateTo({ url: '/pages/privacy-policy/index' })
}
</script>

<template>
  <view class="pg-page pg-form-page pg-consent" data-testid="consent-page">
    <view class="pg-form-column pg-consent__column pg-enter">
      <view class="pg-consent__hero">
        <PgMascot expr="idle" :motion="['breathe', 'blink']" :size="96" />
        <text class="pg-consent__title">{{ CONSENT_COPY.title }}</text>
        <text class="pg-consent__sub">{{ CONSENT_COPY.sub }}</text>
        <text class="pg-consent__policy" role="link" tabindex="0" data-testid="consent-policy" @tap="goPolicy">看完整的《{{ POLICY_TITLE }}》</text>
      </view>

      <PgCard v-if="loading && !items.length"><PgSkeleton :count="3" /></PgCard>

      <PgCard v-for="item in items" :key="item.id" class="pg-consent__item pg-consent__enter" :data-testid="'consent-item-' + item.id">
        <view class="pg-consent__head">
          <text class="pg-consent__name">{{ item.title }}</text>
          <!-- guardianNotice（14–17 岁）只读说明：没有开关、不参与签署 -->
          <text v-if="item.readOnly" class="pg-consent__tag" data-testid="consent-readonly-badge">只读说明</text>
          <template v-else>
            <text class="pg-consent__tag" :class="{ 'pg-consent__tag--req': item.required }">{{ item.required ? '必选' : '可选' }}</text>
            <PgSwitch :model-value="item.value" :disabled="item.required" :label="item.title" :data-testid="'consent-switch-' + item.id" @update:model-value="toggle(item.id)" />
          </template>
        </view>
        <text class="pg-consent__summary">{{ item.summary }}</text>
        <PgFold title="全文" class="pg-consent__more"><text class="pg-consent__detail">{{ item.detail }}</text></PgFold>
      </PgCard>

      <text v-if="errorText" class="pg-consent__error" role="alert">{{ errorText }}</text>
      <PgButton block size="lg" data-testid="consent-submit" :loading="loading && items.length > 0" :disabled="loading" @tap="submit">
        {{ loading ? '提交中…' : '同意并开始' }}
      </PgButton>
      <text class="pg-consent__hint">版本 {{ consentVersionLabel(version) }} · 你可以随时联系老师了解这些安排。</text>
    </view>
  </view>
</template>

<style scoped>
.pg-consent__policy { color: var(--accent-text); font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-consent__column { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-consent__hero { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); text-align: center; }
.pg-consent__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-consent__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-consent__enter { animation: pg-item-in var(--dur-slow) var(--ease-out) both; }
.pg-consent__head { display: flex; align-items: center; gap: var(--sp-2); }
.pg-consent__name { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.35; }
.pg-consent__tag {
  flex: none;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-12);
}
.pg-consent__tag--req { background: var(--accent-soft); color: var(--accent-text); }
.pg-consent__summary { display: block; margin-top: var(--sp-2); color: var(--ink); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-consent__more { margin-top: var(--sp-1); color: var(--accent-text); }
.pg-consent__detail { display: block; padding: var(--sp-3); border-radius: var(--radius-12); background: var(--paper-2); color: var(--ink-2); }
.pg-consent__error { color: var(--fox-text); font-size: var(--fs-13); }
.pg-consent__hint { color: var(--ink-2); font-size: var(--fs-12); line-height: 1.5; text-align: center; }
</style>
