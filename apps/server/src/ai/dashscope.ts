// 阿里云百炼（DashScope，OpenAI 兼容模式）视觉转写适配器：手写行/整页的交叉校验（03 §3.1 第 4 步）。
// 模型输出只是"另一路转写"，用于和主识别比对；不作为判定依据。
import { invokeChat, isChatInput, type ChatOutput } from './chat.ts';
import { AdapterError } from './errors.ts';

// 09 §5.1 P-OCR-1：转写员，不是老师。逐字转写，不纠错。
export const P_OCR_1 = [
  '你是转写员，不是老师。把图片中的手写内容逐字转写为"中文 + $行内 LaTeX$"格式。',
  '规则：',
  '1. 只转写看到的内容。学生写错的地方照抄错的，不要纠正、不要补全、不要化简、不要改写成更规范的写法。',
  '2. 看不清的字符写成 ⍰。',
  '3. 中文照写；数学部分放在 $…$ 里；不要输出解释、不要输出 Markdown 代码块。',
  '4. 输出只有一行。',
].join('\n');

// 整页（拍照）：同样不纠错，但每行输出一行。
export const P_OCR_PAGE_1 = [
  '你是转写员，不是老师。把图片中的手写内容逐行转写为"中文 + $行内 LaTeX$"格式。',
  '规则：',
  '1. 只转写看到的内容。学生写错的地方照抄错的，不要纠正、不要补全、不要化简、不要改写成更规范的写法。',
  '2. 看不清的字符写成 ⍰。',
  '3. 中文照写；数学部分放在 $…$ 里；不要输出解释、不要输出 Markdown 代码块。',
  '4. 每个书写行输出一行，按从上到下的顺序，行与行之间用换行分隔。',
].join('\n');

export interface DashscopeInput {
  image: string;
  mime?: 'image/png' | 'image/jpeg';
  // 'line' 用 P-OCR-1；'page' 用整页提示词
  mode?: 'line' | 'page';
}

export interface DashscopeOutput extends Record<string, unknown> {
  text: string;
}

export interface InvokeDashscopeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  input: unknown;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  // 聊天输入用：false 时关闭思考（enable_thinking）
  thinking?: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildDashscopeRequest(model: string, input: unknown): Record<string, unknown> {
  if (!isRecord(input) || typeof input.image !== 'string' || input.image === '') throw new AdapterError('bad_input');
  const mime = input.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const prompt = input.mode === 'page' ? P_OCR_PAGE_1 : P_OCR_1;
  return {
    model,
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${input.image}` } }],
      },
    ],
  };
}

export function parseDashscopeResponse(json: unknown): DashscopeOutput {
  if (!isRecord(json) || !Array.isArray(json.choices)) throw new AdapterError('bad_response');
  const first: unknown = json.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== 'string') {
    throw new AdapterError('bad_response');
  }
  // 模型偶尔会包一层代码块；去掉围栏，保留内容本身
  const text = first.message.content.replace(/^```[a-z]*\n?|\n?```$/gi, '').trim();
  return { text };
}

// 按输入形态分发：{messages,…} 走聊天（求助回答、闸门复核、语义判定），{image,…} 走视觉转写。
export async function invokeDashscope(options: InvokeDashscopeOptions): Promise<DashscopeOutput | ChatOutput> {
  if (isChatInput(options.input)) {
    return invokeChat({ ...options, provider: 'dashscope', thinking: options.thinking ?? null });
  }
  const body = buildDashscopeRequest(options.model, options.input);
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
  return parseDashscopeResponse(json);
}
