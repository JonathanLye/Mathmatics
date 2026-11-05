import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createModelGateway, DEGRADED_WINDOW_MS, type GatewayDeps } from '../src/ai/gateway.ts';
import { loadModelRegistry, type ModelRegistry } from '../src/ai/registry.ts';
import type { Db } from '../src/db/index.ts';

import { setupFixture, type Fixture } from './support/fixtures.ts';

const MODELS_PATH = fileURLToPath(new URL('../config/models.yaml', import.meta.url));
const KEYED = { JEV_BASE_URL: 'https://jev.test', JEV_API_KEY: 'test-key-not-real' };
// 学生原文的标记：不得出现在 model_calls 里。
const STUDENT_TEXT = '学生原话标记QZX';
const JEV_INPUT = {
  problem: '用 ε-N 定义证明 lim (3n+1)/(n+2) = 3。',
  previousLines: ['1. |a_n-3|=5/(n+2)（通分）'],
  currentLine: { statement: STUDENT_TEXT },
  instructions: '学生当前这一行确立了下面哪一项？',
  criteria: { K1: '化简成只含 n 的分式', other: '正确但不属于任何一项' },
};

let fx: Fixture;
let db: Db;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
});

afterEach(async () => {
  await fx.close();
});

function registryFor(env: NodeJS.ProcessEnv, timeoutMs?: number): ModelRegistry {
  const registry = loadModelRegistry(MODELS_PATH, env);
  if (timeoutMs === undefined) return registry;
  return { ...registry, providers: { ...registry.providers, typesafe: { ...registry.providers.typesafe, timeoutMs } } };
}

function gatewayFor(env: NodeJS.ProcessEnv, overrides: Partial<GatewayDeps> & { timeoutMs?: number } = {}) {
  return createModelGateway({
    registry: registryFor(env, overrides.timeoutMs),
    db,
    fetchImpl: overrides.fetchImpl,
  });
}

function fetchReturning(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

function countingFetch(inner: typeof fetch): { fetchImpl: typeof fetch; calls: number } {
  const state = { fetchImpl: inner, calls: 0 };
  state.fetchImpl = (async (...args: Parameters<typeof fetch>) => {
    state.calls += 1;
    return inner(...args);
  }) as typeof fetch;
  return state;
}

async function auditRows(purpose: string) {
  return (
    await db.query<{
      status: string;
      provider: string;
      model: string;
      shadow: boolean;
      output: Record<string, unknown>;
      input_hash: string;
    }>(
      `select status, provider, model, shadow, output, input_hash from app.model_calls where purpose = $1`,
      [purpose],
    )
  ).rows;
}

describe('模型注册表', () => {
  it('变量都非空时 provider 已配置并展开字段；缺失时只列变量名', () => {
    const configured = loadModelRegistry(MODELS_PATH, KEYED);
    expect(configured.providers.typesafe).toMatchObject({ configured: true, missing: [] });
    expect(configured.providers.typesafe?.values.baseUrl).toBe('https://jev.test');

    const missing = loadModelRegistry(MODELS_PATH, { JEV_BASE_URL: 'https://jev.test' });
    expect(missing.providers.typesafe).toMatchObject({ configured: false, missing: ['JEV_API_KEY'] });
  });

  it('MODEL_<ROLE> 环境变量覆盖模型 ID，未设置时用 yaml 默认', () => {
    const base = loadModelRegistry(MODELS_PATH, {});
    const overridden = loadModelRegistry(MODELS_PATH, { MODEL_CROSS: 'qwen-flash', MODEL_FAST: '' });
    expect(overridden.models.cross?.model).toBe('qwen-flash');
    expect(overridden.models.fast?.model).toBe(base.models.fast?.model);
    expect(overridden.models.decide?.model).toBe(base.models.decide?.model);
  });

  it('models 引用未知 provider 时报错，指出角色名', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'registry-'));
    const file = path.join(dir, 'models.yaml');
    writeFileSync(file, 'providers: {}\nmodels:\n  decide:\n    provider: nope\n    model: x\n');
    expect(() => loadModelRegistry(file, {})).toThrow(/models\.decide 引用了未知的 provider/);
  });
});

