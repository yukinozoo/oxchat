import { sanitizeSurrogates } from '../../utils/safeText.js'
import { stripSpecialTokens } from '../../utils/specialTokens.js'
import type { Message, ReplyBlock, Session } from './types.js'

/**
 * 会话文本清洗。
 *
 * 三处都需要它：写库前（把脏数据挡在库外）、加载后（让已经污染的旧库自愈）、
 * 出站前（保证不回传脏历史给服务端）。清洗是纯函数且**没有改动时返回原对象**，
 * 避免每帧 persist 都触发一次写库。
 *
 * 范围：
 * - assistant 的文本块清协议标记（thinking 保留原文：续写签名需要原样）；
 * - user 的正文与摘要只兜孤立代理，不改内容 —— 用户怎么写就怎么存；
 * - 工具块（搜索结果、读链接）是结构化数据，原样保留。
 */

/** 出站文本的兜底：先修代理，再清标记 */
export const cleanOutboundText = (text: string): string => {
  const trimmed = stripSpecialTokens(sanitizeSurrogates(text))
  return trimmed
}

const cleanBlock = (block: ReplyBlock): ReplyBlock => {
  if (block.type !== 'text') {
    return block
  }
  const text = stripSpecialTokens(block.text)
  return text === block.text ? block : { ...block, text }
}

const cleanMessage = (message: Message): Message => {
  if (message.role === 'assistant') {
    const blocks = message.blocks.map(cleanBlock)
    const changed = blocks.some((block, index) => block !== message.blocks[index])
    return changed ? { ...message, blocks } : message
  }
  const content = sanitizeSurrogates(message.content)
  const summary = message.summary === undefined ? undefined : sanitizeSurrogates(message.summary)
  if (content === message.content && summary === message.summary) {
    return message
  }
  return {
    ...message,
    content,
    ...(summary === undefined ? {} : { summary }),
  }
}

/**
 * 清洗整个会话；没有改动时返回**同一个对象**（调用方可用 `===` 判断能否跳过写库）。
 */
export const cleanSessionText = (session: Session): Session => {
  const messages = session.messages.map(cleanMessage)
  const changed = messages.some((message, index) => message !== session.messages[index])
  return changed ? { ...session, messages } : session
}
