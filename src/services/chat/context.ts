import { streamMessage } from '../api/client.js'
import { DEFAULT_MODEL } from '../api/types.js'
import { currentSystemPrompt, useSettings } from '../settings.js'
import { modelCaps } from '../modelCaps.js'
import { getReplyText } from './reply.js'
import { estimateTokens } from '../../utils/tokens.js'
import type { Message } from './types.js'

/**
 * 上下文窗口与自动压缩：按估算 token 衡量历史长度。
 * 估算口径见 utils/tokens（中日韩 1 字 1 token，其余 4 字符 1 token）。
 */
export { estimateTokens } from '../../utils/tokens.js'

/** 单条消息的估算量：正文 + 每条消息的协议开销 */
const MESSAGE_OVERHEAD = 6

export const messageTokens = (message: Message): number => {
  if (message.role === 'assistant') {
    return estimateTokens(getReplyText(message)) + MESSAGE_OVERHEAD
  }
  const files = message.files.map((file) => file.name).join(' ')
  return (
    estimateTokens(message.content) +
    estimateTokens(message.summary ?? '') +
    estimateTokens(files) +
    MESSAGE_OVERHEAD
  )
}

export const historyTokens = (history: Message[]): number =>
  history.reduce((total, message) => total + messageTokens(message), 0)

/** 从最新往回取，直到再加一条就超出预算；至少保留最新一条 */
export const fitTail = (history: Message[], budget: number): Message[] => {
  const kept: Message[] = []
  let used = 0
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]
    const size = messageTokens(message)
    if (kept.length > 0 && used + size > budget) {
      break
    }
    used += size
    kept.unshift(message)
  }
  return kept
}

/**
 * 自动压缩的摘要缓存：同一会话、同一段 head 内容只总结一次。
 * 自动压缩是「请求级」的，原来的实现每发一句都会把同一段历史重新总结一遍，
 * 长会话连续聊会白白多花 N 次模型调用。这里按「会话 + 内容指纹」缓存结果。
 */
const summaryCache = new Map<string, { signature: string; summary: string }>()
/** 最多记住多少个会话的摘要，避免长跑内存涨 */
const SUMMARY_CACHE_LIMIT = 20

/** head 的内容指纹：id / 角色 / 长度 / token 估算都参与，内容变了就失效 */
const signatureOf = (messages: Message[], extra = ''): string => {
  let hash = 2166136261
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  for (const message of messages) {
    const body = message.role === 'assistant' ? getReplyText(message) : message.content
    const summaryLength = message.role === 'user' ? (message.summary?.length ?? 0) : 0
    feed(`${message.id}|${message.role}|${body.length}|${summaryLength}|`)
    feed(String(messageTokens(message)))
  }
  feed(extra)
  return `${messages.length}:${(hash >>> 0).toString(36)}`
}

const cachedSummary = (key: string | undefined, signature: string): string | undefined => {
  if (!key) {
    return undefined
  }
  const hit = summaryCache.get(key)
  return hit?.signature === signature ? hit.summary : undefined
}

const rememberSummary = (key: string | undefined, signature: string, summary: string): void => {
  if (!key) {
    return
  }
  summaryCache.delete(key)
  summaryCache.set(key, { signature, summary })
  while (summaryCache.size > SUMMARY_CACHE_LIMIT) {
    const oldest = summaryCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    summaryCache.delete(oldest)
  }
}

/** 冒烟用：清掉缓存 */
export const clearSummaryCache = (): void => {
  summaryCache.clear()
}

/** 摘要提示：留下继续对话需要的信息，避免摘要本身再次膨胀 */
export const COMPACT_INSTRUCTION = `把下面这段对话压缩成一份简洁的中文摘要，供同一个助手在后续轮次继续对话时使用。
要求：保留用户的目标、已确认的决定、关键事实与数据、待办与未解决的问题；代码、命令、路径、文件名和报错原文按原样保留；去掉寒暄、重复内容和推理过程；用 Markdown 列表组织，控制在 400 字以内，不要任何前言或结语。`

/** 转录上限：超长时只把最近的部分交给模型 */
const TRANSCRIPT_LIMIT = 120_000

