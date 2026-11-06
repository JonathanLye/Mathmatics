import type { FastifyPluginAsync } from 'fastify';

import { maskIp, sha256Hex } from '../auth/crypto.ts';
import { getAgeBand } from '../auth/age-band.ts';
import {
  CONSENT_SECTIONS,
  CONSENT_VERSION,
  GUARDIAN_NOTICE_SECTION,
  latestSignedConsent,
  missingRequiredConsent,
  recordConsent,
  type ConsentItems,
} from '../auth/consent.ts';
import { buildMe } from '../auth/me.ts';
import { requireStudent } from '../auth/session.ts';
import { AppError } from '../errors.ts';

import type { AuthRouteOptions } from './auth.ts';

interface ConsentBody {
  version: string;
  items: ConsentItems;
}

export const consentRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  app.get('/consents', async (request) => {
    const auth = await requireStudent(db, request);
    // 13 §4：14–17 岁的同意书多一段「建议告知监护人」（非必选、不签署）。
    const ageBand = await getAgeBand(db, auth.userId);
    const sections = ageBand === '14to17' ? [...CONSENT_SECTIONS, GUARDIAN_NOTICE_SECTION] : CONSENT_SECTIONS;
    const doc = {
      version: CONSENT_VERSION,
      sections,
      signed: await latestSignedConsent(db, auth.userId),
    };
    contract.validate('ConsentDoc', doc);
    return doc;
  });

  app.post('/consents', async (request) => {
    const auth = await requireStudent(db, request);
    // 13 §4：先分档再签同意书（14–17 的文本多一段；<14 不产生同意书与任何签署记录）。
    const ageBand = await getAgeBand(db, auth.userId);
    if (ageBand === null) throw new AppError('AGE_BAND_REQUIRED', 409, '请先选择年龄段');
    if (ageBand === 'lt14') throw new AppError('AGE_RESTRICTED', 403, '本服务暂未向 14 岁以下学生开放');

    contract.validateRequest('/consents', 'post', request.body);
    const body = request.body as ConsentBody;
    if (body.version !== CONSENT_VERSION) {
      throw new AppError('VALIDATION_FAILED', 422, '同意书已更新，请重新阅读后签署', {
        currentVersion: CONSENT_VERSION,
      });
    }
    const missing = missingRequiredConsent(body.items);
    if (missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', 422, '服务所需、AI 模型和识别服务、过程监测为必选，不同意则无法开始练习', {
        missing,
      });
    }

    // 只写入契约定义的五个键：ConsentItems 在契约里未禁止额外键，不能把客户端多余的字段原样存库。
    const items: ConsentItems = {
      service: body.items.service,
      crossBorderHosting: body.items.crossBorderHosting,
      // 系统不向境外发送数据（U22）：不管客户端传什么都记为不同意，模型网关据此跳过境外 provider。
      crossBorderModel: false,
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
