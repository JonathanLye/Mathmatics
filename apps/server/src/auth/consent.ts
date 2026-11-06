import type { FastifyRequest } from 'fastify';

import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { getAgeBand } from './age-band.ts';
import { requireStudent } from './session.ts';

// 13 §2：同意书改文案必须升版本；旧版本的签署不再满足练习条件，学生需重新确认。
// 文案取自 13 §2 的白话要点与 11 §8 的过程监测说明；PO 确认前不得对外上线。
// v2（U15）：求助内容与证明行会去标识后发给通义千问 / DeepSeek 生成回答。升版本后所有人重签一次。
export const CONSENT_VERSION = 'v2';

export type ConsentKey = 'service' | 'crossBorderHosting' | 'crossBorderModel' | 'monitoring' | 'research';
export type ConsentItems = Record<ConsentKey, boolean>;

// guardianNotice 只展示、不签署（14–17 岁的附加提示，13 §4）。
export type ConsentSectionKey = ConsentKey | 'guardianNotice';

export interface ConsentSection {
  key: ConsentSectionKey;
  title: string;
  body: string;
  required: boolean;
}

// 13 §4：14–17 岁可用，同意书附加一句「建议告知监护人」；非必选、不进入 ConsentItems。
export const GUARDIAN_NOTICE_SECTION: ConsentSection = {
  key: 'guardianNotice',
  title: '建议告知监护人',
  body: '你未满 18 岁：建议把使用本服务的事告诉家长或监护人，一起看看《隐私政策》。不同意本段不影响使用。',
  required: false,
};

// 键名 crossBorderHosting 是历史名字（早期部署在香港），存量数据和契约都在用，不改；内容已是境内的模型和识别服务（13 §2、U22）。
// crossBorderModel（境外决策模型）不再向学生展示，也不再记为同意：系统不向境外发送数据（U22）。
export const CONSENT_SECTIONS: readonly ConsentSection[] = [
  {
    key: 'service',
    title: '服务所需处理',
    body: '为提供练习功能，需要处理你的学号、姓名（老师导入名单时提供）、年龄段、作答内容（含手写笔迹和照片）、过程记录和登录设备信息。这些数据存储在中国境内的服务器上，按《隐私政策》写明的期限保存，到期删除或匿名化。',
    required: true,
  },
  {
    key: 'crossBorderHosting',
    title: 'AI 模型和识别服务',
    body: '你在求助里写的内容、你写的定义和证明行，会去掉身份信息后发给 DeepSeek 或通义千问，用来生成回答和判断你写的是哪一步；手写笔迹和拍的照片会发给 SimpleTex 或通义千问识别成文字和公式（请不要拍到姓名、学号）。这些服务都在中国境内，只用于完成上述功能。AI 生成的文字都会标注“AI 生成”。不同意则无法使用本版本。',
    required: true,
  },
  {
    key: 'monitoring',
    title: '过程监测',
    body: '为了让老师了解你的练习过程，系统会记录：你写下的每一行（包括手写笔迹、识别和修改）、你什么时候求助、看了哪些提示、在每一层停留多久，以及你离开页面的次数和时长。老师可以查看你的作答过程。这些记录只用于教学和（在你同意的情况下）匿名的教学研究，不用于评分处罚。测验模式下，离开页面过多会锁定本题，需要老师解锁。',
    required: true,
  },
  {
    key: 'research',
    title: '教研使用（可选）',
    body: '匿名化后用于教学研究与论文；不同意不影响使用。撤回后，你的数据会从研究导出中排除。',
    required: false,
  },
];

// 练习前必选的三段：服务所需、AI 模型和识别服务、过程监测。
export const REQUIRED_CONSENT_KEYS = ['service', 'crossBorderHosting', 'monitoring'] as const;

export function missingRequiredConsent(items: Partial<Record<ConsentKey, boolean>>): ConsentKey[] {
  return REQUIRED_CONSENT_KEYS.filter((key) => items[key] !== true);
}

export async function hasValidConsent(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query<{ items: Partial<Record<ConsentKey, boolean>> }>(
    `select items
       from app.consents
      where user_id = $1 and version = $2 and revoked_at is null
      order by created_at desc
      limit 1`,
    [userId, CONSENT_VERSION],
  );
  const row = result.rows[0];
  return row !== undefined && missingRequiredConsent(row.items).length === 0;
}

export interface SignedConsentView {
  version: string;
  items: ConsentItems;
  signedAt: string;
}

// 本人最近一次有效签署（任何版本），用于 GET /consents 的 signed 字段。
export async function latestSignedConsent(db: Queryable, userId: string): Promise<SignedConsentView | null> {
  const result = await db.query<{ version: string; items: ConsentItems; created_at: Date }>(
    `select version, items, created_at
       from app.consents
      where user_id = $1 and revoked_at is null
      order by created_at desc
      limit 1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? { version: row.version, items: row.items, signedAt: new Date(row.created_at).toISOString() } : null;
}

export interface RecordConsentInput {
  userId: string;
  version: string;
  items: ConsentItems;
  ipMasked: string | null;
  uaHash: string | null;
}

export async function recordConsent(db: Queryable, input: RecordConsentInput): Promise<void> {
  await db.query(
    `insert into app.consents (user_id, version, items, ip_masked, ua_hash)
     values ($1, $2, $3::jsonb, $4, $5)`,
    [input.userId, input.version, JSON.stringify(input.items), input.ipMasked, input.uaHash],
  );
}

// 作答接口（#19）挂载此守卫：未登录 401；非学生（含只登录了教师端）403；未选择年龄段 409；<14 岁 403；未签当前版本同意书 403 CONSENT_REQUIRED。
export function requireStudentConsent(db: Db) {
  return async (request: FastifyRequest): Promise<void> => {
    const auth = await requireStudent(db, request);
    // 13 §4：年龄分档先于同意书（14–17 的同意书多一段「建议告知监护人」；<14 不开通）。
    const ageBand = await getAgeBand(db, auth.userId);
    if (ageBand === null) throw new AppError('AGE_BAND_REQUIRED', 409, '请先选择年龄段');
    if (ageBand === 'lt14') throw new AppError('AGE_RESTRICTED', 403, '本服务暂未向 14 岁以下学生开放');
    if (!(await hasValidConsent(db, auth.userId))) {
      throw new AppError('CONSENT_REQUIRED', 403, '请先阅读并签署知情同意书');
    }
  };
}
