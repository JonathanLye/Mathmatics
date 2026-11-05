// SimpleTex 识别适配器（03 §3.1、§3.3）。
// 鉴权：App ID / App Secret 签名（官方文档 doc.simpletex.cn/zh/api）。
//   sign = md5( 非文件表单字段 + timestamp + random-str + app-id 按 key 升序，key=value 以 & 连接，末尾追加 &secret=<APP_SECRET> )
//   请求头：app-id、random-str、timestamp、sign。密钥本身不进请求头、不进请求体。
// 适配器只抛原因码（见 errors.ts）：响应体与图片内容可能含学生手写内容，不进错误信息。
import { createHash, randomBytes } from 'node:crypto';

import { AdapterError } from './errors.ts';

export interface SimpleTexInput {
  // PNG/JPEG 的 base64（不含 data: 前缀）
  image: string;
  mime?: 'image/png' | 'image/jpeg';
  // 额外的非文件表单字段（会参与签名），如 simpletex_ocr 的 rec_mode
  fields?: Record<string, string>;
}

export interface SimpleTexOutput extends Record<string, unknown> {
  // latex_ocr / latex_ocr_turbo：LaTeX；simpletex_ocr(document)：Markdown
  text: string;
  confidence: number | null;
}

export interface InvokeSimpleTexOptions {
  baseUrl: string;
  appId: string;
  appSecret: string;
  endpoint: string;
  input: unknown;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  // 测试可注入以得到确定的签名
  now?: () => number;
  randomStr?: () => string;
}

const RANDOM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function defaultRandomStr(): string {
  const bytes = randomBytes(16);
  let out = '';
  for (const byte of bytes) out += RANDOM_CHARS[byte % RANDOM_CHARS.length];
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSimpleTexInput(input: unknown): Required<Pick<SimpleTexInput, 'image' | 'fields'>> & { mime: string } {
  if (!isRecord(input) || typeof input.image !== 'string' || input.image === '') throw new AdapterError('bad_input');
  const fields = input.fields;
  if (fields !== undefined && (!isRecord(fields) || !Object.values(fields).every((v) => typeof v === 'string'))) {
    throw new AdapterError('bad_input');
  }
  const mime = input.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return { image: input.image, fields: (fields as Record<string, string> | undefined) ?? {}, mime };
}

export function signSimpleTex(
  fields: Record<string, string>,
  auth: { appId: string; appSecret: string; timestamp: string; randomStr: string },
): string {
  const all: Record<string, string> = {
    ...fields,
    timestamp: auth.timestamp,
    'random-str': auth.randomStr,
    'app-id': auth.appId,
  };
  const joined = Object.keys(all)
    .sort()
    .map((key) => `${key}=${all[key]}`)
    .join('&');
  return createHash('md5').update(`${joined}&secret=${auth.appSecret}`).digest('hex');
}

// 响应：{ status: boolean, res: {...}, request_id }。
// latex_ocr / latex_ocr_turbo：res.latex + res.conf；空图返回 "[EMPTY]"。
// simpletex_ocr：document 模式返回 Markdown。字段名按官方文档的几种写法依次尝试，取不到则视为 bad_response。
export function parseSimpleTexResponse(json: unknown): SimpleTexOutput {
  if (!isRecord(json) || json.status !== true || !isRecord(json.res)) throw new AdapterError('bad_response');
  const res = json.res;
  const raw =
    typeof res.latex === 'string'
      ? res.latex
      : typeof res.content === 'string'
        ? res.content
        : typeof res.markdown === 'string'
          ? res.markdown
          : typeof res.info === 'string'
            ? res.info
            : null;
  if (raw === null) throw new AdapterError('bad_response');
  const text = raw.trim() === '[EMPTY]' ? '' : raw;
  const confidence = typeof res.conf === 'number' && Number.isFinite(res.conf) ? res.conf : null;
  return { text, confidence };
}

export async function invokeSimpleTex(options: InvokeSimpleTexOptions): Promise<SimpleTexOutput> {
  const parsed = parseSimpleTexInput(options.input);
  const timestamp = String(Math.floor((options.now ?? Date.now)() / 1000));
  const randomStr = (options.randomStr ?? defaultRandomStr)();
  const sign = signSimpleTex(parsed.fields, {
    appId: options.appId,
    appSecret: options.appSecret,
    timestamp,
    randomStr,
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(parsed.fields)) form.append(key, value);
  const bytes = Buffer.from(parsed.image, 'base64');
  form.append('file', new Blob([bytes], { type: parsed.mime }), parsed.mime === 'image/jpeg' ? 'line.jpg' : 'line.png');

  let response: Response;
  try {
    response = await options.fetchImpl(`${options.baseUrl}${options.endpoint}`, {
      method: 'POST',
      headers: { 'app-id': options.appId, 'random-str': randomStr, timestamp, sign },
      body: form,
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
  return parseSimpleTexResponse(json);
}
