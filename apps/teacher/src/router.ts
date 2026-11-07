import { createRouter, createWebHistory } from 'vue-router';

import { loadSession, session } from './stores/session.ts';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/classes' },
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/classes', name: 'classes', component: () => import('./pages/ClassesPage.vue') },
    { path: '/classes/:classId', name: 'class-detail', component: () => import('./pages/ClassDetailPage.vue') },
    { path: '/problems', name: 'problems', component: () => import('./pages/ProblemsPage.vue') },
    // 反馈收件箱只给开发者（admin 角色）；普通教师没有入口，直接访问也会被送回班级页。
    { path: '/feedback', name: 'feedback', component: () => import('./pages/FeedbackPage.vue'), meta: { adminOnly: true } },
    { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/classes' },
  ],
});

// 教师端页面都需要教师会话；学生账号进来会被送回登录页。
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  if (!session.loaded) await loadSession();
  if (!session.me) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (session.me.role !== 'teacher' && session.me.role !== 'admin') {
    return { name: 'login' };
  }
  if (to.meta.adminOnly === true && session.me.role !== 'admin') {
    return { name: 'classes' };
  }
  return true;
});
