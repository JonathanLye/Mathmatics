/**
 * 真实接口的 fetch 封装（issue #24）。
 *
 * 契约真源：`packages/contracts/openapi.yaml`（servers: /api/v1）与 06-接口契约.md §1：
 * - 鉴权：HttpOnly + SameSite=Lax 会话 Cookie `pg_sid`，因此每个请求都必须 `credentials: 'include'`；
 * - CSRF：所有写请求（非 GET/HEAD）带 `X-Requested-With: proof-gym`（服务端 routes/api.ts 的 onRequest 钩子）；
 * - 并发：`If-Match: <stateVersion>` 可选，版本落后返回 409 STATE_STALE，detail.state 是最新状态；
 * - 幂等：`Idempotency-Key: <uuid>` 可选，24 小时内同键重放返回首次响应（带 Idempotent-Replayed: true）；
 * - 错误：统一 `{ error: { code, message, detail? } }`，message 可直接展示给学生。
 *
 * 这里只做「传输 + 错误分类」，不做任何业务判定；`api/client.ts` 负责把返回值映射成 state。
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** openapi Error.code 的全集 + 前端本地错误 NETWORK（fetch 抛异常，没有响应）。 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_IN_ROSTER'
  | 'INVALID_INVITE'
  | 'CONSENT_REQUIRED'
  | 'WRONG_LAYER'
  | 'LAYER_LOCKED'
  | 'STATE_STALE'
  | 'ATTEMPT_LOCKED'
  | 'ASSIGNMENT_CLOSED'
  | 'RECOG_NOT_CONFIRMED'
  | 'HINT_NOT_READY'
  | 'HINT_PREVIEW_EXPIRED'
  | 'BUDGET_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'PHOTO_DISABLED'
  | 'TEST_MODE_RESTRICTED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'VALIDATION_FAILED'
  | 'INTERNAL'
  | 'NETWORK'

/** 重试立刻能改善的错误：限流、上游/服务端暂时不可用、网络抖动。 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set(['RATE_LIMITED', 'UPSTREAM_UNAVAILABLE', 'INTERNAL', 'NETWORK'])
/** 重试不会改善、需要学生/客户端换做法的错误（ASSIGNMENT_CLOSED 明确为不可重试终态）。 */
const TERMINAL_CODES: ReadonlySet<string> = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CONSENT_REQUIRED',
  'NOT_IN_ROSTER',
  'INVALID_INVITE',
  'ASSIGNMENT_CLOSED',
  'ATTEMPT_LOCKED',
  'RECOG_NOT_CONFIRMED',
  'TEST_MODE_RESTRICTED',
  'PHOTO_DISABLED',
  'WRONG_LAYER',
  'LAYER_LOCKED',
  'HINT_NOT_READY',
  'HINT_PREVIEW_EXPIRED',
  'BUDGET_EXHAUSTED',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'NOT_FOUND',
])

export interface ApiErrorInit {
  status: number
  code: string
  message: string
  detail?: Record<string, unknown> | null
}

/** 服务端错误的前端形态：保留 code/status/detail，并标注「能不能重试」「是不是终态」。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: Record<string, unknown> | null
  readonly retryable: boolean
  readonly terminal: boolean

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.detail = init.detail ?? null
    this.retryable = RETRYABLE_CODES.has(init.code) || init.status === 429 || init.status >= 500
    this.terminal = TERMINAL_CODES.has(init.code)
  }

  /** 409 STATE_STALE 时服务端把最新状态放在 detail.state。 */
  get staleState(): unknown {
    return this.code === 'STATE_STALE' ? this.detail?.state : undefined
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** 把任意异常转成可展示的中文文案；服务端 message 可直接给学生看。 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  /** 期望的状态版本；服务端接受裸数字或带引号数字。 */
  ifMatch?: number | string
  /** 同一逻辑提交的重试必须复用同一个键（由调用方缓存）。 */
  idempotencyKey?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface HttpResult<T> {
  data: T
  status: number
  /** 本次响应是否来自 Idempotency-Key 重放（首次执行时为 false）。 */
  replayed: boolean
}

export interface HttpClient {
  request<T>(path: string, options?: RequestOptions): Promise<HttpResult<T>>
  get<T>(path: string, options?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResult<T>>
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResult<T>>
}

export interface HttpClientOptions {
  /** 默认 /api/v1；开发时可指向 http://127.0.0.1:3000/api/v1（需服务端 CORS 或同源反代）。 */
  base?: string
  fetchImpl?: FetchLike
}

const DEFAULT_BASE = '/api/v1'
const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function joinUrl(base: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path
  return `${normalizeBase(base)}${path.startsWith('/') ? '' : '/'}${path}`
}

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init)
}

