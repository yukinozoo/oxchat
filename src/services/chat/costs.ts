import * as db from './db.js'
import { getVisibleMessages } from './branches.js'
import { estimateCost, isPeakNow } from './pricing.js'
import { useChatStore } from './store.js'

/** 花费明细：把本机所有对话的用量按模型、日期和会话汇总 */
export type ModelCost = {
  model: string
  rounds: number
  input: number
  output: number
  cost: number
}

export type DayCost = {
  /** 本地日期，MM-DD */
  day: string
  /** 当天零点的时间戳，用于排序 */
  at: number
  cost: number
  rounds: number
}

export type SessionCost = {
  id: string
  title: string
  rounds: number
  cost: number
}

export type CostSummary = {
  total: number
  rounds: number
  input: number
  output: number
  /** 输入 token 的三段构成 */
  cacheHit: number
  cacheWrite: number
  cacheMiss: number
  today: number
  week: number
  peakCost: number
  offPeakCost: number
  models: ModelCost[]
  days: DayCost[]
  /** 花费最高的会话，已按金额降序 */
  sessions: SessionCost[]
  /** 有价格表覆盖的轮数；unknown 为不在价格表内的轮数 */
  pricedRounds: number
  unknownRounds: number
}

const DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

const dayKey = (time: number) => {
  const date = new Date(time)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const startOfDay = (time: number) => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const emptySummary = (): CostSummary => ({
  total: 0,
  rounds: 0,
  input: 0,
  output: 0,
  cacheHit: 0,
  cacheWrite: 0,
  cacheMiss: 0,
  today: 0,
  week: 0,
  peakCost: 0,
  offPeakCost: 0,
  models: [],
  days: [],
  sessions: [],
  pricedRounds: 0,
  unknownRounds: 0,
})

/**
 * 汇总本机全部会话的花费。
 * 逐个读会话（IndexedDB），每处理一批让出一次主线程，避免大历史卡住界面。
 */
export const collectCosts = async (): Promise<CostSummary> => {
  const summaries = useChatStore.getState().sessions
  const now = Date.now()
  const todayStart = startOfDay(now)
  const weekStart = todayStart - 6 * DAY_MS
  const dayBuckets = new Map<string, DayCost>()
  for (let index = DAYS - 1; index >= 0; index--) {
    const at = todayStart - index * DAY_MS
    dayBuckets.set(dayKey(at), { day: dayKey(at), at, cost: 0, rounds: 0 })
  }

  const summary = emptySummary()
  const models = new Map<string, ModelCost>()
  const sessions: SessionCost[] = []

  for (const [index, item] of summaries.entries()) {
    const session = await db.loadSession(item.id)
    if (!session) {
      continue
    }
    let sessionCost = 0
    let sessionRounds = 0
    for (const message of getVisibleMessages(session)) {
      if (message.role !== 'assistant' || !message.usage) {
        continue
      }
      const usage = message.usage
      const input = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
      const model = message.resolvedModel ?? message.model ?? '未知模型'
      const at = new Date(message.createdAt)
      const cost = estimateCost(
        {
          inputTokens: usage.input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          outputTokens: usage.output_tokens,
        },
        model,
        at
      )

      summary.rounds += 1
      summary.input += input
      summary.output += usage.output_tokens
      summary.cacheHit += usage.cache_read_input_tokens
      summary.cacheWrite += usage.cache_creation_input_tokens
      summary.cacheMiss += usage.input_tokens
      sessionRounds += 1
      if (message.createdAt >= weekStart) {
        summary.week += cost ?? 0
      }
      if (message.createdAt >= todayStart) {
        summary.today += cost ?? 0
      }
      if (cost === null) {
        summary.unknownRounds += 1
      } else {
        summary.pricedRounds += 1
        summary.total += cost
        sessionCost += cost
        if (isPeakNow(at)) {
          summary.peakCost += cost
        } else {
          summary.offPeakCost += cost
        }
      }
      const bucket = dayBuckets.get(dayKey(message.createdAt))
      if (bucket) {
        bucket.cost += cost ?? 0
        bucket.rounds += 1
      }
      const modelEntry = models.get(model) ?? { model, rounds: 0, input: 0, output: 0, cost: 0 }
      modelEntry.rounds += 1
      modelEntry.input += input
      modelEntry.output += usage.output_tokens
      modelEntry.cost += cost ?? 0
      models.set(model, modelEntry)
    }
    if (sessionRounds > 0) {
      sessions.push({
        id: session.id,
        title: session.title || item.title || '未命名对话',
        rounds: sessionRounds,
        cost: sessionCost,
      })
    }
    // 每 20 个会话让出一次主线程，历史很多时界面仍然可点
    if (index % 20 === 19) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  summary.models = [...models.values()].sort((a, b) => b.cost - a.cost)
  summary.days = [...dayBuckets.values()].sort((a, b) => a.at - b.at)
  summary.sessions = sessions.sort((a, b) => b.cost - a.cost).slice(0, 5)
  return summary
}
