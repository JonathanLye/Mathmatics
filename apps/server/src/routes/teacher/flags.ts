import type { FastifyPluginAsync } from 'fastify';

import { requireTeacher, uuidParam } from '../../services/teacher/auth.ts';
import { ensureUuid, resolveFlag, type ResolveFlagInput } from '../../services/teacher/interventions.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface FlagIdParams {
  flagId: string;
}

export const teacherFlagRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  // 04 §6：处理求助标记或诚信信号；dismissed / noted / talked，只记录不处罚。
  app.post('/teacher/flags/:flagId/resolve', async (request, reply) => {
    const auth = await requireTeacher(db, request);
    const flagId = uuidParam((request.params as FlagIdParams).flagId, '标记');
    ensureUuid(flagId);
    if (request.body !== undefined) {
      contract.validateRequest('/teacher/flags/{flagId}/resolve', 'post', request.body);
    }
    await resolveFlag(db, auth, flagId, (request.body ?? {}) as ResolveFlagInput);
    return reply.status(204).send();
  });
};
