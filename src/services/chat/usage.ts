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
export const summarizeUsage = (session: Session | undefined): SessionUsage | null => {
  if (!session) {
    return null
  }
  const messages = getVisibleMessages(session)
  if (messages.length === 0) {
    return null
  }
  let rounds = 0
  let input = 0
  let output = 0
  let cacheRead = 0
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

  const contextWindow = useSettings.getState().contextWindow
  const contextLimit = contextWindow > 0 ? contextWindow : CONTEXT_LIMIT
  const contextTokens = historyTokens(messages)
  return {
    rounds,
    input,
    output,
    cacheHitRate: input > 0 ? Math.round((cacheRead / input) * 100) : 0,
    contextTokens,
    contextPercent: Math.min(100, Math.round((contextTokens / contextLimit) * 100)),
    contextLimit,
    cost: costKnown ? cost : null,
    peak: isPeakNow(),
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

export const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`
  }
  return String(value)
}
