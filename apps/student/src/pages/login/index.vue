<script setup lang="ts">
/**
 * 登录（02 §4.1）：默认 学号 + 密码；第一次来（或密码被老师重置）切到 邀请码 + 学号。
 * 邀请码可从链接参数带入（带入时自动进邀请码模式）。真实接口：POST /auth/student/login。
 * 手机：小方 + 大标题 + 一个表单；桌面：左边是六步路径插画，右边是不超过 420 宽的卡片。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isMockMode, isMockOnboardingScenario } from '@/api/client'
import { resolveAfterLogin } from '@/auth/afterLogin'
import { buildLoginCredentials, FORGOT_PASSWORD_HELP, friendlyLoginError, initialLoginMode, type LoginMode } from '@/auth/loginForm'
import IntroStory from '@/components/onboarding/IntroStory.vue'
import PathIllustration from '@/components/onboarding/PathIllustration.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgField from '@/components/ui/PgField.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import WechatHint from '@/components/WechatHint.vue'
import { deviceIntroSeen, markDeviceIntroSeen } from '@/composables/useOnboarding'
import { LOGIN_COPY } from '@/copy/onboarding'
import { SANDBOX_READY } from '@/onboarding/logic'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'

const session = useSession()
useFeedbackPrefs() // 读出本机的动效开关：登录前的页面也要尊重“关闭动效”
const loading = session.loading
const mockMode = isMockMode()
const mode = ref<LoginMode>(initialLoginMode({ mock: mockMode, inviteFromLink: '' }))
const invite = ref('')
const studentNo = ref('')
const password = ref('')
const error = ref('')
const showForgot = ref(false)
const introOpen = ref(false)

const MODE_OPTIONS = [
  { value: 'password' as LoginMode, label: LOGIN_COPY.modePassword, testid: 'login-mode-password' },
  { value: 'invite' as LoginMode, label: LOGIN_COPY.modeInvite, testid: 'login-mode-invite' },
]

/** 登录后的去向：先设密码（Me.needsPassword），再看年龄分档，最后同意书、欢迎页或首页。 */
async function redirectAfterLogin() {
  const plan = await resolveAfterLogin(session.me.value, session.consented.value)
  if (plan.pending) session.setPendingRoute(plan.pending)
  uni.redirectTo({ url: plan.url })
}

/** 第一次来这台设备就放开场动画；演示数据只在 ?onboarding=new 时放，免得打断演示和自动化流程。 */
function shouldAutoplayIntro(): boolean {
  return (!mockMode || isMockOnboardingScenario()) && !deviceIntroSeen()
}

onLoad(async (query) => {
  if (query?.invite) {
    invite.value = String(query.invite).slice(0, 6)
    mode.value = initialLoginMode({ mock: mockMode, inviteFromLink: invite.value })
  }
  // 刷新页面时恢复服务端会话（真实模式）；mock 模式直接返回 false。
  if (await session.restore()) {
    await redirectAfterLogin()
    return
  }
  if (shouldAutoplayIntro()) introOpen.value = true
})

function onIntroDone() {
  introOpen.value = false
  markDeviceIntroSeen()
}

function switchMode(next: LoginMode) {
  if (next === mode.value) return
  mode.value = next
  error.value = ''
  showForgot.value = false
}

/** 教师端是同域另一个应用（/t/），整页跳转。 */
function goTeacher() {
  if (typeof window !== 'undefined') window.location.href = '/t/'
}

function goSandbox() {
  uni.navigateTo({ url: '/pages/tour/index' })
}

async function submit() {
  error.value = ''
  const built = buildLoginCredentials(mode.value, { invite: invite.value, studentNo: studentNo.value, password: password.value })
  if (!built.ok) { error.value = built.error; return }
  const ok = await session.login(built.credentials)
  if (!ok) { error.value = friendlyLoginError(session.error.value, LOGIN_COPY.generic); return }
  password.value = ''
  await redirectAfterLogin()
}
</script>

