import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../errors.ts';

import { attemptRoutes } from './attempts.ts';
import { eventRoutes } from './events.ts';
import { authRoutes, type AuthRouteOptions } from './auth.ts';
import { consentRoutes } from './consents.ts';
import { teacherRoutes } from './teacher/index.ts';

// 06 §1 / 05 §7：写接口必须带 X-Requested-With: proof-gym。跨站表单无法加自定义头，
// 与 SameSite=Lax 一起挡住 CSRF；登录接口同样要求，防止登录 CSRF。
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'proof-gym';

export const apiRoutes: FastifyPluginAsync<AuthRouteOptions> = async (api, { db, config, contract }) => {
  api.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new AppError('FORBIDDEN', 403, '缺少 X-Requested-With 请求头');
    }
  });

  // 不能整体转发 options：Fastify 会把 prefix 也带进插件选项，导致前缀重复。
  await api.register(authRoutes, { db, config, contract });
  await api.register(consentRoutes, { db, config, contract });
  await api.register(attemptRoutes, { db, config, contract });
  await api.register(eventRoutes, { db, config, contract });
  // C：教师端接口（/teacher/*）。本文件属 B，新增这一行注册需要 B 评审。
  await api.register(teacherRoutes, { db, config, contract });
};
