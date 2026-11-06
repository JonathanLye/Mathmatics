import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.ts';
import { assertConfirmedInput } from '../src/recognition/provenance.ts';

import { startHelpHarness, type HelpHarness } from './support/help.ts';
import { WRITE_HEADERS } from './support/fixtures.ts';

const KEYED = loadConfig({
  NODE_ENV: 'test',
  SIMPLETEX_APP_ID: 'test-app',
  SIMPLETEX_APP_SECRET: 'test-secret-value',
  DASHSCOPE_API_KEY: 'test-dashscope-key',
});

// 学生手写内容的标记：任何 model_calls / 日志里都不应出现识别出的原文
const STUDENT_TEXT = '\\text{任取}\\varepsilon>0';

interface Script {
  simple?: { latex: string; conf: number } | 'fail' | 'slow';
  std?: { latex: string; conf: number };
  qwen?: string | 'fail';
  // simpletex_ocr（整页 document 模式）返回的 Markdown
  page?: string | 'fail';
}

function scriptedFetch(script: Script): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (url.includes('simpletex_ocr')) {
      if (script.page === 'fail' || script.page === undefined) return json({ status: false }, 500);
      return json({ status: true, res: { content: script.page } });
    }
    if (url.includes('latex_ocr_turbo')) {
      if (script.simple === 'fail' || script.simple === undefined) return json({ status: false }, 500);
      if (script.simple === 'slow') return new Promise<Response>(() => undefined);
      return json({ status: true, res: { latex: script.simple.latex, conf: script.simple.conf } });
    }
    if (url.endsWith('/api/latex_ocr')) {
      if (!script.std) return json({ status: false }, 500);
      return json({ status: true, res: { latex: script.std.latex, conf: script.std.conf } });
    }
    if (url.includes('chat/completions')) {
      if (script.qwen === 'fail' || script.qwen === undefined) return json({ error: 'x' }, 500);
      return json({ choices: [{ message: { content: script.qwen } }] });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function inkBase64(opts: { erased?: boolean } = {}): string {
  const doc = {
    v: 1,
    w: 360,
    h: 120,
    dpr: 2,
    t0: 0,
    orientation: 'portrait',
    fullscreen: false,
    strokes: [
      { id: 0, p: 'pen', pts: [[10, 40, 0, 0.5], [60, 44, 20, 0.5], [120, 40, 40, 0.5]] },
      { id: 1, p: 'pen', pts: [[20, 70, 100, 0.5], [90, 72, 120, 0.5]] },
    ],
    ...(opts.erased ? { ops: [{ op: 'erase', ids: [0, 1], t: 500 }] } : {}),
  };
  return gzipSync(Buffer.from(JSON.stringify(doc))).toString('base64');
}

let h: HelpHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function start(script: Script, config: Parameters<typeof startHelpHarness>[1] = {}) {
  const fetched = scriptedFetch(script);
  h = await startHelpHarness('epsN', { config: { models: KEYED.models, ...config.config }, fetchImpl: fetched.fetchImpl });
  return { h, ...fetched };
}

function recognize(harness: HelpHarness, ink = inkBase64(), attemptId = harness.attemptId) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/recognitions/ink',
    headers: { cookie: harness.cookie, ...WRITE_HEADERS },
    payload: { attemptId, draftId: randomUUID(), target: 'line_statement', ink },
  });
}

