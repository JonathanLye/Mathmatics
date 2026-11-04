import type { FastifyPluginAsync } from 'fastify';

import type { AuthRouteOptions } from '../auth.ts';

import { teacherAssignmentRoutes } from './assignments.ts';
import { teacherAttemptRoutes } from './attempts.ts';
import { teacherClassRoutes } from './classes.ts';
import { teacherFlagRoutes } from './flags.ts';
import { teacherLiveRoutes } from './live.ts';
import { teacherProblemRoutes } from './problems.ts';

// /teacher/* 的插件根：注册 text/csv 解析器（Fastify 默认不解析，且作用域只在本插件内），再挂子路由。
// 契约（openapi.yaml）把 roster 请求体定义为 text/csv 字符串；这里按 buffer 收，方便在 service 里做 UTF-8/GBK 探测。
export const teacherRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  app.addContentTypeParser('text/csv', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(teacherClassRoutes, options);
  await app.register(teacherAssignmentRoutes, options);
  await app.register(teacherLiveRoutes, options);
  await app.register(teacherAttemptRoutes, options);
  await app.register(teacherFlagRoutes, options);
  await app.register(teacherProblemRoutes, options);
};
