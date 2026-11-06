<script setup lang="ts">
import PgMascot from '@/components/ui/PgMascot.vue'
/**
 * 登录（02 §4.1）：默认 学号 + 密码；第一次来（或密码被老师重置）切到 邀请码 + 学号。
 * 邀请码可从链接参数带入（带入时自动进邀请码模式）。真实接口：POST /auth/student/login。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isMockMode } from '@/api/client'
import { planAfterLogin } from '@/auth/afterLogin'
import { buildLoginCredentials, FORGOT_PASSWORD_HELP, initialLoginMode, type LoginMode } from '@/auth/loginForm'
import { useSession } from '@/stores/session'
import WechatHint from '@/components/WechatHint.vue'

const session = useSession()
const loading = session.loading
const mockMode = isMockMode()
const mode = ref<LoginMode>(initialLoginMode({ mock: mockMode, inviteFromLink: '' }))
const invite = ref('')
const studentNo = ref('')
const password = ref('')
const error = ref('')
const showForgot = ref(false)

/** 登录后的去向：先设密码（Me.needsPassword），再看年龄分档，最后同意书或首页。 */
function redirectAfterLogin() {
  const plan = planAfterLogin(session.me.value, session.consented.value)
  if (plan.pending) session.setPendingRoute(plan.pending)
  uni.redirectTo({ url: plan.url })
}

onLoad(async (query) => {
  if (query?.invite) {
    invite.value = String(query.invite).slice(0, 6)
    mode.value = initialLoginMode({ mock: mockMode, inviteFromLink: invite.value })
  }
  // 刷新页面时恢复服务端会话（真实模式）；mock 模式直接返回 false。
  if (await session.restore()) redirectAfterLogin()
})

function switchMode(next: LoginMode) {
  mode.value = next
  error.value = ''
  showForgot.value = false
}

/** 教师端是同域另一个应用（/t/），整页跳转。 */
function goTeacher() {
  if (typeof window !== 'undefined') window.location.href = '/t/'
}

async function submit() {
  error.value = ''
  const built = buildLoginCredentials(mode.value, { invite: invite.value, studentNo: studentNo.value, password: password.value })
  if (!built.ok) { error.value = built.error; return }
  const ok = await session.login(built.credentials)
  if (!ok) { error.value = session.error.value || '登录失败，请重试'; return }
  password.value = ''
  redirectAfterLogin()
}
</script>

<template>
  <view class="pg-page pg-login">
    <WechatHint />
    <view class="pg-login__brand">
      <PgMascot expr="happy" :size="96" />
      <text class="pg-login__title">证明陪练场</text>
      <text class="pg-login__sub pg-small">一行一行写证明，不抄答案。</text>
    </view>
    <view class="pg-login__form pg-sheet">
      <template v-if="mode === 'invite'">
        <text class="pg-login__label pg-small">邀请码</text>
        <input v-model="invite" class="pg-login__input pg-mono" data-testid="login-invite" maxlength="6" placeholder="6 位邀请码" />
      </template>
      <text class="pg-login__label pg-small">学号</text>
      <input v-model="studentNo" class="pg-login__input" data-testid="login-studentno" placeholder="你的学号" />
      <template v-if="mode === 'password'">
        <text class="pg-login__label pg-small">密码</text>
        <input v-model="password" class="pg-login__input" data-testid="login-password" type="password" password placeholder="你的密码" @confirm="submit" />
      </template>
      <text v-if="error" class="pg-login__error pg-small" data-testid="login-error">{{ error }}</text>
      <button class="pg-login__submit" data-testid="login-submit" :disabled="loading" @tap="submit">{{ loading ? '登录中…' : mode === 'invite' ? '激活并进入' : '进入' }}</button>
      <view class="pg-login__links">
        <text v-if="mode === 'password'" class="pg-login__link pg-small" data-testid="login-mode-invite" @tap="switchMode('invite')">第一次来？用邀请码激活</text>
        <text v-else class="pg-login__link pg-small" data-testid="login-mode-password" @tap="switchMode('password')">已经设过密码？用密码登录</text>
        <text class="pg-login__link pg-small" data-testid="login-forgot" @tap="showForgot = !showForgot">忘记密码</text>
      </view>
      <text v-if="showForgot" class="pg-login__help pg-small" data-testid="login-forgot-help">{{ FORGOT_PASSWORD_HELP }}</text>
    </view>
    <text v-if="mockMode" class="pg-login__hint pg-small">当前为离线演示模式。</text>
    <text v-else class="pg-login__hint pg-small">
      {{ mode === 'invite' ? '第一次登录：输入老师给你的 6 位邀请码和学号，进去后设一个自己的密码。' : '输入学号和你设的密码。' }}
    </text>
    <text class="pg-login__hint pg-small" data-testid="login-switch-teacher" @tap="goTeacher">我是老师</text>
  </view>
</template>

<style scoped>
.pg-login { display: flex; flex-direction: column; justify-content: center; min-height: 100vh; min-height: 100dvh; padding: var(--sp-6); }
.pg-login__brand { margin-bottom: var(--sp-6); display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); }
.pg-login__title { display: block; font-size: 30px; font-weight: 900; color: var(--ink); }
.pg-login__sub { display: block; margin-top: var(--sp-2); color: var(--ink-2); }
.pg-login__form { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-login__label { color: var(--ink-2); margin-top: var(--sp-2); }
.pg-login__input {
  min-height: 44px; margin-top: var(--sp-1); padding: 0 var(--sp-3);
  border: 2px solid var(--rule); border-bottom-width: var(--lip); border-radius: var(--radius-input);
  background: var(--sheet); color: var(--ink); font-size: 16px; font-weight: 700;
}
.pg-login__error { color: var(--margin-text); margin-top: var(--sp-1); }
.pg-login__submit { margin-top: var(--sp-3); min-height: 52px; border: 0; border-radius: var(--radius-card); background: var(--accent); box-shadow: 0 var(--lip) 0 var(--accent-lip); color: var(--on-accent); font-size: 16px; font-weight: 900; letter-spacing: 0.5px; }
.pg-login__submit::after { display: none; }
.pg-login__submit:active { transform: translateY(var(--lip)); box-shadow: none; }
.pg-login__submit:disabled { background: var(--rule); box-shadow: none; color: var(--ink-3); }
.pg-login__links { display: flex; justify-content: space-between; margin-top: var(--sp-3); }
.pg-login__link { color: var(--accent); text-decoration: underline; }
.pg-login__help { margin-top: var(--sp-2); color: var(--ink-2); }
.pg-login__hint { margin-top: var(--sp-4); color: var(--ink-2); text-align: center; }
</style>
