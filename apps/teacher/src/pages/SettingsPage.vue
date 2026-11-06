<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import { clearSession, session } from '../stores/session.ts';
import { checkPasswordForm } from '../utils/password.ts';

const router = useRouter();
const loggingOut = ref(false);
const me = computed(() => session.me);

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const pwError = ref('');
const pwSaving = ref(false);
const loggingOutAll = ref(false);

// 修改密码：成功后其他设备上的登录会失效（当前这个保留）。当前密码不对由服务端返回 403，在表单里就地显示。
async function changePassword(): Promise<void> {
  if (pwSaving.value) return;
  pwError.value = checkPasswordForm(currentPassword.value, newPassword.value, confirmPassword.value) ?? '';
  if (pwError.value !== '') return;
  pwSaving.value = true;
  try {
    await api.post('/api/v1/auth/teacher/password', { currentPassword: currentPassword.value, newPassword: newPassword.value });
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    MessagePlugin.success('密码已修改，其他设备上的登录已退出');
  } catch (caught) {
    pwError.value = caught instanceof ApiError ? caught.message : '修改失败，请重试';
  } finally {
    pwSaving.value = false;
  }
}

async function logoutAll(): Promise<void> {
  if (loggingOutAll.value) return;
  loggingOutAll.value = true;
  try {
    await api.post('/api/v1/auth/logout-all');
  } catch {
    // 会话已失效也允许退出
  } finally {
    clearSession();
    loggingOutAll.value = false;
    await router.push('/login');
  }
}

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await api.post('/api/v1/auth/logout');
  } catch {
    // 会话已失效也允许退出
  } finally {
    clearSession();
    loggingOut.value = false;
    await router.push('/login');
  }
}
</script>

<template>
  <div class="page settings">
    <div class="page-head"><h1>设置</h1></div>
    <div class="page-sub">账号信息、登录密码，以及布置作业时的默认做法。</div>

    <section class="surface settings__card">
      <h2 class="settings__h">账号</h2>
      <dl class="settings__dl">
        <div><dt>身份</dt><dd>{{ me ? (me.role === 'admin' ? '管理员' : me.role === 'teacher' ? '老师' : me.role) : '—' }}</dd></div>
        <div><dt>显示名</dt><dd>{{ me?.displayName ?? '—' }}</dd></div>
        <div><dt>匿名码</dt><dd class="mono">{{ me?.anonCode ?? '—' }}</dd></div>
      </dl>
    </section>

    <section class="surface settings__card">
      <h2 class="settings__h">修改密码</h2>
      <p class="settings__note">改好后，其他设备上的登录会退出，这一台保持登录。</p>
      <t-form :data="{}" label-align="top" class="settings__form" @submit="changePassword">
        <t-form-item label="当前密码">
          <t-input v-model="currentPassword" type="password" autocomplete="current-password" data-testid="pw-current" />
        </t-form-item>
        <t-form-item label="新密码">
          <t-input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 个字符" data-testid="pw-new" />
        </t-form-item>
        <t-form-item label="再输入一次新密码">
          <t-input v-model="confirmPassword" type="password" autocomplete="new-password" data-testid="pw-confirm" />
        </t-form-item>
        <t-alert v-if="pwError" theme="warning" :message="pwError" style="margin-bottom: 12px" data-testid="pw-error" />
        <t-button theme="primary" :loading="pwSaving" data-testid="pw-submit" @click="changePassword">修改密码</t-button>
      </t-form>
    </section>

    <section class="surface settings__card">
      <h2 class="settings__h">布置作业的默认做法</h2>
      <ul class="settings__list">
        <li><b>练习：</b>允许求助和拍照，记录学生切出页面的次数。</li>
        <li><b>测验：</b>只能写证明，关闭求助和拍照，切出页面达到设定次数就锁定作答，可以设时限。</li>
      </ul>
      <p class="settings__note">每次布置时可以单独调整；每个班的默认值在班级页的“设置”里改。</p>
    </section>

    <section class="surface settings__card">
      <h2 class="settings__h">退出登录</h2>
      <div class="inline-actions">
        <t-button theme="default" variant="outline" :loading="loggingOut" @click="logout">退出登录</t-button>
        <t-popconfirm content="所有设备（包括这一台）上的老师登录都会退出，确定？" @confirm="logoutAll">
          <t-button theme="danger" variant="text" :loading="loggingOutAll" data-testid="logout-all">退出所有设备</t-button>
        </t-popconfirm>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings { max-width: 640px; }
.settings__card { padding: 16px 18px; margin-bottom: 14px; }
.settings__h { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
.settings__note { color: var(--pg-text-secondary); margin: 0 0 12px; }
.settings__dl { margin: 0; display: grid; gap: 8px; }
.settings__dl > div { display: flex; gap: 12px; }
.settings__dl dt { width: 72px; flex: none; color: var(--pg-text-secondary); }
.settings__dl dd { margin: 0; }
.settings__form { max-width: 380px; }
.settings__form :deep(.t-form__item) { margin-bottom: 14px; }
.settings__form :deep(.t-form__label) { padding-bottom: 4px; }
.settings__form > .t-button { margin-top: 4px; }
.settings__list { margin: 0 0 8px; padding-left: 18px; }
.settings__list li { margin-bottom: 4px; }
</style>
