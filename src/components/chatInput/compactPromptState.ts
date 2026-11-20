import { create } from 'zustand'

/**
 * 「这条对话很长，要不要先压缩」的确认框状态。
 *
 * 触发点只有一个：用户在超长对话里按发送时。
 * 导入时不再提示——导入只是把数据搬进来，是否压缩由用户在真正发送时决定。
 */
export type CompactPrompt = {
  sessionId: string
  /** 当前历史的 token 估算 */
  tokens: number
  /** 用户选择「仍然发送」后继续发送 */
  proceed: () => void
}

type CompactPromptState = { request: CompactPrompt | null }

export const useCompactPrompt = create<CompactPromptState>(() => ({ request: null }))

export const requestCompactPrompt = (request: CompactPrompt): void =>
  useCompactPrompt.setState({ request })

export const closeCompactPrompt = (): void => useCompactPrompt.setState({ request: null })

/**
 * 记住「这条已经决定直接发」的会话：按 1 万 token 一档记录，
 * 历史继续变长到一个新档位时才再提醒，避免每发一句都弹。
 */
const dismissed = new Map<string, number>()

const bucketOf = (tokens: number) => Math.floor(tokens / 10_000)

export const markCompactPromptDismissed = (sessionId: string, tokens: number): void => {
  dismissed.set(sessionId, bucketOf(tokens))
}

export const wasCompactPromptDismissed = (sessionId: string, tokens: number): boolean =>
  (dismissed.get(sessionId) ?? -1) >= bucketOf(tokens)

/** 压缩过之后清掉记忆：压缩后长度已经变了 */
export const forgetCompactPrompt = (sessionId: string): void => {
  dismissed.delete(sessionId)
}