function confirm(harness: HelpHarness, recogId: string, text: string, lines?: string[]) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/v1/recognitions/${recogId}/confirm`,
    headers: { cookie: harness.cookie, ...WRITE_HEADERS },
    payload: lines ? { text, lines } : { text },
  });
}

async function eventsOf(harness: HelpHarness, type: string) {
  return (
    await harness.db.query<{ seq: number | string; payload: Record<string, unknown> }>(
      `select seq, payload from ev.events where attempt_id = $1 and type = $2 order by seq`,
      [harness.attemptId, type],
    )
  ).rows;
}

describe('POST /recognitions/ink', () => {
  it('两路一致：agree=true，text 为 MathText；落库、写事件、model_calls 不含识别原文', async () => {
    const { h: harness, calls } = await start({
      simple: { latex: STUDENT_TEXT, conf: 0.95 },
      qwen: '任取 $\\varepsilon>0$',
    });
    const res = await recognize(harness);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', text: '任取 $\\varepsilon>0$', agree: true, diff: [], confidence: 0.95 });
    expect(calls.some((u) => u.includes('latex_ocr_turbo'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/api/latex_ocr'))).toBe(false); // conf ≥ 0.7，不调标准接口

    const rec = (await harness.db.query(`select * from app.recognitions where id = $1`, [body.recogId])).rows[0] as Record<string, unknown>;
    expect(rec).toMatchObject({ kind: 'ink', provider: 'simpletex', status: 'ok', agree: true, cross_provider: 'qwen3.8-flash' });
    expect(rec.ink_id).not.toBeNull();
    const ink = (await harness.db.query(`select stroke_count, point_count from app.ink_captures where id = $1`, [rec.ink_id])).rows[0];
    expect(ink).toMatchObject({ stroke_count: 2, point_count: 5 });

    const request = await eventsOf(harness, 'recog.request');
    const result = await eventsOf(harness, 'recog.result');
    expect(request).toHaveLength(1);
    expect(result[0]?.payload).toMatchObject({ recogId: body.recogId, provider: 'simpletex', agree: true, status: 'ok' });
    expect(Number(result[0]?.seq)).toBeGreaterThan(Number(request[0]?.seq));

    const calls2 = (await harness.db.query<{ output: unknown; input_hash: string }>(`select output, input_hash from app.model_calls`)).rows;
    expect(calls2.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(calls2)).not.toContain('varepsilon');
    expect(JSON.stringify(calls2)).not.toContain('test-secret-value');
  });

  it('两路不一致：agree=false，diff 指向主结果里的差异处', async () => {
    const { h: harness } = await start({
      simple: { latex: '|a_n-3|=\\frac{5}{n+2}', conf: 0.9 },
      qwen: '$|a_n-3|=\\frac{5}{n+z}$',
    });
    const body = (await recognize(harness)).json();
    expect(body.agree).toBe(false);
    expect(body.text).toBe('$|a_n-3|=\\frac{5}{n+2}$');
    expect(body.diff).toEqual([{ start: 9, end: 22, alt: '\\frac{5}{n+z}' }]);
  });

  it('SimpleTex 置信度 < 0.7：再调标准接口，取置信度高的', async () => {
    const { h: harness, calls } = await start({
      simple: { latex: 'x=l', conf: 0.5 },
      std: { latex: 'x=1', conf: 0.92 },
      qwen: '$x=1$',
    });
    const body = (await recognize(harness)).json();
    expect(calls.some((u) => u.endsWith('/api/latex_ocr'))).toBe(true);
    expect(body).toMatchObject({ text: '$x=1$', confidence: 0.92, agree: true });
  });

  it('SimpleTex 失败：Qwen 当主识别，agree=null', async () => {
    const { h: harness } = await start({ simple: 'fail', qwen: '$x=1$' });
    const res = await recognize(harness);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', text: '$x=1$', agree: null });
    const rec = (await harness.db.query(`select provider, cross_provider from app.recognitions`)).rows[0];
    expect(rec).toMatchObject({ provider: 'qwen3.8-flash', cross_provider: null });
  });

  it('Qwen 失败：只有主识别，agree=null', async () => {
    const { h: harness } = await start({ simple: { latex: 'x=1', conf: 0.9 }, qwen: 'fail' });
    expect((await recognize(harness)).json()).toMatchObject({ status: 'ok', text: '$x=1$', agree: null });
  });

  it('两路都失败：503 UPSTREAM_UNAVAILABLE，识别记录和事件仍然写入', async () => {
    const { h: harness } = await start({ simple: 'fail', qwen: 'fail' });
    const res = await recognize(harness);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect((await harness.db.query(`select status from app.recognitions`)).rows[0]).toMatchObject({ status: 'error' });
    expect((await eventsOf(harness, 'recog.result'))[0]?.payload).toMatchObject({ status: 'error' });
  });

  it('没配置密钥时同样是 503，键盘路径不受影响', async () => {
    h = await startHelpHarness('epsN');
    const res = await recognize(h);
    expect(res.statusCode).toBe(503);
  });

  it('笔画全被擦掉：status=empty，不调用任何识别服务', async () => {
    const { h: harness, calls } = await start({ simple: { latex: 'x', conf: 1 }, qwen: 'x' });
    const res = await recognize(harness, inkBase64({ erased: true }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'empty', text: '', agree: null });
    expect(calls).toEqual([]);
    // 原始笔迹仍然保存（研究数据只多不少）
    expect((await harness.db.query(`select count(*) as n from app.ink_captures`)).rows[0]).toMatchObject({ n: 1 });
  });

  it('每生每日上限：超过返回 429 RATE_LIMITED', async () => {
    const { h: harness } = await start(
      { simple: { latex: 'x=1', conf: 0.9 }, qwen: '$x=1$' },
      { config: { recognition: { ...KEYED.recognition, inkPerDay: 2 } } },
    );
    expect((await recognize(harness)).statusCode).toBe(200);
    expect((await recognize(harness)).statusCode).toBe(200);
    const third = await recognize(harness);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
  });

  it('别人的作答 / 不存在的作答：404；笔迹数据无效：422；声明过大：413', async () => {
    const { h: harness } = await start({ simple: { latex: 'x', conf: 1 }, qwen: 'x' });
    expect((await recognize(harness, inkBase64(), randomUUID())).statusCode).toBe(404);
    const bad = await recognize(harness, Buffer.from('nope').toString('base64'));
    expect(bad.statusCode).toBe(422);
    const big = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/recognitions/ink',
      headers: { cookie: harness.cookie, ...WRITE_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ attemptId: harness.attemptId, draftId: randomUUID(), target: 'line_statement', ink: 'A'.repeat(300 * 1024) }),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('未登录 401', async () => {
    const { h: harness } = await start({});
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/recognitions/ink',
      headers: WRITE_HEADERS,
      payload: { attemptId: harness.attemptId, draftId: randomUUID(), target: 'line_statement', ink: inkBase64() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('作答被锁定后不能再识别（409 ATTEMPT_LOCKED）', async () => {
    const { h: harness } = await start({ simple: { latex: 'x', conf: 1 }, qwen: 'x' });
    await harness.db.query(`update app.attempts set status = 'locked' where id = $1`, [harness.attemptId]);
    const res = await recognize(harness);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ATTEMPT_LOCKED');
  });
});

describe('POST /recognitions/{id}/confirm 与提交来源核对', () => {
  async function recognized(harness: HelpHarness) {
    const body = (await recognize(harness)).json();
    return body.recogId as string;
  }
  function submitDefinition(harness: HelpHarness, text: string, input: Record<string, unknown>) {
    return harness.app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${harness.attemptId}/definition`,
      headers: { cookie: harness.cookie, ...WRITE_HEADERS },
      payload: { text, input: { draftId: randomUUID(), ...input } },
    });
  }

  it('确认：记录 edited 与编辑距离，写 recog.confirm；改过的文字 edited=true', async () => {
    const { h: harness } = await start({ simple: { latex: 'x=l', conf: 0.9 }, qwen: '$x=l$' });
    const recogId = await recognized(harness);
    const res = await confirm(harness, recogId, '$x=1$');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ recogId, edited: true });
    const row = (await harness.db.query(`select confirmed_text, edited, edit_distance, confirmed_at from app.recognitions where id = $1`, [recogId])).rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({ confirmed_text: '$x=1$', edited: true, edit_distance: 1 });
    expect(row.confirmed_at).not.toBeNull();
    expect((await eventsOf(harness, 'recog.confirm'))[0]?.payload).toEqual({ recogId, edited: true, editDistance: 1 });
  });

  it('确认：原样确认 edited=false；别人的 / 不存在的 recogId 404；空结果不能确认 422', async () => {
    const { h: harness } = await start({ simple: { latex: 'x=1', conf: 0.9 }, qwen: '$x=1$' });
    const recogId = await recognized(harness);
    expect((await confirm(harness, recogId, '$x=1$')).json().edited).toBe(false);
    expect((await confirm(harness, randomUUID(), '$x$')).statusCode).toBe(404);
    expect((await confirm(harness, 'not-a-uuid', '$x$')).statusCode).toBe(404);

    const empty = (await recognize(harness, inkBase64({ erased: true }))).json();
    expect((await confirm(harness, empty.recogId, '$x$')).statusCode).toBe(422);
  });

  it('手写来源的提交：没有 recogId / 未确认 / 别人的 → 409 RECOG_NOT_CONFIRMED', async () => {
    const { h: harness } = await start({ simple: { latex: 'x=1', conf: 0.9 }, qwen: '$x=1$' });
    const recogId = await recognized(harness);
    for (const input of [{ provenance: 'ink' }, { provenance: 'ink', recogId }, { provenance: 'ink', recogId: randomUUID() }]) {
      const res = await submitDefinition(harness, '$x=1$', input);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('RECOG_NOT_CONFIRMED');
    }
  });

  it('确认之后：与确认文字一致才能以手写来源提交，attempt_lines 记录 recog_id；文字被换掉 → 409', async () => {
    const { h: harness } = await start({ simple: { latex: 'x=1', conf: 0.9 }, qwen: '$x=1$' });
    const recogId = await recognized(harness);
    expect((await confirm(harness, recogId, '$x=1$')).statusCode).toBe(200);

    const swapped = await submitDefinition(harness, '设数列 $\\{a_n\\}$ 收敛到 $a$', { provenance: 'ink', recogId });
    expect(swapped.statusCode).toBe(409);
    expect(swapped.json().error.code).toBe('RECOG_NOT_CONFIRMED');

    const photoClaim = await submitDefinition(harness, '$x=1$', { provenance: 'photo', recogId });
    expect(photoClaim.statusCode).toBe(409); // 手写识别不能冒充拍照

    const ok = await submitDefinition(harness, ' $x = 1$ ', { provenance: 'ink', recogId }); // 空白差异按 canon 不算
    expect(ok.statusCode, ok.body).toBe(200);
    const line = (await harness.db.query(`select provenance, recog_id from app.attempt_lines where attempt_id = $1`, [harness.attemptId])).rows[0];
    expect(line).toMatchObject({ provenance: 'ink', recog_id: recogId });
  });

  it('键盘与粘贴来源不受影响', async () => {
    const { h: harness } = await start({});
    const res = await submitDefinition(harness, '设数列收敛', { provenance: 'keyboard' });
    expect(res.statusCode, res.body).toBe(200);
  });
});


