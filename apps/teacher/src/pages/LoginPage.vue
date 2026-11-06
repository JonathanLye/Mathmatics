<script setup lang="ts">
import { SITE_RECORD } from '../site';
import Icon from '../components/ui/Icon.vue';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api, ApiError } from '../api/client.ts';
import { safeRedirect } from '../utils/redirect.ts';
import { loadSession } from '../stores/session.ts';

const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const totp = ref('');
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
      ...(totp.value.trim() === '' ? {} : { totp: totp.value.trim() }),
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
      <span class="app-logo"><Icon name="qed" :size="22" color="currentColor" /></span>
      <h1>教师登录</h1>
      <div class="login-sub">证明陪练场 · 教师端。账号由管理员创建。</div>
      <div v-if="error" class="login-error" role="alert">{{ error }}</div>
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
        <t-form-item>
          <t-input
            v-model="totp"
            placeholder="两步验证码（开启后才需要填）"
            size="large"
            autocomplete="one-time-code"
            inputmode="numeric"
            aria-label="两步验证码"
            :maxlength="6"
            @enter="submit"
          />
        </t-form-item>
        <t-button theme="primary" size="large" block :loading="loading" @click="submit">登录</t-button>
      </t-form>
      <div style="margin-top: 16px; text-align: center; font-size: 13px">
        <a href="/" data-testid="switch-to-student">我是学生</a>
        <span style="margin: 0 8px; color: var(--ink-3)">·</span>
        <a href="/#/pages/privacy-policy/index" data-testid="login-policy">隐私政策</a>
      </div>
      <div v-if="SITE_RECORD.icp || SITE_RECORD.psb" style="margin-top: 12px; text-align: center; font-size: 12px" data-testid="site-record">
        <a v-if="SITE_RECORD.icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ SITE_RECORD.icp }}</a>
        <a v-if="SITE_RECORD.psb" href="https://beian.mps.gov.cn/#/query/webSearch?code=44060602003163" target="_blank" rel="noopener noreferrer" style="margin-left: 8px">{{ SITE_RECORD.psb }}</a>
      </div>
    </div>
  </div>
</template>
