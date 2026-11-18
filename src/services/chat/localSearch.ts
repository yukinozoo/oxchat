import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import { useChatStore } from './store.js'
import type { Message, SessionSummary } from './types.js'

/** 一条搜索命中：会话 + 片段来源 + 命中附近的上下文 */
export type SessionSearchHit = {
  sessionId: string
  title: string
  updatedAt: number
  /** 命中所在消息的角色，用于列表左侧图标 */
  source: 'user' | 'assistant'
  /** 命中处前后截取的片段，已折叠空白 */
  snippet: string
}

const SNIPPET_BEFORE = 18
const SNIPPET_AFTER = 34
const MAX_HITS = 80

/** 助手消息的可读文本：只取 text 块，思考与服务端工具块不参与匹配 */
const assistantText = (message: Extract<Message, { role: 'assistant' }>): string =>
  message.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')

const messageText = (message: Message): string =>
  message.role === 'user' ? message.content : assistantText(message)

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** 截取命中前后的上下文；两侧被截断时补省略号 */
const snippetAround = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - SNIPPET_BEFORE)
  const end = Math.min(text.length, index + length + SNIPPET_AFTER)
  const body = collapse(text.slice(start, end))
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

const textMatches = (text: string, needle: string): { index: number } | null => {
  const index = text.toLowerCase().indexOf(needle)
  return index === -1 ? null : { index }
}

/**
 * 在本地全部会话里搜索标题与消息内容。
 * 逐条读取未加载的会话，命中即回调；返回的 cancel 用于中断（查询变化时）。
 */
export const searchSessions = (
  query: string,
  onHit: (hit: SessionSearchHit) => void
): { done: Promise<void>; cancel: () => void } => {
  const needle = collapse(query).toLowerCase()
  let cancelled = false

  const done = (async () => {
    if (!needle) {
      return
    }
    const { sessions, sessionCache } = useChatStore.getState()
    let hits = 0
    const seen = new Set<string>()
    for (const summary of sessions) {
      if (cancelled || hits >= MAX_HITS) {
        return
      }
      const base = { sessionId: summary.id, title: summary.title, updatedAt: summary.updatedAt }
      // 标题命中：给出整条记录，不带片段
      if (summary.title.toLowerCase().includes(needle)) {
        seen.add(`${summary.id}|title`)
        onHit({ ...base, source: 'assistant', snippet: '' })
        hits += 1
      }
      const session = Object.hasOwn(sessionCache, summary.id)
        ? sessionCache[summary.id]
        : await loadSummarySession(summary)
      if (!session || cancelled) {
        continue
      }
      // 只搜当前显示的分支：session.messages 里还留着被切换下去的版本
      for (const message of getVisibleMessages(session)) {
        const text = messageText(message)
        if (!text) {
          continue
        }
        const match = textMatches(text, needle)
        if (!match) {
          continue
        }
        const snippet = snippetAround(text, match.index, needle.length)
        const key = `${summary.id}|${message.role}|${snippet}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        onHit({ ...base, source: message.role, snippet })
        hits += 1
        if (hits >= MAX_HITS) {
          return
        }
      }
    }
  })()

  return { done, cancel: () => (cancelled = true) }
}

/** 未打开的会话从 IndexedDB 读取一次；失败时跳过，不影响其它结果 */
const loadSummarySession = async (summary: SessionSummary) => {
  try {
    return await db.loadSession(summary.id)
  } catch {
    return undefined
  }
}