const messageText = (message: Message) => {
  if (message.role === 'assistant') {
    return getReplyText(message)
  }
  const files =
    message.files.length > 0 ? `[附件：${message.files.map((file) => file.name).join('、')}]` : ''
  return [message.content, files].filter(Boolean).join('\n')
}

/** 把待压缩的消息拼成转录；超长时从最早的部分开始丢弃 */
export const buildTranscript = (messages: Message[]) => {
  const text = messages
    .map((message) => {
      const body = messageText(message).trim()
      return body ? `${message.role === 'user' ? '用户' : '助手'}：${body}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return text.length > TRANSCRIPT_LIMIT ? text.slice(text.length - TRANSCRIPT_LIMIT) : text
}

/**
 * 单次摘要请求能带多少 token。
 * 之前把整段历史一次性塞进去，超长对话（例如 1.15M token）会直接
 * 报 `user input too long, 73808 tokens exceeds max 32768 tokens`；
 * 现在按模型输入上限的 6 折切片，留出指令与输出的余量。
 */
/** 没有硬上限记录的模型（如 flash）先用保守值，被服务端打回再自动减半 */
const SUMMARIZE_FALLBACK_HARD = 80_000

export const summarizeBudget = (): number => {
  const model = useSettings.getState().model ?? DEFAULT_MODEL
  const limit = modelCaps(model).inputLimit
  const hard = limit ?? SUMMARIZE_FALLBACK_HARD
  return Math.max(4_000, Math.floor(hard * 0.6))
}

/** 服务端明确拒绝「输入过长」时，把预算减半重试；记在内存里，后续整理直接用对的预算 */
const budgetOverrides = new Map<string, number>()

/** 冒烟与"换模型后重算"用：清掉减半后记住的预算 */
export const resetSummarizeBudgetOverrides = (): void => {
  budgetOverrides.clear()
}

const isTooLongError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /too long|exceeds max|context_length_exceeded|input length/i.test(message)
}

/** 把待压缩的消息按 token 预算切成多段；保证每段至少一条 */
export const planTranscriptChunks = (
  messages: Message[],
  budget = summarizeBudget()
): Message[][] => {
  const chunks: Message[][] = []
  let current: Message[] = []
  let tokens = 0
  for (const message of messages) {
    const cost = Math.max(1, messageTokens(message))
    if (current.length > 0 && tokens + cost > budget) {
      chunks.push(current)
      current = []
      tokens = 0
    }
    current.push(message)
    tokens += cost
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

/** 请模型把一段历史总结成摘要；调用方负责取消与错误处理 */
export const summarizeMessages = async (
  messages: Message[],
  options: {
    apiKey: string
    signal: AbortSignal
    previousSummary?: string
    /** 分段整理时回调（已完成段数 / 总段数），用于界面显示进度 */
    onProgress?: (done: number, total: number) => void
    /** 冒烟替换用；默认走真实接口 */
    send?: typeof streamMessage
  }
): Promise<string> => {
  const { apiKey, signal, previousSummary } = options
  const send = options.send ?? streamMessage
  const model = useSettings.getState().model ?? DEFAULT_MODEL
  let budget = budgetOverrides.get(model) ?? summarizeBudget()
  /** 模型真实上限比我们猜的小时，减半重来（摘要可重算，无需保留中间结果） */
  for (let attempt = 0; ; attempt++) {
    try {
      return await summarizeInChunks(messages, budget, send, { apiKey, signal, previousSummary, onProgress: options.onProgress })
    } catch (error) {
      const smaller = Math.floor(budget / 2)
      if (!isTooLongError(error) || attempt >= 4 || smaller < 2_000) {
        throw error
      }
      budget = smaller
      budgetOverrides.set(model, budget)
      options.onProgress?.(0, 0)
    }
  }
}

const summarizeInChunks = async (
  messages: Message[],
  budget: number,
  send: typeof streamMessage,
  options: {
    apiKey: string
    signal: AbortSignal
    previousSummary?: string
    onProgress?: (done: number, total: number) => void
  }
): Promise<string> => {
  const { apiKey, signal, previousSummary } = options
  const chunks = planTranscriptChunks(messages, budget)
  const total = chunks.length
  let carried = previousSummary?.trim() ?? ''
  let summary = carried
  let done = 0
  for (const chunk of chunks) {
    let piece = ''
    const events = send(
      apiKey,
      {
        model: useSettings.getState().model ?? DEFAULT_MODEL,
        system: currentSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              carried ? `此前已经压缩过的摘要：\n${carried}` : '',
              COMPACT_INSTRUCTION,
              buildTranscript(chunk),
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        thinking: { type: 'disabled' },
        safety_check: { level: 'high' },
        tools: [],
      },
      signal
    )
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        piece += event.delta.text
      }
    }
    const text = piece.trim()
    if (text) {
      summary = text
      // 下一段把这段的结果当作"已有摘要"接续，避免每段各说各话
      carried = text
    }
    done += 1
    options.onProgress?.(done, total)
  }
  return summary
}

/** 保留段第一条已有的摘要：再次压缩时一并交给模型接续 */
const leadingSummary = (messages: Message[]): string | undefined => {
  const first = messages[0]
  return first?.role === 'user' ? first.summary : undefined
}

/**
 * 把摘要挂到保留段上：第一条提问直接带上摘要，第一条是回答时在它前面补一条只含摘要的提问。
 * 这样摘要在请求里仍处在合法的一问一答位置上。
 */
const withSummary = (messages: Message[], summary: string): Message[] => {
  const first = messages[0]
  if (first?.role === 'user') {
    const merged = first.summary ? `${first.summary}\n\n${summary}` : summary
    return [{ ...first, summary: merged }, ...messages.slice(1)]
  }
  const synthetic: Message = {
    id: 'auto-compact-summary',
    role: 'user',
    content: '',
    files: [],
    createdAt: Date.now(),
    summary,
  }
  return [synthetic, ...messages]
}

/**
 * 发送前整理历史：
 * - 自动压缩开启且占用超过触发阈值时，先把更早的对话总结成摘要，只保留最近原文；
 * - 随后按上下文窗口裁掉最早的部分。
 * 摘要是请求级的，不改动会话记录；压缩失败时退回按窗口裁剪，不阻断本轮。
 */
export type PrepareContextOptions = {
  /** 会话 id：作为摘要缓存的键 */
  cacheKey?: string
  /** 测试注入：默认走真实模型调用 */
  summarize?: typeof summarizeMessages
}

export const prepareContext = async (
  history: Message[],
  apiKey: string,
  signal: AbortSignal,
  options: PrepareContextOptions = {}
): Promise<Message[]> => {
  const { contextWindow, autoCompact, compactThreshold, compactKeep } = useSettings.getState()
  if (contextWindow <= 0 || history.length === 0) {
    return history
  }
  let messages = history
  const threshold = (contextWindow * compactThreshold) / 100
  if (autoCompact && historyTokens(history) > threshold) {
    const keepBudget = Math.max(1, Math.round((contextWindow * compactKeep) / 100))
    const kept = fitTail(history, keepBudget)
    const head = history.slice(0, history.length - kept.length)
    if (head.length >= 2 && kept.length > 0) {
      // 保留段自带的旧摘要也参与指纹：手动压缩过之后不能复用旧结果
      const signature = signatureOf(head, leadingSummary(kept) ?? '')
      const reuse = cachedSummary(options.cacheKey, signature)
      if (reuse) {
        messages = withSummary(kept, reuse)
        return historyTokens(messages) > contextWindow ? fitTail(messages, contextWindow) : messages
      }
      try {
        const summarize = options.summarize ?? summarizeMessages
        const summary = await summarize(head, {
          apiKey,
          signal,
          previousSummary: leadingSummary(kept),
        })
        if (summary) {
          rememberSummary(options.cacheKey, signature, summary)
          messages = withSummary(kept, summary)
        }
      } catch {
        // 用户主动停止时按调用方的中止流程处理，其余错误退回纯裁剪。
        signal.throwIfAborted()
        messages = history
      }
    }
  }
  return historyTokens(messages) > contextWindow ? fitTail(messages, contextWindow) : messages
}
