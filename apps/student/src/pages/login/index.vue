<script setup lang="ts">
/** 登录（02 §4.1）：邀请码 6 位 + 学号；邀请码可从链接参数带入。真实接口（#18/#24）：POST /auth/student/login。 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isMockMode } from '@/api/client'
import { ageGateFor } from '@/auth/ageBand'
import { useSession } from '@/stores/session'
import WechatHint from '@/components/WechatHint.vue'

const session = useSession()
const loading = session.loading
const mockMode = isMockMode()
const invite = ref('')
const studentNo = ref('')
const error = ref('')

/** 登录后的去向：先看年龄分档（null/<14 → 年龄页），再按 consentRequired 去同意页或首页。 */
function redirectAfterLogin() {
  const target = session.consented.value ? '/pages/home/index' : '/pages/consent/index'
  const decision = ageGateFor(session.me.value?.ageBand)
  if (decision === 'need-age' || decision === 'blocked') {
    session.setPendingRoute(target)
    uni.redirectTo({ url: '/pages/age/index' })
    return
  }
  uni.redirectTo({ url: target })
}

onLoad(async (query) => {
  if (query?.invite) invite.value = String(query.invite).slice(0, 6)
  // 刷新页面时恢复服务端会话（真实模式）；mock 模式直接返回 false。
  if (await session.restore()) redirectAfterLogin()
})

async function submit() {
  error.value = ''
  if (invite.value.trim().length !== 6) { error.value = '请输入 6 位邀请码（可问老师要）'; return }
  if (!studentNo.value.trim()) { error.value = '请输入学号'; return }
  const ok = await session.login(invite.value.trim(), studentNo.value.trim())
  if (!ok) { error.value = session.error.value || '登录失败，请重试'; return }
  redirectAfterLogin()
}
</script>

<template>
  <view class="pg-page pg-login">
    <WechatHint />
    <view class="pg-login__brand">
      <text class="pg-login__title">证明陪练场</text>
      <text class="pg-login__sub pg-small">一张稿纸，一支红笔。写证明，不抄答案。</text>
    </view>
    <view class="pg-login__form pg-sheet">
      <text class="pg-login__label pg-small">邀请码</text>
      <input v-model="invite" class="pg-login__input pg-mono" data-testid="login-invite" maxlength="6" placeholder="6 位邀请码" />
      <text class="pg-login__label pg-small">学号</text>
      <input v-model="studentNo" class="pg-login__input" data-testid="login-studentno" placeholder="你的学号" />
      <text v-if="error" class="pg-login__error pg-small">{{ error }}</text>
      <button class="pg-login__submit" data-testid="login-submit" :disabled="loading" @tap="submit">{{ loading ? '登录中…' : '进入' }}</button>
    </view>
    <text class="pg-login__hint pg-small">
      {{ mockMode ? '当前为 mock 模式（离线演示）；接真实接口用 VITE_USE_MOCK=false 或 setMockMode(false)。' : '登录走服务端 #18：邀请码 + 学号认领名单，服务端写 HttpOnly 会话 Cookie。' }}
    </text>
  </view>
</template>

<style scoped>
.pg-login { display: flex; flex-direction: column; justify-content: center; min-height: 100vh; min-height: 100dvh; padding: var(--sp-6); }
.pg-login__brand { margin-bottom: var(--sp-6); }
.pg-login__title { display: block; font-family: var(--font-serif); font-size: 30px; font-weight: 600; color: var(--ink); }
.pg-login__sub { display: block; margin-top: var(--sp-2); color: var(--ink-2); }
.pg-login__form { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-login__label { color: var(--ink-2); margin-top: var(--sp-2); }
.pg-login__input {
  min-height: 44px; margin-top: var(--sp-1); padding: 0 var(--sp-3);
  border: 1px solid var(--rule); border-radius: var(--radius-input);
  background: var(--sheet); color: var(--ink); font-size: 16px;
}
.pg-login__error { color: var(--margin); margin-top: var(--sp-1); }
.pg-login__submit {
  margin-top: var(--sp-3); min-height: 48px; border-radius: var(--radius-input);
  background: var(--accent); color: var(--on-accent); border: 0; font-size: 16px;
}
.pg-login__submit:disabled { opacity: 0.5; }
.pg-login__hint { margin-top: var(--sp-4); color: var(--ink-2); text-align: center; }
</style>
