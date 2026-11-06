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
  <div>
    <div class="page-head"><h1>设置</h1></div>
    <div class="page-sub">账号信息与默认策略说明（04 §1）。默认策略目前按班级设置，在「布置」时随作业提交。</div>

    <h4 style="margin-top: 18px">账号</h4>
    <t-table
      :data="me ? [{ key: '角色', value: me.role === 'admin' ? '管理员' : me.role === 'teacher' ? '教师' : me.role }, { key: '匿名码', value: me.anonCode }, { key: '显示名', value: me.displayName ?? '—' }] : []"
      :columns="[{ colKey: 'key', title: '项' }, { colKey: 'value', title: '值' }]"
      row-key="key"
      size="small"
    />

    <h4 style="margin-top: 18px">修改密码</h4>
    <t-form :data="{}" label-width="100px" style="max-width: 420px" @submit="changePassword">
      <t-form-item label="当前密码">
        <t-input v-model="currentPassword" type="password" autocomplete="current-password" data-testid="pw-current" />
      </t-form-item>
      <t-form-item label="新密码">
        <t-input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 个字符" data-testid="pw-new" />
      </t-form-item>
      <t-form-item label="确认新密码">
        <t-input v-model="confirmPassword" type="password" autocomplete="new-password" data-testid="pw-confirm" />
      </t-form-item>
      <t-alert v-if="pwError" theme="warning" :message="pwError" style="margin-bottom: 12px" data-testid="pw-error" />
      <t-button theme="primary" :loading="pwSaving" data-testid="pw-submit" @click="changePassword">修改密码</t-button>
    </t-form>

    <h4 style="margin-top: 18px">默认策略（04 §7）</h4>
    <t-alert
      theme="info"
      message="练习：求助开、拍照开、记录切出；测验：只 L3、求助关、拍照关、切出 3 次锁定、可设限时。当前在布置表单中逐次设置，不做全局默认。"
    />

    <div style="margin-top: 20px">
      <t-button theme="danger" variant="outline" :loading="loggingOut" @click="logout">退出登录</t-button>
      <t-popconfirm content="所有设备（包括这一台）上的教师登录都会退出，确定？" @confirm="logoutAll">
        <t-button theme="danger" variant="text" :loading="loggingOutAll" data-testid="logout-all" style="margin-left: 8px">退出所有设备</t-button>
      </t-popconfirm>
    </div>
  </div>
</template>
