/**
 * 「从搜索命中跳到那条消息」的通道。
 *
 * 搜索面板只知道自己搜到了哪条消息，消息列表才知道窗口怎么摆；
 * 用一个极轻的待办 + 订阅，避免把跳转状态塞进会话 store 引起整页重渲染。
 */
export type JumpTarget = {
  sessionId: string
  messageId: string
}

let pending: JumpTarget | null = null
const listeners = new Set<(target: JumpTarget) => void>()

/** 请求跳到某条消息：先记下待办（会话可能还没加载），再通知已经挂载的列表 */
export const requestJumpToMessage = (sessionId: string, messageId: string): void => {
  pending = { sessionId, messageId }
  for (const listener of [...listeners]) {
    listener(pending)
  }
}

/** 列表挂载或切到目标会话时取一次待办；只由匹配的会话消费 */
export const takeJumpTarget = (sessionId: string): string | null => {
  if (pending?.sessionId !== sessionId) {
    return null
  }
  const { messageId } = pending
  pending = null
  return messageId
}

export const onJumpTarget = (listener: (target: JumpTarget) => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 以命中消息为中心的窗口：上下各留一段上下文，且不超过窗口上限 */
export const windowAround = (
  index: number,
  total: number,
  page: number,
  max: number
): { start: number; end: number } => {
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, total - 1)))
  const before = Math.floor((max - page) / 2)
  const start = Math.max(0, Math.min(safeIndex - before, Math.max(0, total - max)))
  return { start, end: Math.min(total, start + Math.max(page, max)) }
}
