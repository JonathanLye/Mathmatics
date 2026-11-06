<script setup lang="ts">
/**
 * 设置密码：用邀请码第一次登录（或老师重置之后）必经的一步。
 * 规则由服务端判定并给出可直接展示的中文原因；本页只检查「两次输入一致」，不自己判定密码够不够强。
 * 设好之后继续原来的路径：年龄分档 → 同意书 → 欢迎页 → 首页。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { resolveAfterLogin } from '@/auth/afterLogin'
import PgButton from '@/components/ui/PgButton.vue'
import PgField from '@/components/ui/PgField.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { SETPW_COPY } from '@/copy/onboarding'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'

const session = useSession()
useFeedbackPrefs() // 读出本机的动效开关：登录前的页面也要尊重“关闭动效”
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
  if (!session.needsPassword.value) await next()
})

async function next() {
  const plan = await resolveAfterLogin(session.me.value, session.consented.value)
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
  await next()
}
</script>

<template>
  <view class="pg-page pg-form-page pg-setpw" data-testid="setpw-page">
    <view class="pg-form-column pg-setpw__column pg-enter">
      <view class="pg-setpw__hero">
        <PgMascot expr="happy" :motion="['breathe', 'blink']" :size="88" />
        <text class="pg-setpw__title">{{ SETPW_COPY.title }}</text>
        <text class="pg-setpw__sub">{{ SETPW_COPY.sub }}</text>
      </view>

      <PgField :label="SETPW_COPY.password">
        <input v-model="password" class="pg-setpw__input" data-testid="setpw-password" type="password" password :placeholder="SETPW_COPY.passwordPlaceholder" />
      </PgField>
      <PgField :label="SETPW_COPY.again">
        <input v-model="confirm" class="pg-setpw__input" data-testid="setpw-confirm" type="password" password :placeholder="SETPW_COPY.againPlaceholder" @confirm="submit" />
      </PgField>

      <text v-if="error" class="pg-setpw__error" data-testid="setpw-error" role="alert">{{ error }}</text>
      <PgButton block size="lg" data-testid="setpw-submit" :loading="loading" @tap="submit">{{ loading ? SETPW_COPY.busy : SETPW_COPY.submit }}</PgButton>
      <text class="pg-setpw__hint">{{ SETPW_COPY.hint }}</text>
    </view>
  </view>
</template>

<style scoped>
.pg-setpw__column { display: flex; flex-direction: column; gap: var(--sp-4); }
.pg-setpw__hero { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); text-align: center; }
.pg-setpw__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-setpw__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-setpw__input {
  min-height: 48px; padding: 0 var(--sp-3);
  border: var(--bw) solid var(--rule); border-bottom-width: calc(var(--bw) + var(--lip) - 2px); border-radius: var(--radius-12);
  background: var(--sheet); color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-bold);
  transition: border-color var(--dur-fast) ease-out;
}
.pg-setpw__input:focus-within { border-color: var(--accent); }
.pg-setpw__error { padding: var(--sp-3); border-radius: var(--radius-12); background: var(--fox-soft); color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-black); animation: pg-shake 320ms ease-in-out both; }
.pg-setpw__hint { color: var(--ink-2); font-size: var(--fs-13); text-align: center; }
</style>
