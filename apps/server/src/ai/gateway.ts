// 模型网关（09 §2、§11）。
//
// 约定：
// - callModel 从不抛错。provider 故障、超时、未配置、未同意、审计写入失败都以 status 返回，调用方按规则降级。
// - 每次调用（包括跳过）都写 app.model_calls。只存输入的哈希，不存原文；output 只存原因码，不存错误信息或响应体。
// - 不要在持有作答行锁的 db.tx 里调用 callModel：它会发起 HTTP 请求，最长等 timeoutMs。
// - 超时由网关自己用 race 强制执行，不依赖适配器是否响应 AbortSignal。

import { createHash } from 'node:crypto';

import type { Db } from '../db/index.ts';

import { invokeChat } from './chat.ts';
import { invokeDashscope } from './dashscope.ts';
import { AdapterError } from './errors.ts';
import { invokeJev } from './jev.ts';
import { invokeSimpleTex } from './simpletex.ts';
import type { ModelEntry, ModelRegistry, ProviderEntry } from './registry.ts';

export type CallStatus = 'ok' | 'error' | 'timeout' | 'skipped';
export type DepState = 'ok' | 'degraded' | 'disabled';

export interface CallOptions {
  // registry 里 models 的键，如 decide
  role: string;
  attemptId?: string;
  promptVersion?: string;
  // 境外 provider 必须显式为 true；undefined 视为未同意（fail closed）
  crossBorderConsent?: boolean;
  // 不传则按注册表：typesafe 且 flags['jev.shadowOnly'] 为真时为影子。L1 语义判定等例外由调用方覆盖（09 §4.3）
  shadow?: boolean;
  // 输出含学生手写内容（识别服务）时为 true：model_calls.output 只记 {redacted:true}，原文只存在于业务表（app.recognitions）。
  redactOutput?: boolean;
  // 本次调用的超时（毫秒），覆盖 provider 在注册表里的默认值。拍照识别（整页，09 §R2 的 12 s）用它放宽，
  // 行 OCR 不传，仍按 provider 的 5–6 s。
  timeoutMs?: number;
}

export interface CallResult {
  status: CallStatus;
  output: Record<string, unknown> | null;
  shadow: boolean;
  latencyMs: number;
  reason: string | null;
  // 聊天调用的 token 用量与估算费用（元）；其它调用没有。
  usage?: { inputTokens: number | null; outputTokens: number | null; costCny: number | null };
}

export interface HealthReport {
  deps: Record<string, DepState>;
}

export interface ModelGateway {
  callModel(purpose: string, input: unknown, options: CallOptions): Promise<CallResult>;
  health(now?: number): HealthReport;
}

export interface GatewayDeps {
  registry: ModelRegistry;
  db?: Db;
  fetchImpl?: typeof fetch;
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
}

// 最近一次失败后这段时间内，/health 的 deps 显示 degraded；之后即使没有成功调用也恢复为 ok。
// 这样少数学生同意境外模型时，一次超时不会让 deps 长期卡在 degraded。
export const DEGRADED_WINDOW_MS = 5 * 60 * 1000;

interface AdapterCall {
  entry: ProviderEntry;
  model: ModelEntry;
  input: unknown;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}

type Adapter = (call: AdapterCall) => Promise<Record<string, unknown>>;

// 只有有适配器的 provider 才会被调用。其余在 09 §2 注册了，但本阶段未接入，/health 显示 disabled。
const ADAPTERS: Record<string, Adapter> = {
  typesafe: ({ entry, model, input, signal, fetchImpl }) =>
    invokeJev({
      baseUrl: entry.values.baseUrl ?? '',
      apiKey: entry.values.apiKey ?? '',
      model: model.model ?? '',
      input,
      signal,
      fetchImpl,
    }),
  simpletex: ({ entry, model, input, signal, fetchImpl }) =>
    invokeSimpleTex({
      baseUrl: entry.values.baseUrl ?? '',
      appId: entry.values.appId ?? '',
      appSecret: entry.values.appSecret ?? '',
      endpoint: model.endpoint ?? '',
      input,
      signal,
      fetchImpl,
    }),
  dashscope: ({ entry, model, input, signal, fetchImpl }) =>
    invokeDashscope({
      baseUrl: entry.values.baseUrl ?? '',
      apiKey: entry.values.apiKey ?? '',
      model: model.model ?? '',
      input,
      signal,
      fetchImpl,
      thinking: model.thinking,
    }),
  deepseek: ({ entry, model, input, signal, fetchImpl }) =>
    invokeChat({
      provider: 'deepseek',
      baseUrl: entry.values.baseUrl ?? '',
      apiKey: entry.values.apiKey ?? '',
      model: model.model ?? '',
      thinking: model.thinking,
      input,
      signal,
      fetchImpl,
    }),
};

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input) ?? '').digest('hex');
}

