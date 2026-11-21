import { contextMessages } from './memory.js'
import type { Message, Session } from './types.js'

/**
 * 压缩的分界线：最近一轮问答原样保留，更早的消息交给模型总结成摘要后移除。
 * 末尾是没有回答的提问（报错、被停止）时只保留这条提问，避免把上一轮拆散。
 */
export type CompactPlan = {
  /** 将被摘要并移除的消息 */
  head: Message[]
  /** 保留的消息，第一条必须是提问 */
  tail: Message[]
}

export const getCompactPlan = (session: Session): CompactPlan => {
  // 只规划「还在上下文里」的消息：已经折叠的不再重复摘要
  const path = contextMessages(session)
  const keep = path.at(-1)?.role === 'assistant' ? 2 : 1
  const start = Math.max(0, path.length - keep)
  return { head: path.slice(0, start), tail: path.slice(start) }
}

/** 至少含一个完整问答轮次、且保留段以提问开头时才值得压缩 */
export const canCompact = (session: Session): boolean => {
  const { head, tail } = getCompactPlan(session)
  return head.length >= 2 && tail[0]?.role === 'user'
}
