// Jev（TypeSafe）决策模型的请求形态，见 09 §4.1。
// Jev 只看数学文本。输入逐字段挑选后才进请求体，身份信息（学生、作答、班级）即使被传进来也不会出现在请求里。
import { AdapterError } from './errors.ts';

export interface JevStepInput {
  problem: string;
  previousLines: string[];
  currentLine: { statement: string; justification?: string };
  // 选项说明来自题目包 keys[].jev / errors[].jev（教师审核过，不含可照写的式子）
  instructions: string;
  criteria: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJevInput(input: unknown): JevStepInput {
  if (!isRecord(input)) throw new AdapterError('bad_input');
  const { problem, previousLines, currentLine, instructions, criteria } = input;
  if (typeof problem !== 'string') throw new AdapterError('bad_input');
  if (!Array.isArray(previousLines) || !previousLines.every((line) => typeof line === 'string')) {
    throw new AdapterError('bad_input');
  }
  if (!isRecord(currentLine) || typeof currentLine.statement !== 'string') throw new AdapterError('bad_input');
  if (currentLine.justification !== undefined && typeof currentLine.justification !== 'string') {
    throw new AdapterError('bad_input');
  }
  if (typeof instructions !== 'string') throw new AdapterError('bad_input');
  if (!isRecord(criteria) || !Object.values(criteria).every((text) => typeof text === 'string')) {
    throw new AdapterError('bad_input');
  }
  return {
    problem,
    previousLines,
    currentLine: { statement: currentLine.statement, justification: currentLine.justification },
    instructions,
    criteria: criteria as Record<string, string>,
  };
}

export function buildJevRequest(modelName: string, input: unknown): Record<string, unknown> {
  const parsed = parseJevInput(input);
  return {
    model: modelName,
    state: {
      problem: parsed.problem,
      previous_lines: parsed.previousLines,
      current_line: { statement: parsed.currentLine.statement, justification: parsed.currentLine.justification },
    },
    questions: {
      step: { type: 'choice', instructions: parsed.instructions, criteria: parsed.criteria },
    },
  };
}

export interface InvokeJevOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  input: unknown;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}

// POST {baseUrl}/v1/systemone（09 §4.1）。
// 注意：请求字段名与鉴权方式、响应结构尚未对照 TypeSafe 官方文档（没有凭据，也不能联网核对）。响应按 JSON 对象原样返回。
export async function invokeJev(options: InvokeJevOptions): Promise<Record<string, unknown>> {
  const body = buildJevRequest(options.model, options.input);
  let response: Response;
  try {
    response = await options.fetchImpl(`${options.baseUrl}/v1/systemone`, {
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
  if (!isRecord(json)) throw new AdapterError('bad_response');
  return json;
}
