import { BudgetExceededError, type CostLedger, type Usage } from './ledger.ts';

// 批量流水线的模型客户端：百炼与 DeepSeek 都走 OpenAI 兼容接口。
// 只在这一层碰密钥；错误信息不带请求头，也不带响应全文。测试注入 fetchImpl 或直接实现 ChatClient。
export type Provider = 'dashscope' | 'deepseek';

export type ChatContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

export interface ChatRequest {
  stage: string;
  ref?: string;
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  thinking?: boolean;
  timeoutMs?: number;
}

export interface ChatResponse {
  text: string;
  finishReason: string;
  usage: Usage;
  cost: number;
  model: string;
}

export interface ChatClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

// 模型拒绝（如内容审查）或参数错误：重试没有意义，调用方把它记成这一页或这一题的失败。
export class ModelCallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelCallError';
    this.code = code;
  }
}

// 账户层面的拒绝（欠费、余额不足）：每一题都会同样失败，停下整轮，充值后 --resume 继续。
export class AccountBlockedError extends BudgetExceededError {
  constructor(provider: Provider, code: string, spent: number) {
    super(spent, Number.POSITIVE_INFINITY);
    this.name = 'AccountBlockedError';
    this.message = `${provider} 账户不可用（${code}）：处理账户后用 --resume 继续`;
  }
}

const ACCOUNT_ERROR_CODES = new Set(['Arrearage', 'AccessDenied.Unpurchased', 'insufficient_balance']);

// 同样的权重可能挂在两家：deepseek-flash、deepseek-v4-pro 走 DeepSeek 官方，其余（含百炼上的 deepseek-v4.1-flash）走百炼。
export function providerOf(model: string): Provider {
  return model === 'deepseek-flash' || model.startsWith('deepseek-v4-') ? 'deepseek' : 'dashscope';
}

const ENDPOINTS: Record<Provider, string> = {
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

const KEY_ENV: Record<Provider, string> = { dashscope: 'DASHSCOPE_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };

export interface ClientOptions {
  ledger: CostLedger;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function usageFromResponse(usage: unknown): Usage {
  const u = (usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  };
  return {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
    cached: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

export function createChatClient(options: ClientOptions): ChatClient {
  const env = options.env ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 6;

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const key = env[KEY_ENV[request.provider]];
      if (key === undefined || key.trim() === '') {
        throw new ModelCallError('missing_key', `未配置 ${KEY_ENV[request.provider]}（真实运行用 node --env-file=infra/.env）`);
      }
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0,
      };
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      if (request.json === true) body.response_format = { type: 'json_object' };
      if (request.provider === 'dashscope') body.enable_thinking = request.thinking === true;
      else body.thinking = { type: request.thinking === true ? 'enabled' : 'disabled' };

      let lastError = '';
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        options.ledger.assertWithinBudget();
        if (attempt > 1) await sleep(Math.min(60_000, 1500 * 2 ** (attempt - 2)) + Math.random() * 1000);
        let response: Response;
        try {
          response = await doFetch(ENDPOINTS[request.provider], {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(request.timeoutMs ?? 240_000),
          });
        } catch (error) {
          lastError = `network: ${(error as Error).name}`;
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = `http ${response.status}`;
          await response.text().catch(() => '');
          continue;
        }
        let raw: string;
        try {
          raw = await response.text();
        } catch (error) {
          lastError = `network: ${(error as Error).name}`;
          continue;
        }
        if (!response.ok) {
          let code = response.status === 402 ? 'insufficient_balance' : `http_${response.status}`;
          try {
            const parsed = JSON.parse(raw) as { error?: { code?: string } };
            if (typeof parsed.error?.code === 'string') code = parsed.error.code;
          } catch {
            // 非 JSON 错误体：保留状态码即可。
          }
          if (ACCOUNT_ERROR_CODES.has(code)) throw new AccountBlockedError(request.provider, code, options.ledger.spent());
          throw new ModelCallError(code, `${request.provider} ${request.model} 调用失败：${code}`);
        }
        let parsed: {
          choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
          usage?: unknown;
          model?: string;
        };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          lastError = 'bad_json_envelope';
          continue;
        }
        const usage = usageFromResponse(parsed.usage);
        const entry = options.ledger.record({
          stage: request.stage,
          model: request.model,
          ...usage,
          ...(request.ref === undefined ? {} : { ref: request.ref }),
        });
        const choice = parsed.choices?.[0];
        const text = choice?.message?.content ?? '';
        if (text.trim() === '') {
          // 思考把 token 用完时重试也一样，只会多花钱。
          if (choice?.finish_reason === 'length') throw new ModelCallError('truncated', `${request.model} 输出被截断`);
          lastError = 'empty_response';
          continue;
        }
        return { text, finishReason: choice?.finish_reason ?? 'stop', usage, cost: entry.cost, model: request.model };
      }
      throw new ModelCallError('retries_exhausted', `${request.provider} ${request.model} 重试 ${maxAttempts} 次仍失败（${lastError}）`);
    },
  };
}

// 模型常把 LaTeX 的反斜杠只写一个。\lim、\sqrt 这种会让 JSON 报错；更糟的是 \frac、\beta、\neq、\rho、\tau
// 恰好是合法转义，解析不报错但内容已损坏（\frac 变成换页符 + rac）。两种都在这里修回来。
const CONTROL_FIXES: Array<[RegExp, string]> = [
  [/\f/g, '\\f'],
  [/[\b]/g, '\\b'],
  [/\t(?=[A-Za-z])/g, '\\t'],
  [/\r(?=[A-Za-z])/g, '\\r'],
  // 换行只在后面紧跟常见 LaTeX 命令的尾巴时才还原，真正的换行不动。
  [/\n(?=(?:eq|e\b|u\b|abla|ot\b|otin|mid|leq|geq|parallel|ormalsize)(?![一-鿿]))/g, '\\n'],
];

export function repairLatexEscapes<T>(value: T): T {
  if (typeof value === 'string') {
    let text: string = value;
    for (const [regex, replacement] of CONTROL_FIXES) text = text.replace(regex, () => replacement);
    return text as T;
  }
  if (Array.isArray(value)) return value.map((item) => repairLatexEscapes(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairLatexEscapes(item)])) as T;
  }
  return value;
}

function escapeBareBackslashes(text: string): string {
  // 成对的 \\ 先跳过；其余不合法的单个反斜杠补成两个。
  return text.replace(/\\\\|\\u[0-9a-fA-F]{4}|\\(["\\/bfnrt])|\\/g, (match) => (match === '\\' ? '\\\\' : match));
}

// 从模型输出里取 JSON：容忍代码块围栏、前后说明文字和单反斜杠。
export function parseJsonLoose<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[{[]/);
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  const attempts = [candidate, start >= 0 && end > start ? candidate.slice(start, end + 1) : ''].filter((item) => item !== '');
  if (attempts.length === 1 && start < 0) throw new Error('模型输出里没有 JSON');
  let lastError: unknown;
  for (const attempt of attempts) {
    for (const body of [attempt, escapeBareBackslashes(attempt)]) {
      try {
        return repairLatexEscapes(JSON.parse(body) as T);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError;
}

export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
}
