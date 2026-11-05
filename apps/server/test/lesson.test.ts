import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { loadContract } from '../src/contract.ts';

import { startHelpHarness, type HelpHarness } from './support/help.ts';
import { WRITE_HEADERS } from './support/fixtures.ts';

const contract = loadContract();
let h: HelpHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const lessonUrl = (harness: HelpHarness, conceptId = 'seq-limit', attemptId = harness.attemptId): string =>
  `/api/v1/attempts/${attemptId}/lesson/${conceptId}`;
const get = (harness: HelpHarness, url: string) => harness.app.inject({ method: 'GET', url, headers: { cookie: harness.cookie } });
const check = (harness: HelpHarness, stepId: string, choice: number, conceptId = 'seq-limit') =>
  harness.app.inject({
    method: 'POST',
    url: `${lessonUrl(harness, conceptId)}/check`,
    headers: { cookie: harness.cookie, ...WRITE_HEADERS },
    payload: { stepId, choice },
  });

describe('GET /attempts/{id}/lesson/{conceptId}（06 §4.4）', () => {
  it('下发预写微课：卡片 + 分步讲解 + 图解；小核验只有题干与选项，不下发 answer / right / wrong', async () => {
    h = await startHelpHarness('epsN');
    const res = await get(h, lessonUrl(h));
    expect(res.statusCode, res.body).toBe(200);
    const lesson = res.json();
    contract.validate('LessonView', lesson);
    expect(lesson).toMatchObject({ conceptId: 'seq-limit', title: '数列极限（ε-N）', generated: null, currentStepId: 's1' });
    expect(lesson.steps.map((s: { id: string }) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(lesson.steps[0].visual.type).toBe('seq-band');
    expect(lesson.steps[0].check).toEqual({ q: expect.any(String), options: ['变大或不变', '变小'] });
    expect(lesson.steps[4].check).toBeUndefined();
    expect(JSON.stringify(lesson)).not.toMatch(/"answer"|"right"|"wrong"/);
  });

  it('不存在的概念 404；别人的作答 404；未登录 401', async () => {
    h = await startHelpHarness('epsN');
    expect((await get(h, lessonUrl(h, 'no-such-concept'))).statusCode).toBe(404);
    expect((await get(h, lessonUrl(h, '../x'))).statusCode).toBe(404);
    expect((await get(h, lessonUrl(h, 'seq-limit', randomUUID()))).statusCode).toBe(404);
    const anon = await h.app.inject({ method: 'GET', url: lessonUrl(h) });
    expect(anon.statusCode).toBe(401);
  });

  it('闸门：词条里带未透露 key 的片段，学生只看到回退文案', async () => {
    h = await startHelpHarness('epsN');
    const secret = (await h.db.query<{ secret: { keys: Array<{ leak: string[] }> } }>(`select secret from vault.problem_secrets where problem_id = 'epsN'`)).rows[0]?.secret;
    const fragment = secret?.keys.find((k) => k.leak.length > 0)?.leak[0] as string;
    const original = (await h.db.query<{ body: Record<string, any> }>(`select body from content.concepts where id = 'seq-limit'`)).rows[0]?.body as Record<string, any>;
    const bad = { ...original, lesson: { steps: original.lesson.steps.map((s: Record<string, any>, i: number) => (i === 1 ? { ...s, text: `示例 ${fragment}` } : s)) } };
    await h.db.query(`alter table content.concepts disable trigger user`);
    await h.db.query(`update content.concepts set body = $1::jsonb where id = 'seq-limit'`, [JSON.stringify(bad)]);
    try {
      const lesson = (await get(h, lessonUrl(h))).json();
      expect(lesson.steps[1].text).toContain('我先不展开');
      expect(JSON.stringify(lesson)).not.toContain(fragment);
      expect(lesson.steps[0].text).toBe(original.lesson.steps[0].text);
    } finally {
      await h.db.query(`update content.concepts set body = $1::jsonb where id = 'seq-limit'`, [JSON.stringify(original)]);
      await h.db.query(`alter table content.concepts enable trigger user`);
    }
  });
});

describe('POST /attempts/{id}/lesson/{conceptId}/check', () => {
  it('答对：correct=true，feedback 以"对。"开头，nextStepId 指向下一步，并带最新 AttemptState', async () => {
    h = await startHelpHarness('epsN');
    const res = await check(h, 's1', 0);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ correct: true, nextStepId: 's2' });
    expect(body.feedback.startsWith('对。')).toBe(true);
    contract.validate('AttemptState', body.state);
  });

  it('答错：correct=false，给引导，nextStepId 留在本步，可重试', async () => {
    h = await startHelpHarness('epsN');
    const body = (await check(h, 's2', 1)).json();
    expect(body).toMatchObject({ correct: false, nextStepId: 's2' });
    expect(body.feedback.length).toBeGreaterThan(0);
    expect((await check(h, 's2', 0)).json()).toMatchObject({ correct: true, nextStepId: 's3' });
  });

  it('拒绝：没有核验的步骤 422、选项越界 422、不存在的步骤 422、坏请求体 422', async () => {
    h = await startHelpHarness('epsN');
    expect((await check(h, 's5', 0)).statusCode).toBe(422);
    expect((await check(h, 's1', 9)).statusCode).toBe(422);
    expect((await check(h, 'nope', 0)).statusCode).toBe(422);
    const bad = await h.app.inject({
      method: 'POST',
      url: `${lessonUrl(h)}/check`,
      headers: { cookie: h.cookie, ...WRITE_HEADERS },
      payload: { stepId: 's1' },
    });
    expect(bad.statusCode).toBe(422);
  });
});
