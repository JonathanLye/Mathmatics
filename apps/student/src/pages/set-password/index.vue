<script setup lang="ts">
import PgMascot from '@/components/ui/PgMascot.vue'
/**
 * 设置密码：用邀请码第一次登录（或老师重置之后）必经的一步。
 * 规则由服务端判定并给出可直接展示的中文原因；本页只检查「两次输入一致」，不自己判定密码够不够强。
 * 设好之后继续原来的路径：年龄分档 → 同意书 → 首页。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { planAfterLogin } from '@/auth/afterLogin'
import { useSession } from '@/stores/session'

const session = useSession()
const loading = session.loading
const password = ref('')
const confirm = ref('')
const error = ref('')

onLoad(async () => {
  // 刷新页面后本地没有 Me：先恢复会话；没有会话就回登录页，已经设过密码就直接往下走。
  if (!session.me.value && !(await session.restore())) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  if (!session.needsPassword.value) next()
})

function next() {
  const plan = planAfterLogin(session.me.value, session.consented.value)
  if (plan.pending) session.setPendingRoute(plan.pending)
  uni.redirectTo({ url: plan.url })
}

async function submit() {
  error.value = ''
  if (!password.value) { error.value = '请输入新密码'; return }
  if (password.value !== confirm.value) { error.value = '两次输入的密码不一样'; return }
  const ok = await session.setPassword(password.value)
  if (!ok) { error.value = session.error.value || '设置失败，请重试'; return }
  password.value = ''
  confirm.value = ''
  next()
}
</script>

<template>
  <view class="pg-page pg-setpw">
    <view class="pg-setpw__brand">
      <PgMascot expr="happy" :size="72" />
      <text class="pg-setpw__title">先设一个自己的密码</text>
      <text class="pg-setpw__sub pg-small">以后用学号和密码登录，别人拿到邀请码也进不了你的账号。8 到 64 个字符，不能是学号，也不要用 12345678 这类常见密码。</text>
    </view>
    <view class="pg-setpw__form pg-sheet">
      <text class="pg-setpw__label pg-small">新密码</text>
      <input v-model="password" class="pg-setpw__input" data-testid="setpw-password" type="password" password placeholder="至少 8 个字符" />
      <text class="pg-setpw__label pg-small">再输入一次</text>
      <input v-model="confirm" class="pg-setpw__input" data-testid="setpw-confirm" type="password" password placeholder="再输入一次" @confirm="submit" />
      <text v-if="error" class="pg-setpw__error pg-small" data-testid="setpw-error">{{ error }}</text>
      <button class="pg-setpw__submit" data-testid="setpw-submit" :disabled="loading" @tap="submit">{{ loading ? '保存中…' : '保存并继续' }}</button>
    </view>
    <text class="pg-setpw__hint pg-small">忘记密码时，请找老师在名单里重置。</text>
  </view>
</template>

<style scoped>
.pg-setpw { display: flex; flex-direction: column; justify-content: center; min-height: 100vh; min-height: 100dvh; padding: var(--sp-6); }
.pg-setpw__brand { margin-bottom: var(--sp-5); display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); }
.pg-setpw__title { display: block; font-size: 24px; font-weight: 900; color: var(--ink); }
.pg-setpw__sub { display: block; color: var(--ink-2); }
.pg-setpw__form { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-setpw__label { color: var(--ink-2); margin-top: var(--sp-2); }
.pg-setpw__input {
  min-height: 44px; margin-top: var(--sp-1); padding: 0 var(--sp-3);
  border: 2px solid var(--rule); border-bottom-width: var(--lip); border-radius: var(--radius-input);
  background: var(--sheet); color: var(--ink); font-size: 16px; font-weight: 700;
}
.pg-setpw__error { color: var(--margin-text); margin-top: var(--sp-1); }
.pg-setpw__submit { margin-top: var(--sp-3); min-height: 52px; border: 0; border-radius: var(--radius-card); background: var(--accent); box-shadow: 0 var(--lip) 0 var(--accent-lip); color: var(--on-accent); font-size: 16px; font-weight: 900; letter-spacing: 0.5px; }
.pg-setpw__submit::after { display: none; }
.pg-setpw__submit:active { transform: translateY(var(--lip)); box-shadow: none; }
.pg-setpw__submit:disabled { background: var(--rule); box-shadow: none; color: var(--ink-3); }
.pg-setpw__hint { margin-top: var(--sp-4); color: var(--ink-2); text-align: center; }
</style>
