<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from './api/client.ts';
import { clearSession, session } from './stores/session.ts';
import Icon from './components/ui/Icon.vue';
import Mascot from './components/ui/Mascot.vue';

const route = useRoute();
const router = useRouter();

const isPublic = computed(() => route.meta.public === true || session.me === null);
const dark = ref(document.documentElement.getAttribute('theme-mode') === 'dark');
// 12 §5：加载/空/错误/离线四态。离线用 navigator.onLine + online/offline 事件（04 开头：手机可只读查看）。
const online = ref(navigator.onLine);

function markOnline(): void {
  online.value = true;
}
function markOffline(): void {
  online.value = false;
}

function toggleTheme(): void {
  dark.value = !dark.value;
  if (dark.value) document.documentElement.setAttribute('theme-mode', 'dark');
  else document.documentElement.removeAttribute('theme-mode');
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
        <Mascot expr="idle" :size="40" />
        <div><div class="app-brand">证明陪练场</div><div class="app-brand-sub">教师端</div></div>
      </div>
      <nav class="app-nav">
        <router-link class="app-nav-item" to="/classes"><Icon name="flash" :size="26" />我的班级</router-link>
        <router-link class="app-nav-item" to="/problems"><Icon name="flag" :size="26" />题库审核</router-link>
        <router-link class="app-nav-item" to="/settings"><Icon name="me" :size="26" />设置</router-link>
      </nav>
      <div class="app-me">
        <span class="pg-avatar" style="width: 34px; height: 34px; background: var(--pg-sea); font-size: 14px">{{ (session.me?.displayName ?? session.me?.anonCode ?? '师').slice(0, 1) }}</span>
        <span>{{ session.me?.displayName ?? session.me?.anonCode }}</span>
      </div>
    </aside>
    <div class="app-main">
      <header class="app-header">
        <span class="app-user">{{ session.me?.displayName ?? session.me?.anonCode }}</span>
        <div class="app-actions">
          <t-button variant="text" theme="default" @click="toggleTheme">{{ dark ? '浅色' : '深色' }}</t-button>
          <t-button variant="text" theme="default" @click="logout">退出</t-button>
        </div>
      </header>
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
