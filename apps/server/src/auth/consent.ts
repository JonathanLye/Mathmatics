import type { FastifyRequest } from 'fastify';

import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { requireAuth } from './session.ts';

// 13 §2：同意书改文案必须升版本；旧版本的签署不再满足练习条件，学生需重新确认。
// 文案取自 13 §2 的白话要点与 11 §8 的过程监测说明；PO 确认前不得对外上线。
export const CONSENT_VERSION = 'p0-v1';

export type ConsentKey = 'service' | 'crossBorderHosting' | 'crossBorderModel' | 'monitoring' | 'research';
export type ConsentItems = Record<ConsentKey, boolean>;

export interface ConsentSection {
  key: ConsentKey;
  title: string;
  body: string;
  required: boolean;
}

export const CONSENT_SECTIONS: readonly ConsentSection[] = [
  {
    key: 'service',
    title: '服务所需处理',
    body: '为提供练习功能，需要处理你的学号、作答内容和过程记录。',
    required: true,
  },
  {
    key: 'crossBorderHosting',
    title: '数据存储在中国香港服务器',
    body: '你的数据存储在中国香港的服务器上；国内模型（DeepSeek、通义千问）与识别服务（SimpleTex）在境内。不同意则无法使用本版本。',
    required: true,
  },
  {
    key: 'crossBorderModel',
    title: '境外决策模型（可选）',
    body: '去掉身份信息后的作答文本会发送给境外的 Jev 决策模型，用于判断你写的是哪一步。本版本中它只做对比记录，不同意不影响任何功能。',
    required: false,
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

// 练习前必选的三段：服务所需、香港服务器存储、过程监测。
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

// 作答接口（#19）挂载此守卫：未登录 401；非学生 403；未签当前版本同意书 403 CONSENT_REQUIRED。
export function requireStudentConsent(db: Db) {
  return async (request: FastifyRequest): Promise<void> => {
    const auth = await requireAuth(db, request);
    if (auth.role !== 'student') throw new AppError('FORBIDDEN', 403, '只有学生可以进行练习');
    if (!(await hasValidConsent(db, auth.userId))) {
      throw new AppError('CONSENT_REQUIRED', 403, '请先阅读并签署知情同意书');
    }
  };
}