<template>
  <view class="pg-page pg-login" data-testid="login-page">
    <WechatHint />
    <view class="pg-login__layout">
      <view class="pg-login__panel" aria-hidden="true">
        <PathIllustration mode="loop" :labels="true" />
        <text class="pg-login__paneltitle">一行一行，自己把证明写出来</text>
        <text class="pg-login__panelsub">小方陪你走完每一步，卡住了就问，它只提问，不替你写。</text>
      </view>

      <view class="pg-login__card pg-enter">
        <view class="pg-login__brand">
          <PgMascot expr="happy" :motion="['hop', 'breathe', 'blink']" :size="104" />
          <text class="pg-login__title">{{ LOGIN_COPY.title }}</text>
          <text class="pg-login__sub">{{ LOGIN_COPY.sub }}</text>
        </view>

        <PgSegmented :model-value="mode" :options="MODE_OPTIONS" label="登录方式" class="pg-login__modes" @update:model-value="switchMode" />

        <view :key="mode" class="pg-login__pane">
          <PgField v-if="mode === 'invite'" :label="LOGIN_COPY.invite">
            <input v-model="invite" class="pg-login__input" :class="{ 'pg-mono': invite }" data-testid="login-invite" maxlength="6" :placeholder="LOGIN_COPY.invitePlaceholder" autocapitalize="characters" />
          </PgField>
          <PgField :label="LOGIN_COPY.studentNo">
            <input v-model="studentNo" class="pg-login__input" data-testid="login-studentno" :placeholder="LOGIN_COPY.studentNoPlaceholder" @confirm="mode === 'invite' ? submit() : undefined" />
          </PgField>
          <PgField v-if="mode === 'password'" :label="LOGIN_COPY.password">
            <input v-model="password" class="pg-login__input" data-testid="login-password" type="password" password :placeholder="LOGIN_COPY.passwordPlaceholder" @confirm="submit" />
          </PgField>
        </view>

        <text v-if="error" class="pg-login__error" data-testid="login-error" role="alert">{{ error }}</text>

        <PgButton block size="lg" class="pg-login__submit" data-testid="login-submit" :loading="loading" @tap="submit">
          {{ loading ? LOGIN_COPY.submitBusy : mode === 'invite' ? LOGIN_COPY.submitInvite : LOGIN_COPY.submitPassword }}
        </PgButton>

        <text class="pg-login__hint">{{ mode === 'invite' ? LOGIN_COPY.hintInvite : LOGIN_COPY.hintPassword }}</text>

        <view class="pg-login__more">
          <PgButton v-if="SANDBOX_READY" variant="secondary" block data-testid="login-try" @tap="goSandbox">{{ LOGIN_COPY.trySandbox }}</PgButton>
          <view class="pg-login__links">
            <text class="pg-login__link" role="button" tabindex="0" data-testid="login-watch-intro" @tap="introOpen = true">{{ LOGIN_COPY.watchIntro }}</text>
            <text class="pg-login__link" role="button" tabindex="0" data-testid="login-forgot" @tap="showForgot = !showForgot">{{ LOGIN_COPY.forgot }}</text>
            <text class="pg-login__link" role="link" tabindex="0" data-testid="login-switch-teacher" @tap="goTeacher">{{ LOGIN_COPY.teacher }}</text>
          </view>
          <text v-if="showForgot" class="pg-login__help" data-testid="login-forgot-help">{{ FORGOT_PASSWORD_HELP }}</text>
        </view>
      </view>
    </view>

    <IntroStory v-if="introOpen" @done="onIntroDone" />
  </view>
</template>

<style scoped>
.pg-login {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding-top: calc(var(--safe-top) + var(--sp-6));
  padding-bottom: calc(var(--safe-bottom) + var(--sp-6));
}
.pg-login__layout { display: flex; align-items: center; justify-content: center; gap: var(--sp-10); width: 100%; margin: 0 auto; }
.pg-login__panel { display: none; }

.pg-login__card { display: flex; flex-direction: column; gap: var(--sp-4); width: 100%; max-width: 420px; min-width: 0; }
.pg-login__brand { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); margin-bottom: var(--sp-2); text-align: center; }
.pg-login__title { margin-top: var(--sp-2); color: var(--ink); font-size: var(--fs-28); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-login__sub { color: var(--ink-2); font-size: var(--fs-15); }

.pg-login__modes { margin-bottom: var(--sp-1); }
.pg-login__pane { display: flex; flex-direction: column; gap: var(--sp-3); animation: pg-item-in var(--dur-base) var(--ease-out) both; }
.pg-login__input {
  min-height: 48px; padding: 0 var(--sp-3);
  border: var(--bw) solid var(--rule); border-bottom-width: calc(var(--bw) + var(--lip) - 2px); border-radius: var(--radius-12);
  background: var(--sheet); color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-bold);
  transition: border-color var(--dur-fast) ease-out;
}
.pg-login__input:focus-within { border-color: var(--accent); }
.pg-login__error { padding: var(--sp-3); border-radius: var(--radius-12); background: var(--fox-soft); color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-black); animation: pg-shake 320ms ease-in-out both; }
.pg-login__submit { margin-top: var(--sp-1); }
.pg-login__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.55; text-align: center; }
.pg-login__more { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-login__links { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2) var(--sp-5); }
.pg-login__link {
  display: inline-flex; align-items: center; min-height: var(--touch);
  color: var(--accent-text); font-size: var(--fs-13); font-weight: var(--fw-black); cursor: pointer;
}
.pg-login__help { padding: var(--sp-3); border-radius: var(--radius-12); background: var(--paper-2); color: var(--ink-2); font-size: var(--fs-13); line-height: 1.55; animation: pg-item-in var(--dur-base) var(--ease-out) both; }

/* 桌面：左边插画，右边卡片 */
@media (min-width: 900px) {
  .pg-login__panel {
    display: flex; flex-direction: column; align-items: center; gap: var(--sp-3);
    flex: 0 1 440px; padding: var(--sp-8) var(--sp-6);
    border-radius: var(--radius-24); background: var(--paper-2); text-align: center;
  }
  .pg-login__paneltitle { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
  .pg-login__panelsub { max-width: 320px; color: var(--ink-2); font-size: var(--fs-15); line-height: var(--lh-body); }
  .pg-login__card {
    flex: 0 1 420px; padding: var(--sp-6);
    border: var(--bw) solid var(--rule); border-bottom-width: calc(var(--bw) + var(--lip) - 2px); border-radius: var(--radius-24); background: var(--sheet);
  }
}
</style>
