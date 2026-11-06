<script setup lang="ts">
/**
 * 账号与密码：改密码（POST /auth/student/password，要当前密码）、退出所有设备（POST /auth/logout-all）。
 * 策略不过、当前密码不对都是服务端的文案，原样显示在表单里。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import MeSubHeader from '@/components/me/MeSubHeader.vue'
import { passwordFormError, type PasswordField } from '@/components/me/meLogic'
import { applyApiOverride } from '@/components/path/openPractice'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgDialog from '@/components/ui/PgDialog.vue'
import PgField from '@/components/ui/PgField.vue'
import { useToast } from '@/components/ui/useToast'
import { resetProgress } from '@/composables/useProgress'
import { resetSettingsSync } from '@/composables/useSettingsSync'
import { ACCOUNT_COPY } from '@/copy'
import { useSession } from '@/stores/session'

const session = useSession()
const toast = useToast()

const current = ref('')
const next = ref('')
const confirm = ref('')
const errorField = ref<PasswordField>('')
const errorText = ref('')
const serverError = ref('')
const saving = ref(false)

const confirmingDevices = ref(false)
const leaving = ref(false)

const fieldError = computed(() => (field: PasswordField) => (errorField.value === field ? errorText.value : ''))

onLoad((q) => {
  applyApiOverride(q)
})

async function save(): Promise<void> {
  if (saving.value) return
  serverError.value = ''
  const invalid = passwordFormError({ current: current.value, next: next.value, confirm: confirm.value })
  errorField.value = invalid.field
  errorText.value = invalid.message
  if (invalid.field) return
  saving.value = true
  try {
    const ok = await session.setPassword(next.value, current.value)
    if (!ok) {
      serverError.value = session.error.value ?? ''
      return
    }
    current.value = ''
    next.value = ''
    confirm.value = ''
    toast.show(ACCOUNT_COPY.saved, { tone: 'ok' })
  } finally {
    saving.value = false
  }
}

async function logoutEverywhere(): Promise<void> {
  if (leaving.value) return
  leaving.value = true
  try {
    await session.logoutAll()
  } catch {
    /* 接口失败也清掉本地登录态（session.logoutAll 的 finally），回登录页 */
  } finally {
    resetSettingsSync()
    resetProgress()
    leaving.value = false
    confirmingDevices.value = false
    uni.reLaunch({ url: '/pages/login/index' })
  }
}
</script>

<template>
  <AppShell active="me">
    <view class="pg-account" data-testid="account-page">
      <MeSubHeader :title="ACCOUNT_COPY.title" />

      <PgCard class="pg-account__card" data-testid="account-password">
        <text class="pg-account__title">{{ ACCOUNT_COPY.passwordTitle }}</text>
        <PgField :label="ACCOUNT_COPY.current" :error="fieldError('current')">
          <input v-model="current" class="pg-account__input" type="password" password data-testid="account-current" />
        </PgField>
        <PgField :label="ACCOUNT_COPY.next" :hint="ACCOUNT_COPY.nextHint" :error="fieldError('next')">
          <input v-model="next" class="pg-account__input" type="password" password data-testid="account-next" />
        </PgField>
        <PgField :label="ACCOUNT_COPY.confirm" :error="fieldError('confirm')">
          <input v-model="confirm" class="pg-account__input" type="password" password data-testid="account-confirm" @confirm="save" />
        </PgField>
        <text v-if="serverError" class="pg-account__error" role="alert" data-testid="account-error">{{ serverError }}</text>
        <PgButton block sound="tap" data-testid="account-save" :loading="saving" @tap="save">{{ ACCOUNT_COPY.save }}</PgButton>
        <text class="pg-account__hint">{{ ACCOUNT_COPY.forgot }}</text>
      </PgCard>

      <PgCard class="pg-account__card">
        <text class="pg-account__title">{{ ACCOUNT_COPY.devicesTitle }}</text>
        <text class="pg-account__hint">{{ ACCOUNT_COPY.devicesBody }}</text>
        <PgButton variant="secondary" block data-testid="account-logout-all" @tap="confirmingDevices = true">{{ ACCOUNT_COPY.devicesAction }}</PgButton>
      </PgCard>
    </view>

    <PgDialog
      v-model:open="confirmingDevices"
      :title="ACCOUNT_COPY.devicesConfirmTitle"
      :body="ACCOUNT_COPY.devicesConfirmBody"
      :confirm-text="ACCOUNT_COPY.devicesConfirm"
      danger
      :busy="leaving"
      confirm-testid="account-logout-all-confirm"
      cancel-testid="account-logout-all-cancel"
      @confirm="logoutEverywhere"
    />
  </AppShell>
</template>

<style scoped>
.pg-account { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-account__card { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-account__title { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-account__input { width: 100%; min-height: var(--touch); box-sizing: border-box; padding: 0 var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-12); background: var(--paper); color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-bold); }
.pg-account__input:focus-within { border-color: var(--accent); }
.pg-account__error { color: var(--fox-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-account__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
</style>
