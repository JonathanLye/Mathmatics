import { createRouter, createWebHistory } from 'vue-router';

import { loadSession, session } from './stores/session.ts';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/classes' },
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/classes', name: 'classes', component: () => import('./pages/ClassesPage.vue') },
    { path: '/classes/:classId', name: 'class-detail', component: () => import('./pages/ClassDetailPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/classes' },
  ],
});

// 04 §1：教师端页面都需要教师会话；学生/管理员走同一登录页（管理员接口后续再细化）。
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  if (!session.loaded) await loadSession();
  if (!session.me) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (session.me.role !== 'teacher' && session.me.role !== 'admin') {
    return { name: 'login' };
  }
  return true;
});
