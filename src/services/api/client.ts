import { translate, type TranslationMessage } from '../../i18n/index.js'
import { safeTruncate } from '../../utils/safeText.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import { streamOpenAiChat } from './openaiAdapter.js'
import { channelById } from '../channels.js'
import { useSettings } from '../settings.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__

/** 鉴权头集中在��处：API Key 走 Authorization: Bearer */
export const authHeaders = (credential: string): Record<string, string> => ({
  Authorization: `Bearer ${credential}`,
})
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

/** 错误正文里的信息最多展示这么多字：网关偶尔回一整页 HTML，原样塞进气泡会糊满屏 */
const ERROR_TEXT_LIMIT = 300

/** 网关/代理回的是网页而不是 JSON：取出标题当提示，比贴一整页标签有用 */
const gatewayTitle = (text: string): string | null => {
  if (!/^\s*<(?:!doctype|html)/i.test(text)) {
    return null
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim()
  return title || 'unexpected HTML response'
}

/** 兼容 FastAPI 风格的 `detail`：可能是字符串，也可能是 `[{ msg }]` 数组 */
const detailMessage = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return null
  }
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) =>
        typeof item === 'string'
          ? item
          : typeof item === 'object' && item && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : ''
      )
      .filter(Boolean)
    return parts.length > 0 ? parts.join('; ') : null
  }
  return null
}

/**
 * 解析失败响应。
 *
 * 依次尝试：`error.message` → `detail`（字符串或数组）→ 顶层 `message` → 原文。
 * 网页响应（网关拦截、登录页、代理错误页）取 `<title>`，避免把整页 HTML 塞进聊天。
 * 结果统一截到 300 字，长正文只留开头。
 */
const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  const html = gatewayTitle(text)
  if (html) {
    message = html
  } else {
    try {
      const body: unknown = JSON.parse(text)
      if (isErrorBody(body)) {
        message = body.error.message
      } else {
        const detail = detailMessage(body)
        const top =
          typeof body === 'object' && body !== null && 'message' in body
            ? (body as { message: unknown }).message
            : null
        if (detail) {
          message = detail
        } else if (typeof top === 'string' && top) {
          message = top
        }
      }
    } catch {
      // 非 JSON 响应体直接展示原文
    }
  }
  return new ApiError(kind, safeTruncate(message, ERROR_TEXT_LIMIT), response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: authHeaders(apiKey),
    signal,
  })
}

/**
 * 拉取服务端可用模型列表（不产生费用）。
 * 兼容两种常见返回：OpenAI 风格 { data: [{ id }] } 与 { models: [...] }；
 * 结构不认识或为空时抛错，由调用方退回内置列表。
 */
/** 账户余额（GET /user/balance，不产生费用）；结构不认识时返回 null */
export type AccountBalance = { currency: string; total: string; available: boolean }

