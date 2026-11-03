<script setup lang="ts">
/** 同意页（02 §4.1 / 13 §2）：五段；必选三段默认勾选且不能取消；两段可选默认关。 */
import { ref } from 'vue'
import { useSession } from '@/stores/session'

const session = useSession()
const error = ref('')
const expanded = ref<string | null>(null)

function toggle(id: string) {
  const item = session.items.find((i) => i.id === id)
  if (!item || item.required) return
  item.value = !item.value
}

function submit() {
  error.value = ''
  if (!session.requiredOk.value) { error.value = '必选三项都要同意才能开始练习；有疑问请联系老师。'; return }
  if (!session.submitConsent()) { error.value = '提交失败，请重试'; return }
  uni.redirectTo({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="pg-page pg-consent">
    <text class="pg-consent__title">开始前，请读一下</text>
    <text class="pg-consent__sub pg-small">这是校内的练习工具。下面五段说明我们要用哪些数据、存在哪里、你能怎么选。</text>
    <view v-for="item in session.items" :key="item.id" class="pg-consent__item pg-sheet">
      <view class="pg-consent__head" @tap="expanded = expanded === item.id ? null : item.id">
        <text class="pg-consent__name">{{ item.title }}</text>
        <text v-if="item.required" class="pg-consent__tag pg-consent__tag--req pg-small">必选</text>
        <text v-else class="pg-consent__tag pg-small">可选</text>
        <switch class="pg-consent__switch" :checked="item.value" :disabled="item.required" @change="toggle(item.id)" />
      </view>
      <text class="pg-consent__summary pg-small">{{ item.summary }}</text>
      <text v-if="expanded === item.id" class="pg-consent__detail pg-small">{{ item.detail }}</text>
      <text class="pg-consent__more pg-small" @tap="expanded = expanded === item.id ? null : item.id">{{ expanded === item.id ? '收起全文' : '展开全文' }}</text>
    </view>
    <text v-if="error" class="pg-consent__error pg-small">{{ error }}</text>
    <button class="pg-consent__submit" @tap="submit">同意并开始</button>
    <text class="pg-consent__hint pg-small">P0 本地记录同意状态；版本号 {{ session.consentVersion }}。正式接口由服务端 #18 提供。</text>
  </view>
</template>

<style scoped>
.pg-consent { padding-top: calc(var(--safe-top) + var(--sp-4)); padding-bottom: calc(var(--sp-6) + var(--safe-bottom)); }
.pg-consent__title { display: block; font-family: var(--font-serif); font-size: 22px; font-weight: 600; margin-bottom: var(--sp-2); }
.pg-consent__sub { display: block; color: var(--ink-2); margin-bottom: var(--sp-3); }
.pg-consent__item { padding: var(--sp-3); margin-bottom: var(--sp-2); }
.pg-consent__head { display: flex; align-items: center; gap: var(--sp-2); }
.pg-consent__name { flex: 1; font-weight: 600; font-size: 15px; }
.pg-consent__tag { padding: 1px 8px; border-radius: 999px; background: var(--paper); color: var(--ink-2); }
.pg-consent__tag--req { color: var(--accent); background: var(--accent-soft); }
.pg-consent__switch { transform: scale(0.8); }
.pg-consent__summary { display: block; margin-top: var(--sp-2); color: var(--ink); }
.pg-consent__detail { display: block; margin-top: var(--sp-2); padding: var(--sp-2); background: var(--paper); border-radius: var(--radius-input); color: var(--ink-2); line-height: 1.6; }
.pg-consent__more { display: inline-block; margin-top: var(--sp-2); color: var(--accent); text-decoration: underline; }
.pg-consent__error { display: block; color: var(--margin); margin: var(--sp-2) 0; }
.pg-consent__submit { margin-top: var(--sp-3); min-height: 48px; border-radius: var(--radius-input); border: 0; background: var(--accent); color: #fff; font-size: 16px; }
.pg-consent__hint { display: block; margin-top: var(--sp-3); color: var(--ink-2); }
</style>
