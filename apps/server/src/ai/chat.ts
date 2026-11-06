// OpenAI 兼容的聊天适配器（DashScope 通义千问、DeepSeek 共用）。
// 输入：{messages, json?, maxTokens?, temperature?}。json=true 时要求 JSON 输出（response_format）。
// 输出：{text, usage:{inputTokens, outputTokens}, model}。usage 由网关取走写进 app.model_calls，不进 output。
// 适配器只抛原因码（AdapterError），不抛响应体或错误信息：它们可能含学生文本。
import { AdapterError } from './errors.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatOutput extends Record<string, unknown> {
  text: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isChatInput(input: unknown): input is ChatInput {
  return isRecord(input) && Array.isArray(input.messages);
}

export interface InvokeChatOptions {
  provider: 'dashscope' | 'deepseek';
  baseUrl: string;
  apiKey: string;
  model: string;
  // models.yaml 的 thinking：false 时关闭思考（qwen3 用 enable_thinking，DeepSeek 用 thinking.type）。
  thinking: boolean | null;
  input: unknown;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}

export function buildChatRequest(options: Pick<InvokeChatOptions, 'provider' | 'model' | 'thinking' | 'input'>): Record<string, unknown> {
  const { input } = options;
  if (!isChatInput(input)) throw new AdapterError('bad_input');
  const messages = input.messages;
  if (messages.length === 0 || !messages.every((m) => isRecord(m) && typeof m.content === 'string' && typeof m.role === 'string')) {
    throw new AdapterError('bad_input');
  }
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    temperature: input.temperature ?? 0.3,
    max_tokens: input.maxTokens ?? 600,
  };
  if (input.json === true) body.response_format = { type: 'json_object' };
  if (options.thinking === false) {
    if (options.provider === 'dashscope') body.enable_thinking = false;
    else body.thinking = { type: 'disabled' };
  }
  return body;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseChatResponse(json: unknown): ChatOutput {
  if (!isRecord(json) || !Array.isArray(json.choices)) throw new AdapterError('bad_response');
  const first: unknown = json.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== 'string') {
    throw new AdapterError('bad_response');
  }
  const usage = isRecord(json.usage) ? json.usage : {};
  return {
    text: first.message.content.trim(),
    usage: { inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens) },
  };
}

export async function invokeChat(options: InvokeChatOptions): Promise<ChatOutput> {
  const body = buildChatRequest(options);
  let response: Response;
  try {
    response = await options.fetchImpl(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    throw new AdapterError('network');
  }
  if (!response.ok) throw new AdapterError(`http_${response.status}`);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AdapterError('bad_response');
  }
  return parseChatResponse(json);
}