export const fetchBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<AccountBalance | null> => {
  const response = await request(`${API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: authHeaders(apiKey),
    signal,
  })
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object') {
    return null
  }
  const record = body as {
    is_available?: unknown
    balance_infos?: unknown
  }
  const infos = Array.isArray(record.balance_infos) ? record.balance_infos : []
  const first = infos[0] as { currency?: unknown; total_balance?: unknown } | undefined
  if (!first) {
    return null
  }
  const total = typeof first.total_balance === 'string' ? first.total_balance : null
  if (total === null) {
    return null
  }
  return {
    currency: typeof first.currency === 'string' ? first.currency : 'CNY',
    total,
    available: record.is_available === true,
  }
}

/** 按指定渠道拉模型列表（模型选择器展开某个渠道时用） */
export const fetchModelsForChannel = async (
  channel: { baseUrl: string; apiKey: string },
  signal?: AbortSignal
): Promise<string[]> => {
  const origin = channel.baseUrl.replace(/\/+$/, '')
  /**
   * Base URL 填法各家不一：有的要带 `/v1`（OpenAI 系），有的本身就是完整前缀。
   * 先按填的试，404/405 再补一次 `/v1/models` —— 不然用户少写一段就只能看到「0 个模型」。
   */
  const candidates = origin.endsWith('/v1') ? [`${origin}/models`] : [`${origin}/models`, `${origin}/v1/models`]
  let response: Response | null = null
  let lastError: unknown = null
  for (const url of candidates) {
    try {
      const attempt = await request(url, {
        method: 'GET',
        headers: authHeaders(channel.apiKey),
        signal,
      })
      if (attempt.ok) {
        response = attempt
        break
      }
      lastError = new Error(`HTTP ${attempt.status}`)
    } catch (error) {
      lastError = error
      if (signal?.aborted) {
        throw error
      }
    }
  }
  if (!response) {
    // 把 HTTP 状态带进文案：只显示「0 个模型」用户不知道该改 Key 还是改地址
    const status = (lastError as { status?: number } | undefined)?.status
    const detail = lastError instanceof Error ? lastError.message : String(lastError ?? '')
    throw new Error(status ? `HTTP ${status}${detail ? ` · ${detail}` : ''}` : detail || 'models request failed')
  }
  const body: unknown = await response.json()
  const ids = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      ids.add(value.trim())
    }
  }
  const record = body as { data?: unknown; models?: unknown }
  if (Array.isArray(record.data)) {
    for (const item of record.data) {
      push((item as { id?: unknown })?.id)
    }
  }
  if (Array.isArray(record.models)) {
    record.models.forEach(push)
  }
  return [...ids]
}

/** 官方（DeepSeek）模型列表；自定义渠道用 fetchModelsForChannel */
export const fetchModels = async (apiKey: string, signal?: AbortSignal): Promise<string[]> => {
  const response = await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: authHeaders(apiKey),
    signal,
  })
  const body: unknown = await response.json()
  const ids = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      ids.add(value.trim())
    } else if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id?: unknown }).id
      if (typeof id === 'string' && id.trim()) {
        ids.add(id.trim())
      }
    }
  }
  if (body && typeof body === 'object') {
    const record = body as { data?: unknown; models?: unknown }
    for (const list of [record.data, record.models]) {
      if (Array.isArray(list)) {
        for (const item of list) {
          push(item)
        }
      }
    }
  }
  if (ids.size === 0) {
    throw new ApiError('protocol', 'no models in /models response')
  }
  return [...ids]
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  /**
   * 渠道分流：
   * - deepseek：走官方 Anthropic 兼容端点（原样）；
   * - 自定义 openai：交给适配层翻译成同一套事件；
   * - 自定义 anthropic：用同一个路径拼渠道地址即可；
   * - responses：暂不支持，直接报错而不是发一个对方不认识的结构。
   */
  const channel = channelById(useSettings.getState().activeChannel)
  const channelKey = channel.id === 'deepseek' ? apiKey : channel.apiKey || apiKey
  if (channel.id !== 'deepseek') {
    if (channel.protocol === 'openai') {
      // 思考强度映射到 OpenAI 的 reasoning_effort；关掉就不传（避免对方 400）
      // 档位：off / low / mid / high → OpenAI 的 reasoning_effort（low / medium / high）
      const depth = useSettings.getState().thinkingDepth
      const effort =
        depth === 'off' ? undefined : depth === 'low' ? 'low' : depth === 'mid' ? 'medium' : 'high'
      yield* streamOpenAiChat({
        baseUrl: channel.baseUrl,
        apiKey: channelKey,
        body,
        signal,
        ...(effort ? { reasoningEffort: effort } : {}),
      })
      return
    }
    if (channel.protocol === 'responses') {
      throw new ApiError('protocol', 'Responses 协议暂不支持，请改用 OpenAI 兼容或 Anthropic')
    }
    if (!channel.baseUrl.trim()) {
      throw new ApiError('protocol', '这个渠道还没填 Base URL')
    }
  }
  const messagesUrl =
    channel.id === 'deepseek'
      ? `${ANTHROPIC_BASE_URL}/messages`
      : `${channel.baseUrl.replace(/\/+$/, '')}/messages`
  const response = await request(messagesUrl, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(channelKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
