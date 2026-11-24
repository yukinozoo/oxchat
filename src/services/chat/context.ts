import { streamMessage } from '../api/client.js'
import { DEFAULT_MODEL } from '../api/types.js'
import { currentSystemPrompt, useSettings } from '../settings.js'
import { modelCaps } from '../modelCaps.js'
import { getReplyText } from './reply.js'
import { estimateTokens } from '../../utils/tokens.js'
import type { FileAttachment, MemoryNote, Message, ReplyBlock } from './types.js'

/**
 * 上下文窗口与自动压缩：按估算 token 衡量历史长度。
 * 估算口径见 utils/tokens（中日韩 1 字 1 token，其余 4 字符 1 token）。
 */
export { estimateTokens } from '../../utils/tokens.js'

/** 单条消息的估算量：正文 + 每条消息的协议开销 */
const MESSAGE_OVERHEAD = 6

/** 一张图片按固定量估算：服务端按图像切片计费，与文件体积关系不大 */
const IMAGE_TOKENS = 1024

/**
 * 单个附件的估算量。
 *
 * 以前只把**文件名**算进去（一张图 ≈5 token），上下文圆环会严重低估，
 * 用户看到「才用了 20%」却被服务端拒收。图片给固定值，文档按字节折 token
 * （实测中文约 4~4.7 字节/token，除以 4 是保守估计）。
 */
export const fileTokens = (file: FileAttachment): number =>
  file.isImage ? IMAGE_TOKENS : Math.ceil(file.size / 4)

