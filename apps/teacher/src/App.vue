<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from './api/client.ts';
import { clearSession, session } from './stores/session.ts';

const route = useRoute();
const router = useRouter();

const isPublic = computed(() => route.meta.public === true || session.me === null);
const dark = ref(document.documentElement.getAttribute('theme-mode') === 'dark');

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

onMounted(() => window.addEventListener('pg:unauthorized', onUnauthorized));
onBeforeUnmount(() => window.removeEventListener('pg:unauthorized', onUnauthorized));

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
      <div class="app-brand">证明陪练场</div>
      <div class="app-brand-sub">教师端</div>
      <nav class="app-nav">
        <router-link class="app-nav-item" to="/classes">我的班级</router-link>
      </nav>
    </aside>
    <div class="app-main">
      <header class="app-header">
        <span class="app-user">{{ session.me?.displayName ?? session.me?.anonCode }}</span>
        <div class="app-actions">
          <t-button variant="text" theme="default" @click="toggleTheme">{{ dark ? '浅色' : '深色' }}</t-button>
          <t-button variant="text" theme="default" @click="logout">退出</t-button>
        </div>
      </header>
      <main class="app-content"><router-view /></main>
    </div>
  </div>
</template>
