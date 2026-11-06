<script setup lang="ts">
/**
 * 同意页（02 §4.1 / 13 §2 / #145）：
 * - 文本与签署状态来自 GET /consents；必选三段固定同意，可选两段默认关；
 * - 14–17 岁服务端会多返回一段 guardianNotice（建议告知监护人）：**只读展示，不做开关、不参与签署**
 *   （POST /consents 的 items 只有契约的 5 个可签键；14 岁以下不产生同意书）；
 * - 进入前先过年龄门（Me.ageBand 为 null / lt14 → 年龄选择页）。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isMockMode } from '@/api/client'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { useSession } from '@/stores/session'

const session = useSession()
const items = session.items
const version = session.docVersion
const requiredOk = session.requiredOk
const loading = session.loading
const mockMode = isMockMode()
const error = ref('')
const expanded = ref<string | null>(null)
const errorText = computed(() => error.value || session.error.value || '')

onLoad(async () => {
  // #145：年龄门（登录后、同意前）；被重定向时不继续加载/签署。
  if (!ageGatePassed(await enforceAgeGate())) return
  await session.loadConsentDoc()
  if (session.consented.value) uni.redirectTo({ url: '/pages/home/index' })
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
  uni.redirectTo({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="pg-page pg-consent" data-testid="consent-page">
    <text class="pg-consent__title">开始前，请读一下</text>
    <text class="pg-consent__sub pg-small">这是校内的练习工具。下面说明我们要用哪些数据、存在哪里、你能怎么选。</text>
    <view v-if="loading" class="pg-consent__item pg-sheet">
      <text class="pg-consent__summary pg-small">正在加载同意书…</text>
    </view>
    <view v-for="item in items" :key="item.id" class="pg-consent__item pg-sheet" :data-testid="'consent-item-' + item.id">
      <!-- guardianNotice（14–17 岁）只读说明：没有开关、不参与签署 -->
      <template v-if="item.readOnly">
        <view class="pg-consent__head" @tap="expanded = expanded === item.id ? null : item.id">
          <text class="pg-consent__name">{{ item.title }}</text>
          <text class="pg-consent__tag pg-small" data-testid="consent-readonly-badge">只读说明</text>
        </view>
        <text class="pg-consent__summary pg-small">{{ item.summary }}</text>
        <text v-if="expanded === item.id" class="pg-consent__detail pg-small">{{ item.detail }}</text>
        <text class="pg-consent__more pg-small" @tap="expanded = expanded === item.id ? null : item.id">
          {{ expanded === item.id ? '收起全文' : '展开全文' }}
        </text>
      </template>
      <template v-else>
        <view class="pg-consent__head" @tap="expanded = expanded === item.id ? null : item.id">
          <text class="pg-consent__name">{{ item.title }}</text>
          <text v-if="item.required" class="pg-consent__tag pg-consent__tag--req pg-small">必选</text>
          <text v-else class="pg-consent__tag pg-small">可选</text>
          <switch
            class="pg-consent__switch"
            color="#58cc02"
            :checked="item.value"
            :disabled="item.required"
            :data-testid="'consent-switch-' + item.id"
            @change="toggle(item.id)"
          />
        </view>
        <text class="pg-consent__summary pg-small">{{ item.summary }}</text>
        <text v-if="expanded === item.id" class="pg-consent__detail pg-small">{{ item.detail }}</text>
        <text class="pg-consent__more pg-small" @tap="expanded = expanded === item.id ? null : item.id">
          {{ expanded === item.id ? '收起全文' : '展开全文' }}
        </text>
      </template>
    </view>
    <text v-if="errorText" class="pg-consent__error pg-small">{{ errorText }}</text>
    <button class="pg-consent__submit" data-testid="consent-submit" :disabled="loading" @tap="submit">
      {{ loading ? '提交中…' : '同意并开始' }}
    </button>
    <text class="pg-consent__hint pg-small">
      版本 {{ version }} · {{ mockMode ? 'mock 模式：正文为占位（正式文本由服务端 /consents 提供），签署只记在本地。' : '你可以随时联系老师了解这些安排。' }}
    </text>
  </view>
</template>

<style scoped>
.pg-consent { padding-top: calc(var(--safe-top) + var(--sp-4)); padding-bottom: calc(var(--sp-6) + var(--safe-bottom)); }
.pg-consent__title { display: block; font-size: 22px; font-weight: 900; margin-bottom: var(--sp-2); }
.pg-consent__sub { display: block; color: var(--ink-2); margin-bottom: var(--sp-3); }
.pg-consent__item { padding: var(--sp-3); margin-bottom: var(--sp-2); }
.pg-consent__head { display: flex; align-items: center; gap: var(--sp-2); }
.pg-consent__name { flex: 1; font-weight: 600; font-size: 15px; }
.pg-consent__tag { padding: 1px 8px; border-radius: 999px; background: var(--paper); color: var(--ink-2); }
.pg-consent__tag--req { color: var(--accent-text); background: var(--accent-soft); }
.pg-consent__switch { transform: scale(0.8); }
.pg-consent__summary { display: block; margin-top: var(--sp-2); color: var(--ink); }
.pg-consent__detail { display: block; margin-top: var(--sp-2); padding: var(--sp-2); background: var(--paper); border-radius: var(--radius-input); color: var(--ink-2); line-height: 1.6; }
.pg-consent__more { display: inline-block; margin-top: var(--sp-2); color: var(--accent-text); text-decoration: underline; }
.pg-consent__error { display: block; color: var(--margin-text); margin: var(--sp-2) 0; }
.pg-consent__submit { margin-top: var(--sp-3); min-height: 52px; border: 0; border-radius: var(--radius-card); background: var(--accent); box-shadow: 0 var(--lip) 0 var(--accent-lip); color: var(--on-accent); font-size: 16px; font-weight: 900; letter-spacing: 0.5px; }
.pg-consent__submit::after { display: none; }
.pg-consent__submit:active { transform: translateY(var(--lip)); box-shadow: none; }
.pg-consent__submit:disabled { background: var(--rule); box-shadow: none; color: var(--ink-3); }
.pg-consent__hint { display: block; margin-top: var(--sp-3); color: var(--ink-2); }
</style>
