import { messageTokens } from './context.js'
import { contextMessages } from './memory.js'
import type { Message, Session } from './types.js'

/**
 * 压缩的分界线：**最近一段**问答原样保留，更早的消息交给模型总结成笔记后折叠。
 *
 * 以前保留的是「最后一轮」——200 轮对话点一次整理，上下文里就只剩 2 条消息，
 * 模型立刻「失忆」，用户体感是「越整理越笨」。现在按 token 留一个窗口：
 * 至少 MIN_KEEP_ROUNDS 轮，最多到 keepTokens 预算；再往前才折叠。
 *
 * 估算口径用 utils/tokens（中日韩 1 字 1 token，其余 4 字符 1 token），
 * 比真实值偏高，也就是实际保留得更多 —— 方向上是安全的。
 */
export type CompactPlan = {
  /** 将被摘要并折叠的消息 */
  head: Message[]
  /** 保留的消息；「全部历史」模式下为空 */
  tail: Message[]
}

/**
 * 压缩范围（面板里的四选一）：
 * - keepRecent：留最近 N 轮原文，更早的收成摘要（默认）
 * - all：全部收成摘要，不单独保留最近原文
 * - earlier：在字数限制内，挑最早的完整轮次压缩
 * - nearer：在字数限制内，挑最近的完整轮次压缩
 */
export type CompactScope = 'keepRecent' | 'all' | 'earlier' | 'nearer'

export type CompactOptions = {
  /** 旧口径：按 token 预算留最近一段，未指定 scope 时使用 */
  keepTokens?: number
  scope?: CompactScope
  /** keepRecent 用：保留最近轮数 */
  keepRounds?: number
  /** earlier / nearer 用：本次压缩的字数限制 */
  compactChars?: number
}

export const DEFAULT_KEEP_ROUNDS = 6
export const DEFAULT_COMPACT_CHARS = 6_000

/** 自动整理（水位到点自己触发）保留的窗口 */
export const KEEP_TOKENS_AUTO = 36_000
/** 手动点「立即整理」时留得少一些：用户主动要求压缩，通常是想腾地方 */
export const KEEP_TOKENS_MANUAL = 18_000
/** 预算允许时希望至少留这么多轮（预算装不下时不硬留，否则发送必然超长） */
export const MIN_KEEP_ROUNDS = 3

/** 把消息按「一轮问答」分组；末尾没回答的提问自成一"轮" */
const toRounds = (path: readonly Message[]): Message[][] => {
  const rounds: Message[][] = []
  for (const message of path) {
    if (message.role === 'user') {
      rounds.push([message])
    } else if (rounds.length === 0) {
      // 极端情况：会话以 assistant 开头（导入的历史可能有），单独成组
      rounds.push([message])
    } else {
      rounds.at(-1)?.push(message)
    }
  }
  return rounds
}

const roundTokens = (round: readonly Message[]): number =>
  round.reduce((total, message) => total + messageTokens(message), 0)

/**
 * 按 token 预算决定「留多少、折多少」。
 *
 * 从最新一轮往回累加：预算够就继续留；即使预算不够，也至少留 MIN_KEEP_ROUNDS 轮
 * （宁可多留，也不要让模型瞬间失去上下文）。整轮切分保证提问/回答不会被拆开。
 */
export const splitFoldableRounds = (
  path: readonly Message[],
  keepTokens: number
): CompactPlan => {
  const rounds = toRounds(path)
  if (rounds.length === 0) {
    return { head: [], tail: [] }
  }
  let kept = 0
  let tokens = 0
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const cost = roundTokens(rounds[index])
    // 再加这一轮就超预算 → 停（末尾没回答的提问永远保留，见下面的兜底）
    if (tokens + cost > keepTokens) {
      break
    }
    tokens += cost
    kept += 1
  }
  // 单轮就超预算时也要留最后一轮：一行不留等于让模型彻底失忆
  if (kept === 0) {
    kept = 1
  }
  const keepFrom = rounds.length - kept
  const tail = rounds.slice(keepFrom).flat()
  const head = rounds.slice(0, keepFrom).flat()
  if (head.length < 2 || tail[0]?.role !== 'user') {
    return { head: [], tail: [...path] }
  }
  return { head, tail }
}

