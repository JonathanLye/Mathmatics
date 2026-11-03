<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api, ApiError } from '../api/client.ts';
import { safeRedirect } from '../utils/redirect.ts';
import { loadSession } from '../stores/session.ts';

const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

async function submit(): Promise<void> {
  if (username.value.trim() === '' || password.value === '') {
    error.value = '请输入用户名和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await api.post('/api/v1/auth/teacher/login', {
      username: username.value.trim(),
      password: password.value,
    });
    await loadSession();
    await router.push(safeRedirect(route.query.redirect));
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '登录失败，请稍后再试';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1>教师登录</h1>
      <div class="login-sub">证明陪练场 · 教师端（账号由运维创建）</div>
      <div class="login-error">{{ error }}</div>
      <t-form label-width="0" @submit.prevent>
        <t-form-item>
          <t-input v-model="username" placeholder="用户名" size="large" autocomplete="username" />
        </t-form-item>
        <t-form-item>
          <t-input
            v-model="password"
            type="password"
            placeholder="密码"
            size="large"
            autocomplete="current-password"
            @enter="submit"
          />
        </t-form-item>
        <t-button theme="primary" size="large" block :loading="loading" @click="submit">登录</t-button>
      </t-form>
    </div>
  </div>
</template>
