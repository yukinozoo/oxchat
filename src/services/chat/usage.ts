import { useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import { historyTokens } from './context.js'
import { estimateCost, isPeakNow } from './pricing.js'
import type { Session } from './types.js'

/** 上下文窗口的兜底上限：设置里选「不限」或没设置时按官方标注的 1M 算 */
export const CONTEXT_LIMIT = 1_000_000

export type SessionUsage = {
  /** 参与统计的回答轮数 */
  rounds: number
  /** 累计输入（含缓存读取与写入） */
  input: number
  /** 累计输出 */
  output: number
  /** 累计缓存读取（命中缓存的部分） */
  cacheRead: number
  /** 累计缓存写入 */
  cacheWrite: number
  /** 缓存命中率，0-100；没有输入时为 0 */
  cacheHitRate: number
  /** 下次请求大概会带的上下文（历史 token 估算，含压缩摘要） */
  contextTokens: number
  /** 上下文进度，0-100 */
  contextPercent: number
  /** 用于计算进度的窗口上限：跟随设置，选「不限」时为 CONTEXT_LIMIT */
  contextLimit: number
  /** 累计花费（元），按官方价格表估算；模型不在表里时为 null */
  cost: number | null
  /** 当前是否高峰时段（价格翻倍） */
  peak: boolean
  /** 统计用到的模型名 */
  model: string | null
}

/**
 * 从会话消息里汇总用量。
 *
 * 上下文进度按「下次请求会发多少」算：历史 token 估算（含压缩摘要），
 * 分母跟随设置里的上下文窗口 —— 之前写死 1M，窗口调小后进度会严重偏低。
 * 没有任何消息时返回 null；有消息但没有 usage（例如刚导入）也要返回，进度条才有意义。
 */
/** 汇总结果里与时间无关的那部分（缓存它） */
type UsageCore = Omit<SessionUsage, 'contextPercent' | 'peak'>

/**
 * 汇总缓存。
 *
 * 圆环、用量面板、消息脚注都会调 summarizeUsage，而它要遍历整条会话的消息。
 * 会话是不可变更新的（每次改动换新对象），所以直接拿 session 当 WeakMap 键：
 * 同一份会话对象第二次调用就是一次 Map 查找，长会话输入时不会每帧重算。
 * 窗口上限变了要失效，所以把 contextWindow 一起存下来比对。
 */
const coreCache = new WeakMap<Session, { contextWindow: number; core: UsageCore | null }>()

export const summarizeUsage = (session: Session | undefined): SessionUsage | null => {
  if (!session) {
    return null
  }
  const contextWindow = useSettings.getState().contextWindow
  const cached = coreCache.get(session)
  if (cached && cached.contextWindow === contextWindow) {
    return cached.core === null ? null : finishUsage(cached.core)
  }
  const core = computeUsageCore(session, contextWindow)
  coreCache.set(session, { contextWindow, core })
  return core === null ? null : finishUsage(core)
}

/** 补上随时间和窗口变化的两项（百分比与高峰标记每次现算，不缓存） */
const finishUsage = (core: UsageCore): SessionUsage => ({
  ...core,
  contextPercent: Math.min(100, Math.round((core.contextTokens / core.contextLimit) * 100)),
  peak: isPeakNow(),
})

const computeUsageCore = (session: Session, contextWindow: number): UsageCore | null => {
  const messages = getVisibleMessages(session)
  if (messages.length === 0) {
    return null
  }
  let rounds = 0
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cost = 0
  let costKnown = false
  let model: string | null = null

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.usage) {
      continue
    }
    const usage = message.usage
    rounds += 1
    const inputSum =
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    input += inputSum
    output += usage.output_tokens
    cacheRead += usage.cache_read_input_tokens
    cacheWrite += usage.cache_creation_input_tokens
    model = message.resolvedModel ?? message.model ?? model
    const messageCost = estimateCost(
      {
        inputTokens: usage.input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        outputTokens: usage.output_tokens,
      },
      message.resolvedModel ?? message.model
    )
    if (messageCost !== null) {
      cost += messageCost
      costKnown = true
    }
  }

  const contextLimit = contextWindow > 0 ? contextWindow : CONTEXT_LIMIT
  return {
    rounds,
    input,
    output,
    cacheRead,
    cacheWrite,
    cacheHitRate: input > 0 ? Math.round((cacheRead / input) * 100) : 0,
    contextTokens: historyTokens(messages),
    contextLimit,
    cost: costKnown ? cost : null,
    model,
  }
}

/** 大数字缩写：194.21M / 389K */
/** 一条回复的用量摘要：总输入 = 未命中 + 缓存写入 + 缓存命中 */
export const usageSummary = (usage: {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
}) => ({
  input: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
  cached: usage.cache_read_input_tokens,
  output: usage.output_tokens,
})

/**
 * token → 「约多少字」。
 * 口径与 utils/tokens 一致（中文 1 字 ≈ 1 token），所以这里直接当字数用；
 * 用户对"还能写多少字"比对"还剩多少 token"更有直觉。
 */
export const formatCharCount = (tokens: number): string => {
  if (tokens >= 10_000) {
    return `${(tokens / 10_000).toFixed(1)} 万字`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)} 千字`
  }
  return `${tokens} 字`
}

export const formatTokens = (value: number): string => {
  // 99.96 万这类值四舍五入会变成「1000K」，看起来像超了窗口，统一进位写成 M
  if (value >= 1_000_000 || value >= 999_500) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`
  }
  return String(value)
}
