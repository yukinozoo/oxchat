import { readServerSentEvents } from './sse.js'
import * as db from '../chat/db.js'
import type { CreateMessageRequest, MessageStreamEvent } from './types.js'

/**
 * OpenAI 兼容渠道的适配层：把 `/chat/completions` 的流式分片翻成
 * 我们内部使用的 Anthropic 风格事件，上层（store / 渲染）完全不用改。
 *
 * 只做纯文本对话：图片、工具调用、思考链这些 DeepSeek 专有能力在自定义渠道上先不支持，
 * 宁可少给，也不要发出一个对方不认识的字段导致 400。
 */
type OpenAiChunk = {
  choices?: {
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    finish_reason?: unknown
  }[]
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    prompt_tokens_details?: { cached_tokens?: unknown }
  }
}

/** Blob → data URL（OpenAI 兼容渠道要求 base64 或公网地址，本地附件只能走前者） */
const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const base64 = btoa(binary)
  return `data:${blob.type || 'image/jpeg'};base64,${base64}`
}

/**
 * 把内部消息体翻成 OpenAI 的 messages：
 * - 文本块直接拼；
 * - image 块用本地附件原件转 data URL（DeepSeek 的 file_id 对方用不了）；
 * - document 块暂不支持，丢弃（自定义渠道先限定纯文本 + 图片）。
 */
type LoadImage = (localId: string) => Promise<Blob | undefined>

/** 默认从本地附件库取原件；测试可注入替身，不依赖 IndexedDB */
const defaultLoadImage: LoadImage = (localId) => db.loadFile(localId)

const toOpenAiMessages = async (body: CreateMessageRequest, loadImage: LoadImage) => {
  const messages: { role: string; content: unknown }[] = []
  if (body.system.trim()) {
    messages.push({ role: 'system', content: body.system })
  }
  for (const message of body.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content })
      continue
    }
    const parts: unknown[] = []
    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push({ type: 'text', text: block.text })
        continue
      }
      if (block.type === 'image' && block.local_id) {
        const blob = await loadImage(block.local_id).catch(() => undefined)
        if (blob?.type.startsWith('image/')) {
          parts.push({ type: 'image_url', image_url: { url: await blobToDataUrl(blob) } })
        }
      }
    }
    const hasImage = parts.some(
      (part) => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'image_url'
    )
    const onlyText = parts.length > 0 && !hasImage
    messages.push({
      role: message.role,
      content: onlyText
        ? parts
            .map((part) => (part as { text?: string }).text ?? '')
            .join('')
        : parts,
    })
  }
  return messages
}

const textOf = (chunk: OpenAiChunk): string => {
  const content = chunk.choices?.[0]?.delta?.content
  return typeof content === 'string' ? content : ''
}

/** 思考链：DeepSeek 兼容端点用 reasoning_content，OpenRouter 一类用 reasoning */
const reasoningOf = (chunk: OpenAiChunk): string => {
  const delta = chunk.choices?.[0]?.delta
  if (!delta) {
    return ''
  }
  const value = delta.reasoning_content ?? delta.reasoning
  return typeof value === 'string' ? value : ''
}

const finishReason = (chunk: OpenAiChunk): string | null => {
  const reason = chunk.choices?.[0]?.finish_reason
  return typeof reason === 'string' ? reason : null
}

export async function* streamOpenAiChat(params: {
  baseUrl: string
  apiKey: string
  body: CreateMessageRequest
  signal: AbortSignal
  fetchImpl?: typeof fetch
  /** 读本地附件原件（测试注入用） */
  loadImage?: LoadImage
  /** 思考强度：openai 兼容网关普遍认 reasoning_effort；不传就不开 */
  reasoningEffort?: 'low' | 'medium' | 'high'
}): AsyncGenerator<MessageStreamEvent> {
  const { baseUrl, apiKey, body, signal } = params
  const doFetch = params.fetchImpl ?? fetch
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const messages = await toOpenAiMessages(body, params.loadImage ?? defaultLoadImage)
  const response = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: body.model,
      messages,
      stream: true,
      // 让服务端在最后一个分片里带用量（OpenAI 兼容实现普遍支持，不支持时会被忽略）
      stream_options: { include_usage: true },
      ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
      ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
      ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
    }),
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${detail.slice(0, 200)}`.trim())
  }

  yield {
    type: 'message_start',
    message: { id: `oa-${Date.now().toString(36)}`, model: body.model },
  }
  if (!response.body) {
    throw new Error('这个渠道没有返回流式响应体')
  }
  /** 块按内容懒开：先出思考就开 thinking 块，出正文再切到文本块 */
  let blockIndex = -1
  let blockKind: 'thinking' | 'text' | null = null
  let stopped = false
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let chunk: OpenAiChunk
    try {
      chunk = JSON.parse(data) as OpenAiChunk
    } catch {
      continue
    }
    const reasoning = reasoningOf(chunk)
    if (reasoning) {
      if (blockKind !== 'thinking') {
        blockIndex += 1
        blockKind = 'thinking'
        yield {
          type: 'content_block_start',
          index: blockIndex,
          // signature 由服务端下发，这里给空串占位（渲染只看 thinking 文本）
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    const text = textOf(chunk)
    if (text) {
      if (blockKind !== 'text') {
        if (blockKind !== null) {
          yield { type: 'content_block_stop', index: blockIndex }
        }
        blockIndex += 1
        blockKind = 'text'
        yield {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text } }
    }
    if (chunk.usage) {
      const cached = Number(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0) || 0
      const prompt = Number(chunk.usage.prompt_tokens ?? 0) || 0
      const completion = Number(chunk.usage.completion_tokens ?? 0) || 0
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: {
          input_tokens: Math.max(0, prompt - cached),
          cache_read_input_tokens: cached,
          cache_creation_input_tokens: 0,
          output_tokens: completion,
        },
      }
      stopped = true
    }
    const reason = finishReason(chunk)
    if (reason && !stopped) {
      yield {
        type: 'message_delta',
        delta: {
          stop_reason: reason === 'length' ? 'max_tokens' : 'end_turn',
          stop_sequence: null,
        },
      }
      stopped = true
    }
  }
  if (!stopped) {
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
  }
  if (blockKind === null) {
    // 空回答：也开一个空文本块，界面才有落点
    blockKind = 'text'
    blockIndex = 0
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
  }
  yield { type: 'content_block_stop', index: blockIndex }
  yield { type: 'message_stop' }
}
