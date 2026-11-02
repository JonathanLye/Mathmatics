import type { FastifyPluginAsync } from 'fastify';

import { maskIp, sha256Hex } from '../auth/crypto.ts';
import {
  CONSENT_SECTIONS,
  CONSENT_VERSION,
  latestSignedConsent,
  missingRequiredConsent,
  recordConsent,
  type ConsentItems,
} from '../auth/consent.ts';
import { buildMe } from '../auth/me.ts';
import { requireAuth } from '../auth/session.ts';
import { AppError } from '../errors.ts';

import type { AuthRouteOptions } from './auth.ts';

interface ConsentBody {
  version: string;
  items: ConsentItems;
}

export const consentRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  app.get('/consents', async (request) => {
    const auth = await requireAuth(db, request);
    const doc = {
      version: CONSENT_VERSION,
      sections: CONSENT_SECTIONS,
      signed: await latestSignedConsent(db, auth.userId),
    };
    contract.validate('ConsentDoc', doc);
    return doc;
  });

  app.post('/consents', async (request) => {
    const auth = await requireAuth(db, request);
    if (auth.role !== 'student') throw new AppError('FORBIDDEN', 403, '只有学生需要签署知情同意书');

    contract.validateRequest('/consents', 'post', request.body);
    const body = request.body as ConsentBody;
    if (body.version !== CONSENT_VERSION) {
      throw new AppError('VALIDATION_FAILED', 422, '同意书已更新，请重新阅读后签署', {
        currentVersion: CONSENT_VERSION,
      });
    }
    const missing = missingRequiredConsent(body.items);
    if (missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', 422, '服务所需、香港服务器存储、过程监测为必选，不同意则无法开始练习', {
        missing,
      });
    }

    // 只写入契约定义的五个键：ConsentItems 在契约里未禁止额外键，不能把客户端多余的字段原样存库。
    const items: ConsentItems = {
      service: body.items.service,
      crossBorderHosting: body.items.crossBorderHosting,
      crossBorderModel: body.items.crossBorderModel,
      monitoring: body.items.monitoring,
      research: body.items.research,
    };
    const userAgent = request.headers['user-agent'];
    await recordConsent(db, {
      userId: auth.userId,
      version: body.version,
      items,
      ipMasked: maskIp(request.ip),
      uaHash: userAgent === undefined ? null : sha256Hex(userAgent),
    });

    const me = await buildMe(db, auth);
    contract.validate('Me', me);
    return me;
  });
};