describe('callModel', () => {
  it('未配置时跳过：不发请求，仍写一行审计，只存输入哈希', async () => {
    const counted = countingFetch(fetchReturning({ ok: true }));
    const gateway = gatewayFor({}, { fetchImpl: counted.fetchImpl });
    const result = await gateway.callModel('test_not_configured', JEV_INPUT, { role: 'decide', crossBorderConsent: true });

    expect(result).toMatchObject({ status: 'skipped', reason: 'not_configured', output: null });
    expect(counted.calls).toBe(0);
    const [row] = await auditRows('test_not_configured');
    expect(row).toMatchObject({ status: 'skipped', provider: 'typesafe', model: 'jev-1.13', output: { reason: 'not_configured' } });
  });

  it('境外模型未同意时跳过（fail closed），即使已配置也不发请求', async () => {
    const counted = countingFetch(fetchReturning({ ok: true }));
    const gateway = gatewayFor(KEYED, { fetchImpl: counted.fetchImpl });

    const undecided = await gateway.callModel('test_no_consent_undefined', JEV_INPUT, { role: 'decide' });
    const declined = await gateway.callModel('test_no_consent_false', JEV_INPUT, { role: 'decide', crossBorderConsent: false });

    expect(undecided).toMatchObject({ status: 'skipped', reason: 'no_consent' });
    expect(declined).toMatchObject({ status: 'skipped', reason: 'no_consent' });
    expect(counted.calls).toBe(0);
  });

  it('成功：返回输出，默认为影子；审计行只有哈希，没有学生原文', async () => {
    const gateway = gatewayFor(KEYED, { fetchImpl: fetchReturning({ choice: 'K1' }) });
    const result = await gateway.callModel('test_ok', JEV_INPUT, { role: 'decide', crossBorderConsent: true });

    expect(result).toMatchObject({ status: 'ok', output: { choice: 'K1' }, shadow: true, reason: null });
    const [row] = await auditRows('test_ok');
    expect(row).toMatchObject({ status: 'ok', shadow: true, output: { choice: 'K1' } });
    const expectedHash = createHash('sha256').update(JSON.stringify(JEV_INPUT)).digest('hex');
    expect(row?.input_hash).toBe(expectedHash);
    expect(JSON.stringify(row)).not.toContain(STUDENT_TEXT);
  });

  it('网络失败：返回 error 而不抛错，并让 deps 显示 degraded', async () => {
    const gateway = gatewayFor(KEYED, {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const result = await gateway.callModel('test_network', JEV_INPUT, { role: 'decide', crossBorderConsent: true });

    expect(result).toMatchObject({ status: 'error', reason: 'network', output: null });
    expect(gateway.health().deps.typesafe).toBe('degraded');
    expect((await auditRows('test_network'))[0]?.output).toEqual({ reason: 'network' });
  });

  it('超时：适配器不响应 AbortSignal 也能按 timeoutMs 返回 timeout', async () => {
    const gateway = gatewayFor(KEYED, { timeoutMs: 30, fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch });
    const started = Date.now();
    const result = await gateway.callModel('test_timeout', JEV_INPUT, { role: 'decide', crossBorderConsent: true });

    expect(result).toMatchObject({ status: 'timeout', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await auditRows('test_timeout'))[0]?.status).toBe('timeout');
  });

  it('审计写入失败：返回 audit_failed，不抛错，结果不交给调用方', async () => {
    const failingDb = {
      query: async () => {
        throw new Error('db down');
      },
    } as unknown as Db;
    const gateway = createModelGateway({
      registry: registryFor(KEYED),
      db: failingDb,
      fetchImpl: fetchReturning({ choice: 'K1' }),
    });
    const result = await gateway.callModel('test_audit', JEV_INPUT, { role: 'decide', crossBorderConsent: true });

    expect(result).toMatchObject({ status: 'error', reason: 'audit_failed', output: null });
  });

  it('显式覆盖 shadow：L1 语义判定等例外可以不是影子', async () => {
    const gateway = gatewayFor(KEYED, { fetchImpl: fetchReturning({ choice: 'K1' }) });
    const result = await gateway.callModel('test_shadow_off', JEV_INPUT, {
      role: 'decide',
      crossBorderConsent: true,
      shadow: false,
    });

    expect(result.shadow).toBe(false);
    expect((await auditRows('test_shadow_off'))[0]?.shadow).toBe(false);
  });

  it('输入缺字段：返回 bad_input，不发请求', async () => {
    const counted = countingFetch(fetchReturning({}));
    const gateway = gatewayFor(KEYED, { fetchImpl: counted.fetchImpl });
    const result = await gateway.callModel('test_bad_input', { problem: 'x' }, { role: 'decide', crossBorderConsent: true });

    expect(result).toMatchObject({ status: 'error', reason: 'bad_input' });
    expect(counted.calls).toBe(0);
  });
});

describe('Jev 请求体', () => {
  it('只含数学文本：身份字段即使被传进来也不出现在请求体里', async () => {
    let sent = '';
    const capture = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = String(init?.body ?? '');
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const gateway = gatewayFor(KEYED, { fetchImpl: capture });
    await gateway.callModel(
      'test_privacy',
      { ...JEV_INPUT, attemptId: 'attempt-secret-7f3', userId: 'user-secret-9c1', className: '高二3班' },
      { role: 'decide', crossBorderConsent: true },
    );

    expect(sent).not.toContain('attempt-secret-7f3');
    expect(sent).not.toContain('user-secret-9c1');
    expect(sent).not.toContain('高二3班');
    const body = JSON.parse(sent) as { state: Record<string, unknown> };
    expect(Object.keys(body.state).sort()).toEqual(['current_line', 'previous_lines', 'problem']);
  });
});

describe('deps 状态', () => {
  it('没有 key：已接入适配器的 provider degraded；未接入的为 disabled', () => {
    const deps = gatewayFor({}).health().deps;
    expect(deps.typesafe).toBe('degraded');
    expect(deps.simpletex).toBe('degraded');
    expect(deps.dashscope).toBe('degraded');
    expect(deps.deepseek).toBe('disabled');
  });

  it('有 key 且没有失败：typesafe ok', () => {
    expect(gatewayFor(KEYED).health().deps.typesafe).toBe('ok');
  });

  it('失败后处于时间窗内为 degraded；超过窗口恢复 ok；成功调用立即恢复', async () => {
    const failing = gatewayFor(KEYED, {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await failing.callModel('test_window_fail', JEV_INPUT, { role: 'decide', crossBorderConsent: true });
    const failedAt = Date.now();
    expect(failing.health(failedAt).deps.typesafe).toBe('degraded');
    expect(failing.health(failedAt + DEGRADED_WINDOW_MS + 1).deps.typesafe).toBe('ok');

    const recovering = gatewayFor(KEYED, { fetchImpl: fetchReturning({ choice: 'K1' }) });
    await recovering.callModel('test_window_ok', JEV_INPUT, { role: 'decide', crossBorderConsent: true });
    expect(recovering.health().deps.typesafe).toBe('ok');
  });
});