export function createModelGateway(deps: GatewayDeps): ModelGateway {
  const { registry, db, fetchImpl = fetch, logger } = deps;
  const lastFailureAt = new Map<string, number>();

  function shadowFor(provider: string, options: CallOptions): boolean {
    if (options.shadow !== undefined) return options.shadow;
    return provider === 'typesafe' && registry.flags['jev.shadowOnly'] === true;
  }

  // 真正发出的请求才会更新健康状态；跳过（未配置、未同意、无适配器）不算失败。
  async function invoke(
    adapter: Adapter,
    provider: ProviderEntry,
    model: ModelEntry,
    input: unknown,
    timeoutMs: number,
  ): Promise<{ status: CallStatus; output: Record<string, unknown> | null; reason: string | null }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AdapterError('timeout'));
      }, timeoutMs);
    });
    try {
      const output = await Promise.race([
        adapter({ entry: provider, model, input, signal: controller.signal, fetchImpl }),
        timedOut,
      ]);
      return { status: 'ok', output, reason: null };
    } catch (error) {
      if (error instanceof AdapterError && error.reason === 'timeout') {
        return { status: 'timeout', output: null, reason: 'timeout' };
      }
      const reason = error instanceof AdapterError ? error.reason : 'unexpected';
      return { status: 'error', output: null, reason };
    } finally {
      clearTimeout(timer);
    }
  }

  async function callModel(purpose: string, input: unknown, options: CallOptions): Promise<CallResult> {
    const started = Date.now();
    if (!db) return { status: 'error', output: null, shadow: false, latencyMs: 0, reason: 'no_audit_store' };

    const model = registry.models[options.role];
    const providerName = model?.provider ?? 'unknown';
    const provider = registry.providers[providerName];
    const adapter: Adapter | undefined = ADAPTERS[providerName];
    const shadow = shadowFor(providerName, options);

    let status: CallStatus;
    let output: Record<string, unknown> | null = null;
    let reason: string | null = null;

    if (!model || !provider) {
      status = 'skipped';
      reason = 'unknown_role';
    } else if (!adapter) {
      status = 'skipped';
      reason = 'no_adapter';
    } else if (!provider.configured) {
      status = 'skipped';
      reason = 'not_configured';
    } else if (provider.region === 'overseas' && options.crossBorderConsent !== true) {
      // 同意检查在任何网络路径之前；未同意时不发送任何内容。
      status = 'skipped';
      reason = 'no_consent';
    } else {
      const outcome = await invoke(adapter, provider, model, input, options.timeoutMs ?? provider.timeoutMs);
      status = outcome.status;
      output = outcome.output;
      reason = outcome.reason;
      if (status === 'ok') lastFailureAt.delete(providerName);
      else lastFailureAt.set(providerName, Date.now());
    }

    const latencyMs = Date.now() - started;
    // 聊天适配器把 token 用量放在 output.usage：取走写进列，不留在 output 里。
    let usage: CallResult['usage'];
    if (output !== null && typeof output.usage === 'object' && output.usage !== null) {
      const { inputTokens, outputTokens } = output.usage as { inputTokens: number | null; outputTokens: number | null };
      const inRate = model?.inputCnyPerM ?? null;
      const outRate = model?.outputCnyPerM ?? null;
      const costCny =
        inRate !== null && outRate !== null && inputTokens !== null && outputTokens !== null
          ? (inputTokens * inRate + outputTokens * outRate) / 1_000_000
          : null;
      usage = { inputTokens, outputTokens, costCny };
      const { usage: _usage, ...rest } = output;
      output = rest;
    }
    try {
      await db.query(
        `insert into app.model_calls
           (attempt_id, purpose, provider, model, prompt_version, input_hash, latency_ms, status, shadow, output,
           input_tokens, output_tokens, cost_cny)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
        [
          options.attemptId ?? null,
          purpose,
          providerName,
          model?.model ?? 'unknown',
          options.promptVersion ?? null,
          hashInput(input),
          latencyMs,
          status,
          shadow,
          JSON.stringify(output === null ? { reason } : options.redactOutput ? { redacted: true } : output),
          usage?.inputTokens ?? null,
          usage?.outputTokens ?? null,
          usage?.costCny ?? null,
        ],
      );
    } catch {
      // 没有审计行就不使用结果：审计失败时返回 error，调用方按规则降级。
      logger?.warn({ purpose, provider: providerName, status }, 'model_calls 写入失败');
      return { status: 'error', output: null, shadow, latencyMs, reason: 'audit_failed' };
    }

    return { status, output: status === 'ok' ? output : null, shadow, latencyMs, reason, ...(usage ? { usage } : {}) };
  }

  function health(now: number = Date.now()): HealthReport {
    const deps: Record<string, DepState> = {};
    for (const [name, provider] of Object.entries(registry.providers)) {
      if (ADAPTERS[name] === undefined) deps[name] = 'disabled';
      else if (!provider.configured) deps[name] = 'degraded';
      else if (now - (lastFailureAt.get(name) ?? Number.NEGATIVE_INFINITY) < DEGRADED_WINDOW_MS) deps[name] = 'degraded';
      else deps[name] = 'ok';
    }
    return { deps };
  }

  return { callModel, health };
}
