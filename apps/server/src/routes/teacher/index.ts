import type { FastifyPluginAsync } from 'fastify';

import type { AuthRouteOptions } from '../auth.ts';

import { teacherAssignmentRoutes } from './assignments.ts';
import { teacherClassRoutes } from './classes.ts';

// /teacher/* 的插件根：注册 text/csv 解析器（Fastify 默认不解析，且作用域只在本插件内），再挂子路由。
// 契约（openapi.yaml）把 roster 请求体定义为 text/csv 字符串；这里按 buffer 收，方便在 service 里做 UTF-8/GBK 探测。
export const teacherRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  app.addContentTypeParser('text/csv', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(teacherClassRoutes, options);
  await app.register(teacherAssignmentRoutes, options);
};