/** 一条消息的字数（用户看的是字数，不是 token） */
const messageChars = (message: Message): number => {
  if (message.role === 'user') {
    return message.content.length + message.files.length * 12
  }
  return message.blocks.reduce((total, block) => {
    if (block.type === 'text') {
      return total + block.text.length
    }
    if (block.type === 'thinking') {
      return total + block.thinking.length
    }
    return total
  }, 0)
}

const roundsChars = (rounds: readonly Message[]): number =>
  rounds.reduce((total, message) => total + messageChars(message), 0)

/** 按轮次下标切开：前 cut 轮进 head（折叠），其余进 tail（保留） */
const splitAt = (rounds: Message[][], cut: number): CompactPlan => ({
  head: rounds.slice(0, cut).flat(),
  tail: rounds.slice(cut).flat(),
})

/** 校验：压缩段至少两条消息，保留段要么为空、要么以提问开头 */
const validPlan = (plan: CompactPlan, path: readonly Message[]): CompactPlan => {
  const ok =
    plan.head.length >= 2 && (plan.tail.length === 0 || plan.tail[0]?.role === 'user')
  return ok ? plan : { head: [], tail: [...path] }
}

/** 按面板里的四种范围规划；不合法时退回「不压缩」 */
export const planByScope = (path: readonly Message[], options: CompactOptions): CompactPlan => {
  const scope = options.scope ?? 'keepRecent'
  const rounds = toRounds(path)
  if (rounds.length === 0) {
    return { head: [], tail: [] }
  }
  if (scope === 'keepRecent') {
    // 要求保留的轮数 ≥ 总轮数时什么也不压（不要偷偷把最早一轮折掉）
    const keep = Math.min(Math.max(1, options.keepRounds ?? DEFAULT_KEEP_ROUNDS), rounds.length)
    return validPlan(splitAt(rounds, rounds.length - keep), path)
  }
  if (scope === 'all') {
    return validPlan({ head: [...path], tail: [] }, path)
  }
  const budget = Math.max(1, options.compactChars ?? DEFAULT_COMPACT_CHARS)
  if (scope === 'earlier') {
    // 从最早开始累计，至少压一轮，最多留一轮
    let used = 0
    let count = 0
    for (const round of rounds) {
      if (count >= rounds.length - 1) {
        break
      }
      const cost = roundsChars(round)
      if (count > 0 && used + cost > budget) {
        break
      }
      used += cost
      count += 1
    }
    return validPlan(splitAt(rounds, count), path)
  }
  // nearer：从最新往前累计，至少留最前面一轮
  let used = 0
  let count = 0
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    if (count >= rounds.length - 1) {
      break
    }
    const cost = roundsChars(rounds[index])
    if (count > 0 && used + cost > budget) {
      break
    }
    used += cost
    count += 1
  }
  const from = rounds.length - count
  return validPlan({ head: rounds.slice(from).flat(), tail: rounds.slice(0, from).flat() }, path)
}

export const getCompactPlan = (
  session: Session,
  options: CompactOptions = {}
): CompactPlan => {
  // 只规划「还在上下文里」的消息：已经折叠的不再重复摘要
  const path = contextMessages(session)
  if (options.scope) {
    return planByScope(path, options)
  }
  return splitFoldableRounds(path, options.keepTokens ?? KEEP_TOKENS_AUTO)
}

/** 至少含一个完整问答轮次，且保留段为空或以提问开头时才值得压缩 */
export const canCompact = (session: Session, options: CompactOptions = {}): boolean => {
  const { head, tail } = getCompactPlan(session, options)
  return head.length >= 2 && (tail.length === 0 || tail[0]?.role === 'user')
}
