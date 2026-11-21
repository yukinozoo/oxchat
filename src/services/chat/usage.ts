import { getVisibleMessages } from './branches.js'
import { estimateCost, isPeakNow } from './pricing.js'
import type { Session } from './types.js'

/** 上下文窗口上限：官方文档标注为 1M */
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
  /** 最近一轮请求的输入量，作为"下次请求上下文"的估算 */
  contextTokens: number
  /** 上下文进度，0-100 */
  contextPercent: number
  /** 累计花费（元），按官方价格表估算；模型不在表里时为 null */
  cost: number | null
  /** 当前是否高峰时段（价格翻倍） */
  peak: boolean
  /** 统计用到的模型名 */
  model: string | null
}

/** 从会话消息里汇总用量；没有回答或没有 usage 时返回 null（不显示进度环） */
export const summarizeUsage = (session: Session | undefined): SessionUsage | null => {
  if (!session) {
    return null
  }
  const messages = getVisibleMessages(session)
  let rounds = 0
  let input = 0
  let output = 0
  let cacheRead = 0
  let contextTokens = 0
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
    // 最后一轮即最近一次真实请求的输入量
    contextTokens = inputSum
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

  if (rounds === 0) {
    return null
  }
  return {
    rounds,
    input,
    output,
    cacheHitRate: input > 0 ? Math.round((cacheRead / input) * 100) : 0,
    contextTokens,
    contextPercent: Math.min(100, Math.round((contextTokens / CONTEXT_LIMIT) * 100)),
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