// 最小的 JPEG：魔数 + 一个 SOF0 段（宽 640 高 480），足够通过类型嗅探
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0000b08' + '01e0' + '0280' + '0100' + 'ffd9', 'hex');

function multipartBody(fields: Record<string, string>, image?: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----pgtest' + randomUUID();
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (image) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      image,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

function photo(harness: HelpHarness, image: Buffer | null = JPEG, extra: Record<string, string> = {}) {
  const { payload, headers } = multipartBody(
    { attemptId: harness.attemptId, draftId: randomUUID(), target: 'line_statement', source: 'camera', ...extra },
    image ?? undefined,
  );
  return harness.app.inject({ method: 'POST', url: '/api/v1/recognitions/photo', headers: { cookie: harness.cookie, ...WRITE_HEADERS, ...headers }, payload });
}

describe('POST /recognitions/photo', () => {
  it('整页切行：两路逐行一致 → agree=true；落库 app.photos / recognitions，原图落盘，写事件', async () => {
    const { h: harness } = await start({ page: '$|a_n-3|=\\frac{5}{n+2}$\n\n通分得 $b=2$', qwen: '$|a_n-3|=\\frac{5}{n+2}$\n通分得 $b=2$' });
    const res = await photo(harness);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.lines.map((l: { text: string }) => l.text)).toEqual(['$|a_n-3|=\\frac{5}{n+2}$', '通分得 $b=2$']);
    expect(body.agree).toBe(true);
    const ph = (await harness.db.query(`select source, bytes, w, h, storage_key from app.photos`)).rows[0] as Record<string, unknown>;
    expect(ph).toMatchObject({ source: 'camera', bytes: JPEG.length, w: 640, h: 480 });
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    expect(existsSync(resolve(KEYED.recognition.storageDir, String(ph.storage_key)))).toBe(true);
    expect((await eventsOf(harness, 'recog.result'))[0]?.payload).toMatchObject({ lines: 2, agree: true, status: 'ok' });
  });

  it('行数对不上：agree=false（无法对齐，界面请学生逐行核对）；SimpleTex 失败时 Qwen 当主', async () => {
    const a = await start({ page: '$x=1$\n$y=2$', qwen: '$x=1$' });
    expect((await photo(a.h)).json().agree).toBe(false);
    await a.h.close();
    h = undefined;
    const b = await start({ page: 'fail', qwen: '$x=1$\n$y=2$' });
    const body = (await photo(b.h)).json();
    expect(body).toMatchObject({ status: 'ok', agree: null });
    expect(body.lines).toHaveLength(2);
  });

  it('两路都失败 503；测验模式 403 TEST_MODE_RESTRICTED；老师关了拍照 403 PHOTO_DISABLED；非图片 422；超过 2MB 413；缺字段 422', async () => {
    const { h: harness } = await start({ page: 'fail', qwen: 'fail' });
    expect((await photo(harness)).statusCode).toBe(503);
    expect((await photo(harness, Buffer.from('not an image'))).statusCode).toBe(422);
    expect((await photo(harness, null)).statusCode).toBe(422);
    const big = await photo(harness, Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024 + 10)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    const noTarget = await photo(harness, JPEG, { target: 'nope' });
    expect(noTarget.statusCode).toBe(422);

    await harness.db.query(`update app.classes set settings = jsonb_set(settings, '{photoEnabled}', 'false')`);
    const off = await photo(harness);
    expect(off.statusCode).toBe(403);
    expect(off.json().error.code).toBe('PHOTO_DISABLED');
    await harness.db.query(`update app.classes set settings = jsonb_set(settings, '{photoEnabled}', 'true')`);

    await harness.db.query(`update app.attempts set mode = 'test' where id = $1`, [harness.attemptId]);
    const test = await photo(harness);
    expect(test.statusCode).toBe(403);
    expect(test.json().error.code).toBe('TEST_MODE_RESTRICTED');
  });

  it('照片目录不可写：503（识别暂不可用，请用键盘），不留 app.photos 行，也不是 500', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const blocker = join(mkdtempSync(join(tmpdir(), 'pg-photo-')), 'not-a-dir');
    writeFileSync(blocker, 'x'); // 普通文件挡在路径上：mkdir 必然失败（ENOTDIR），与 root 权限无关
    const { h: harness } = await start(
      { page: '$x=1$', qwen: '$x=1$' },
      { config: { recognition: { ...KEYED.recognition, storageDir: join(blocker, 'photos') } } },
    );
    const res = await photo(harness);
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(res.json().error.message).toContain('键盘');
    expect((await harness.db.query(`select 1 from app.photos`)).rows).toHaveLength(0);
  });

  it('拍照整页识别每路 12 s 超时：provider 默认值很短（30 ms）时慢响应仍成功；行 OCR 仍按 provider 默认值超时', async () => {
    const inner = scriptedFetch({ page: '$x=1$\n$y=2$', qwen: '$x=1$\n$y=2$', simple: { latex: 'x=1', conf: 0.95 } }).fetchImpl;
    const slow = (async (...args: Parameters<typeof fetch>) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return inner(...args);
    }) as typeof fetch;
    const providers = Object.fromEntries(Object.entries(KEYED.models.providers).map(([k, v]) => [k, { ...v, timeoutMs: 30 }]));
    h = await startHelpHarness('epsN', { config: { models: { ...KEYED.models, providers } }, fetchImpl: slow });
    const page = await photo(h);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({ status: 'ok' });
    expect(page.json().lines).toHaveLength(2);
    // 同样的慢响应，行 OCR 走 provider 默认的 30 ms：两路都超时 → 503（证明没有被一并放宽）
    const ink = await recognize(h);
    expect(ink.statusCode, ink.body).toBe(503);
  });

  it('确认：一张照片的 recogId 可逐批确认（已确认的行累加），逐行提交只认确认过的行', async () => {
    const { h: harness } = await start({ page: '$x=1$\n$y=2$\n$z=3$', qwen: '$x=1$\n$y=2$\n$z=3$' });
    const recogId = (await photo(harness)).json().recogId as string;
    const attemptId = harness.attemptId;
    const userId = (await harness.db.query<{ user_id: string }>(`select user_id from app.attempts where id = $1`, [attemptId])).rows[0]!.user_id;
    const input = { provenance: 'photo' as const, recogId };

    await expect(assertConfirmedInput(harness.db, userId, attemptId, input, ['$x=1$'])).rejects.toMatchObject({ code: 'RECOG_NOT_CONFIRMED' });
    expect((await confirm(harness, recogId, '$x=1$', ['$x=1$'])).statusCode).toBe(200);
    await expect(assertConfirmedInput(harness.db, userId, attemptId, input, ['$x = 1$'])).resolves.toBeUndefined();
    await expect(assertConfirmedInput(harness.db, userId, attemptId, input, ['$y=2$'])).rejects.toMatchObject({ code: 'RECOG_NOT_CONFIRMED' });
    expect((await confirm(harness, recogId, '$y=2$', ['$y=2$'])).statusCode).toBe(200);
    await expect(assertConfirmedInput(harness.db, userId, attemptId, input, ['$x=1$'])).resolves.toBeUndefined();
    await expect(assertConfirmedInput(harness.db, userId, attemptId, input, ['$y=2$'])).resolves.toBeUndefined();
    await expect(assertConfirmedInput(harness.db, userId, attemptId, input, ['$z=3$'])).rejects.toMatchObject({ code: 'RECOG_NOT_CONFIRMED' });
    // 手写来源不能拿照片的 recogId
    await expect(assertConfirmedInput(harness.db, userId, attemptId, { provenance: 'ink', recogId }, ['$x=1$'])).rejects.toMatchObject({ code: 'RECOG_NOT_CONFIRMED' });
  });
});
