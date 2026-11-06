<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from './api/client.ts';
import { clearSession, session } from './stores/session.ts';
import Icon from './components/ui/Icon.vue';
import { applyTheme, saveTheme, type ThemeName } from './utils/theme.ts';

const route = useRoute();
const router = useRouter();

const isPublic = computed(() => route.meta.public === true || session.me === null);
// 初始主题已在 main.ts 里按“上次选择 > 系统偏好”设置到 <html> 上，这里只读它，不再另起一个来源。
const dark = ref(document.documentElement.getAttribute('data-theme') === 'dark');
// 离线时给出提示：用 navigator.onLine + online/offline 事件，手机上可只读查看。
const online = ref(navigator.onLine);

function markOnline(): void {
  online.value = true;
}
function markOffline(): void {
  online.value = false;
}

function toggleTheme(): void {
  dark.value = !dark.value;
  const theme: ThemeName = dark.value ? 'dark' : 'light';
  applyTheme(theme); // theme-mode 给 TDesign，data-theme 给共用 token，两边一起切
  saveTheme(theme);
}

function onUnauthorized(): void {
  clearSession();
  if (route.meta.public !== true) {
    void router.push({ name: 'login', query: { redirect: route.fullPath } });
  }
}

onMounted(() => {
  window.addEventListener('pg:unauthorized', onUnauthorized);
  window.addEventListener('online', markOnline);
  window.addEventListener('offline', markOffline);
});
onBeforeUnmount(() => {
  window.removeEventListener('pg:unauthorized', onUnauthorized);
  window.removeEventListener('online', markOnline);
  window.removeEventListener('offline', markOffline);
});

async function logout(): Promise<void> {
  try {
    await api.post('/api/v1/auth/logout');
  } catch {
    // 会话已失效时也允许前端退出
  }
  clearSession();
  await router.push('/login');
}
</script>

<template>
  <router-view v-if="isPublic" />
  <div v-else class="app-shell">
    <aside class="app-aside">
      <div class="app-brandrow">
        <span class="app-logo"><Icon name="qed" :size="18" color="currentColor" /></span>
        <div><div class="app-brand">证明陪练场</div><span class="app-brand-sub">教师端</span></div>
      </div>
      <nav class="app-nav" aria-label="主导航">
        <router-link class="app-nav-item" to="/classes"><Icon name="home" :size="20" />我的班级</router-link>
        <router-link class="app-nav-item" to="/problems"><Icon name="book" :size="20" />题库</router-link>
        <router-link class="app-nav-item" to="/settings"><Icon name="me" :size="20" />设置</router-link>
      </nav>
      <div class="app-me">
        <span class="pg-avatar" style="width: 30px; height: 30px; font-size: 13px">{{ (session.me?.displayName ?? '师').slice(0, 1) }}</span>
        <span>{{ session.me?.displayName ?? '老师' }}</span>
      </div>
    </aside>
    <div class="app-main">
      <header class="app-header">
        <div class="app-header__left">
          <span class="app-header__brand"><span class="app-logo"><Icon name="qed" :size="18" color="currentColor" /></span>证明陪练场</span>
          <span class="app-header__tag" data-testid="app-role-tag">教师端</span>
          <span class="app-user">{{ session.me?.displayName ?? '老师' }}</span>
        </div>
        <div class="app-actions">
          <t-button variant="text" theme="default" size="small" @click="toggleTheme">{{ dark ? '浅色' : '深色' }}</t-button>
          <t-button variant="text" theme="default" size="small" @click="logout">退出</t-button>
        </div>
      </header>
      <nav class="app-mobilenav" aria-label="主导航（手机）">
        <router-link class="app-nav-item" to="/classes">我的班级</router-link>
        <router-link class="app-nav-item" to="/problems">题库</router-link>
        <router-link class="app-nav-item" to="/settings">设置</router-link>
      </nav>
      <t-alert
        v-if="!online"
        theme="warning"
        message="网络已断开：当前数据可能不是最新；恢复连接后会自动继续刷新。"
        class="offline-banner"
      />
      <main class="app-content"><router-view /></main>
    </div>
  </div>
</template>