const STATUS_FALLBACK: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: '请求格式不正确' },
  401: { code: 'UNAUTHORIZED', message: '请先登录' },
  403: { code: 'FORBIDDEN', message: '没有权限进行这个操作' },
  404: { code: 'NOT_FOUND', message: '请求的内容不存在' },
  409: { code: 'BAD_REQUEST', message: '操作冲突，请刷新后重试' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: '内容太大，请精简后重试' },
  422: { code: 'VALIDATION_FAILED', message: '提交内容不符合要求' },
  429: { code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试' },
}

function fallbackForStatus(status: number): { code: string; message: string } {
  if (status >= 500) return { code: 'INTERNAL', message: '服务暂时不可用，你的内容已保存' }
  return STATUS_FALLBACK[status] ?? { code: 'BAD_REQUEST', message: '请求失败，请稍后重试' }
}

interface ParsedErrorBody {
  code: string
  message: string
  detail: Record<string, unknown> | null
}

function parseErrorBody(raw: string, status: number): ParsedErrorBody {
  const fallback = fallbackForStatus(status)
  if (!raw) return { ...fallback, detail: null }
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown; detail?: unknown } } | null
    const error = parsed?.error
    if (!error || typeof error.code !== 'string') return { ...fallback, detail: null }
    return {
      code: error.code,
      message: typeof error.message === 'string' && error.message ? error.message : fallback.message,
      detail: error.detail !== null && typeof error.detail === 'object' ? (error.detail as Record<string, unknown>) : null,
    }
  } catch {
    return { ...fallback, detail: null }
  }
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function parseSuccess<T>(raw: string, status: number): T {
  if (status === 204 || raw.trim() === '') return undefined as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new ApiError({ status, code: 'INTERNAL', message: '服务端返回了无法解析的内容' })
  }
}

/** uuid v4：优先 Web Crypto，测试/老浏览器退回 Math.random。 */
export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const base = options.base ?? DEFAULT_BASE
  const fetchImpl = options.fetchImpl ?? defaultFetch

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<HttpResult<T>> {
    const method = requestOptions.method ?? 'GET'
    const headers: Record<string, string> = { Accept: 'application/json', ...(requestOptions.headers ?? {}) }
    if (WRITE_METHODS.has(method)) headers['X-Requested-With'] = 'proof-gym'
    if (requestOptions.body !== undefined) headers['Content-Type'] = 'application/json'
    if (requestOptions.ifMatch !== undefined) headers['If-Match'] = String(requestOptions.ifMatch)
    if (requestOptions.idempotencyKey !== undefined) {
      if (!isUuid(requestOptions.idempotencyKey)) {
        throw new ApiError({ status: 0, code: 'VALIDATION_FAILED', message: '幂等键需为 uuid' })
      }
      headers['Idempotency-Key'] = requestOptions.idempotencyKey
    }

    let response: Response
    try {
      response = await fetchImpl(joinUrl(base, path), {
        method,
        credentials: 'include',
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        signal: requestOptions.signal,
      })
    } catch (cause) {
      throw new ApiError({
        status: 0,
        code: 'NETWORK',
        message: '网络连接失败，检查网络后重试（内容已保存在本地草稿）',
        detail: { cause: cause instanceof Error ? cause.message : String(cause) },
      })
    }

    const replayed = response.headers.get('idempotent-replayed') === 'true'
    const raw = await readBody(response)
    if (!response.ok) {
      const parsed = parseErrorBody(raw, response.status)
      throw new ApiError({ status: response.status, code: parsed.code, message: parsed.message, detail: parsed.detail })
    }
    return { data: parseSuccess<T>(raw, response.status), status: response.status, replayed }
  }

  return {
    request,
    async get<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
      return (await request<T>(path, { ...requestOptions, method: 'GET' })).data
    },
    post<T>(path: string, body?: unknown, requestOptions: RequestOptions = {}): Promise<HttpResult<T>> {
      return request<T>(path, { ...requestOptions, method: 'POST', body })
    },
    patch<T>(path: string, body?: unknown, requestOptions: RequestOptions = {}): Promise<HttpResult<T>> {
      return request<T>(path, { ...requestOptions, method: 'PATCH', body })
    },
  }
}

/** 全局默认实例：同源 /api/v1。测试里用 `createHttpClient({ fetchImpl })` 注入假 fetch。 */
export const http = createHttpClient()