export const messageTokens = (message: Message): number => {
  if (message.role === 'assistant') {
    return estimateTokens(getReplyText(message)) + MESSAGE_OVERHEAD
  }
  const files = message.files.reduce((total, file) => total + fileTokens(file), 0)
  return (
    estimateTokens(message.content) +
    estimateTokens(message.summary ?? '') +
    files +
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

/**
 * 摘要篇幅分档：待折叠的历史越大，允许的笔记越长。
 * 以前一律 400 字 —— 200 轮对话压成 400 字，等于把上下文扔了。
 */
export const noteLimitFor = (headTokens: number): number => {
  if (headTokens > 150_000) {
    return 6_500
  }
  if (headTokens > 60_000) {
    return 4_500
  }
  if (headTokens > 20_000) {
    return 2_400
  }
  return 1_000
}

/** 摘要提示：留下继续对话需要的信息，避免摘要本身再次膨胀 */
export const compactInstruction = (limitChars = 1_000): string =>
  `把下面这段对话压缩成一份简洁的中文摘要，供同一个助手在后续轮次继续对话时使用。
要求：保留用户的目标、已确认的决定、关键事实与数据、待办与未解决的问题；代码、命令、路径、文件名和报错原文按原样保留；去掉寒暄、重复内容和推理过程；用 Markdown 列表组织，每条一个要点，整体控制在 ${limitChars} 字以内，不要任何前言或结语。`

export const COMPACT_INSTRUCTION = compactInstruction()

/** 转录上限：超长时只把最近的部分交给模型 */
const TRANSCRIPT_LIMIT = 120_000


/** 转录里每个附件最多带多少字的内容节选 */
const EXCERPT_PER_FILE = 800
/** 整段转录里所有节选加起来的上限 */
const EXCERPT_TOTAL = 2_000
/** 一条消息里最多列几条工具结果 */
const TOOL_LINES = 6

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * 工具调用的「结论摘要」：只留查询词与结果标题，不带网页正文。
 *
 * 联网搜索/读网页的原始结果本来就不会进摘要（`getReplyText` 只取 text 块），
 * 长对话压缩之后用户就再也说不出「当时查了什么、结论出自哪」。
 * 这里补上查询与标题清单，正文仍旧不带，避免摘要被几十条链接撑爆。
 */
const toolDigest = (blocks: readonly ReplyBlock[]): string => {
  const lines: string[] = []
  for (const block of blocks) {
    if (lines.length >= TOOL_LINES) {
      break
    }
    if (block.type === 'server_tool_use') {
      const input = block.input as { query?: unknown } | null | undefined
      const query = typeof input?.query === 'string' ? input.query.trim() : ''
      if (query) {
        lines.push(`〔联网搜索〕${query}`)
      }
      continue
    }
    if (block.type === 'web_search_tool_result') {
      for (const item of block.content) {
        if (lines.length >= TOOL_LINES) {
          break
        }
        if (item.type !== 'web_search_result') {
          continue
        }
        lines.push(`· ${item.title}（${hostOf(item.url)}）`)
      }
      continue
    }
    if (block.type === 'web_fetch_tool_result') {
      const title = 'content' in block ? (block.content as { title?: string | null }).title : null
      const url = 'url' in block && typeof block.url === 'string' ? block.url : ''
      lines.push(`· ${title || url || '网页结果'}${url ? `（${hostOf(url)}）` : ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * 把待压缩的消息拼成转录；超长时从最早的部分开始丢弃。
 *
 * 带上两类「原本会丢」的信息：
 * - 附件正文节选（`excerpts`，键是 Files API 的 file_id）——文档压缩后模型还能知道要点；
 * - 工具结论（搜索词 + 结果标题）——能看出当时查过什么。
 */
export const buildTranscript = (
  messages: Message[],
  excerpts?: ReadonlyMap<string, string>
): string => {
  let excerptBudget = EXCERPT_TOTAL
  const parts: string[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = getReplyText(message).trim()
      const tools = toolDigest(message.blocks)
      const body = [text, tools].filter(Boolean).join('\n')
      if (body) {
        parts.push(`助手：${body}`)
      }
      continue
    }
    const body = message.content.trim()
    const files = message.files.length
      ? message.files.map((file) => `[附件：${file.name}]`).join('\n')
      : ''
    const line = [body, files].filter(Boolean).join('\n')
    if (line) {
      parts.push(`用户：${line}`)
    }
    for (const file of message.files.slice(0, 3)) {
      if (excerptBudget <= 0) {
        break
      }
      const text = file.serverId ? excerpts?.get(file.serverId) : undefined
      if (!text) {
        continue
      }
      const take = Math.min(EXCERPT_PER_FILE, excerptBudget, text.length)
      if (take <= 0) {
        continue
      }
      parts.push(`〔附件《${file.name}》内容节选〕${text.slice(0, take)}`)
      excerptBudget -= take
    }
  }
  const text = parts.join('\n\n')
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

export const summarizeBudget = (override?: string): number => {
  const model = override || useSettings.getState().model || DEFAULT_MODEL
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

export const isTooLongError = (error: unknown): boolean => {
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
    /** 已经记住的要点：整理时喂回模型，避免二次整理把第一批记忆丢掉 */
    existingNotes?: readonly MemoryNote[]
    /** 摘要字数上限（按待折叠历史的规模分档，见 noteLimitFor） */
    limitChars?: number
    /** 用户为本会话写的整理要求（例如「只保留技术细节」），拼进提示词 */
    instruction?: string
    /** 摘要模板的完整提示词；有就取代默认规则（{target_chars} 已在调用方替换） */
    templatePrompt?: string
    /** 附件正文节选：键是 Files API 的 file_id，压缩时拼进转录 */
    excerpts?: ReadonlyMap<string, string>
    /** 分段整理时回调（已完成段数 / 总段数），用于界面显示进度 */
    onProgress?: (done: number, total: number) => void
    /** 指定摘要用的模型；不传则跟随当前对话模型 */
    model?: string
    /** 总输出上限（token）；0 / 不传表示交给服务端默认 */
    maxTokens?: number
    /** 冒烟替换用；默认走真实接口 */
    send?: typeof streamMessage
  }
): Promise<string> => {
  const { apiKey, signal, previousSummary } = options
  const send = options.send ?? streamMessage
  const model = options.model || useSettings.getState().model || DEFAULT_MODEL
  let budget = budgetOverrides.get(model) ?? summarizeBudget(model)
  /** 模型真实上限比我们猜的小时，减半重来（摘要可重算，无需保留中间结果） */
  for (let attempt = 0; ; attempt++) {
    try {
      return await summarizeInChunks(messages, budget, send, {
        apiKey,
        signal,
        previousSummary,
        existingNotes: options.existingNotes,
        limitChars: options.limitChars,
        instruction: options.instruction,
        templatePrompt: options.templatePrompt,
        excerpts: options.excerpts,
        onProgress: options.onProgress,
        model,
        maxTokens: options.maxTokens,
      })
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

/** 单段请求的超时：给长转录更多时间，但最多 10 分钟，避免一次卡死拖住整个整理 */
const chunkTimeoutMs = (transcriptLength: number) =>
  Math.min(600_000, 120_000 + transcriptLength * 2)

/** 转录超过预算时保留尾部（最近的内容更重要），前面标一句省略说明 */
export const cutTranscript = (transcript: string, budgetTokens: number): string => {
  const tokens = estimateTokens(transcript)
  if (tokens <= budgetTokens) {
    return transcript
  }
  const keep = Math.max(1, Math.floor((transcript.length * budgetTokens) / tokens))
  return `（前文过长已省略）\n${transcript.slice(transcript.length - keep)}`
}

const summarizeInChunks = async (
  messages: Message[],
  budget: number,
  send: typeof streamMessage,
  options: {
    apiKey: string
    signal: AbortSignal
    previousSummary?: string
    existingNotes?: readonly MemoryNote[]
    limitChars?: number
    instruction?: string
    templatePrompt?: string
    excerpts?: ReadonlyMap<string, string>
    onProgress?: (done: number, total: number) => void
    model: string
    maxTokens?: number
  }
): Promise<string> => {
  const { apiKey, signal, previousSummary } = options
  // 选了模板就用模板的完整提示词，没选才用默认通用规则
  const instruction =
    options.templatePrompt?.trim() || compactInstruction(options.limitChars ?? 1_000)
  /** 用户自己写的整理要求：优先级高于默认规则，放在提示词最前面 */
  const userRequirement = options.instruction?.trim()
    ? `用户对这次整理的额外要求（优先遵守）：\n${options.instruction.trim()}`
    : ''
  /** 已有笔记：作为「已经记住」的锚点，让模型在此基础上补充而不是另起一套 */
  const notesBlock =
    options.existingNotes && options.existingNotes.length > 0
      ? `已经记住的要点（新摘要要在这些基础上补充，已有的结论不要遗漏）：\n${options.existingNotes
          .map((note) => `- ${note.text}`)
          .join('\n')}`
      : ''
  /** 队列而不是 for-of：撞到"输入过长"时把当前段对半切开插回队首重试，
      已经成功折叠的段不受影响，不用整轮重跑 */
  const queue = planTranscriptChunks(messages, budget)
  let total = queue.length
  let effectiveBudget = budget
  let splits = 0
  let carried = previousSummary?.trim() ?? ''
  let summary = carried
  let done = 0

  while (queue.length > 0) {
    const chunk = queue.shift()
    if (!chunk) {
      break
    }
    const transcript = cutTranscript(buildTranscript(chunk, options.excerpts), effectiveBudget)
    const controller = new AbortController()
    const onOuterAbort = () => controller.abort()
    signal.addEventListener('abort', onOuterAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), chunkTimeoutMs(transcript.length))
    let piece = ''
    try {
      const events = send(
        apiKey,
        {
          model: options.model,
          system: currentSystemPrompt(),
          ...(options.maxTokens && options.maxTokens > 0
            ? { max_tokens: options.maxTokens }
            : {}),
          messages: [
            {
              role: 'user',
              content: [
                carried ? `此前已经压缩过的摘要：\n${carried}` : '',
                notesBlock,
                userRequirement,
                instruction,
                transcript,
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
          thinking: { type: 'disabled' },
          safety_check: { level: 'high' },
          tools: [],
        },
        controller.signal
      )
      for await (const event of events) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          piece += event.delta.text
        }
      }
    } catch (error) {
      // 400 + 超长：只把这一段对半切开重试，并把后续段预算减半（最多拆 20 次）
      if (isTooLongError(error) && chunk.length > 1 && splits < 20) {
        splits += 1
        total += 1
        effectiveBudget = Math.max(4_000, Math.floor(effectiveBudget / 2))
        const half = Math.ceil(chunk.length / 2)
        queue.unshift(chunk.slice(half))
        queue.unshift(chunk.slice(0, half))
        options.onProgress?.(done, total)
        continue
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onOuterAbort)
    }
    const text = piece.trim()
    if (text) {
      summary = text
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

/** 保留最近 N 轮原文（一轮 = 一条提问 + 它后面的回复） */
const keepLastRounds = (history: Message[], rounds: number): Message[] => {
  const count = Math.max(1, Math.round(rounds))
  let seen = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === 'user') {
      seen += 1
      if (seen === count) {
        return history.slice(index)
      }
    }
  }
  return [...history]
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
  /** 本会话的自动压缩开关；缺省时用设置里的全局值 */
  autoCompact?: boolean
}

export const prepareContext = async (
  history: Message[],
  apiKey: string,
  signal: AbortSignal,
  options: PrepareContextOptions = {}
): Promise<Message[]> => {
  const { contextWindow, compactThreshold, compactKeep, compactKeepRounds } =
    useSettings.getState()
  // 自动压缩按会话开关：面板里关掉就只影响这条对话，没设置过才回落到全局默认
  const autoCompact = options.autoCompact ?? useSettings.getState().autoCompact
  if (contextWindow <= 0 || history.length === 0) {
    return history
  }
  let messages = history
  const threshold = (contextWindow * compactThreshold) / 100
  if (autoCompact && historyTokens(history) > threshold) {
    // 保留策略与压缩面板一致：先按「最近 N 轮」留原文；轮数兜不住（对话太短）时退回 token 预算
    let kept = keepLastRounds(history, compactKeepRounds)
    let head = history.slice(0, history.length - kept.length)
    if (head.length < 2) {
      const keepBudget = Math.max(1, Math.round((contextWindow * compactKeep) / 100))
      kept = fitTail(history, keepBudget)
      head = history.slice(0, history.length - kept.length)
    }
    // token 兜底：保留段超过窗口一半时再往回收，避免压完立刻二次触发
    if (historyTokens(kept) > contextWindow * 0.5) {
      kept = fitTail(kept, Math.max(1, Math.round(contextWindow * 0.35)))
    }
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
