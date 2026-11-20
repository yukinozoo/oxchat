import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import { useChatStore } from './store.js'
import type { AssistantMessage, Message, SessionSummary, UserMessage } from './types.js'

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

/** 一轮搜索的结果：命中条数与「是否因为上限被截断」 */
export type SessionSearchResult = {
  hits: number
  /** true 表示命中了上限，后面的会话没有再扫 */
  truncated: boolean
}

const SNIPPET_BEFORE = 18
const SNIPPET_AFTER = 34
/**
 * 默认结果上限：列表是异步追加渲染的，几百条已经很够用；
 * 命中上限时返回 truncated，界面提示「细化关键词」，而不是静默截断。
 */
export const DEFAULT_MAX_HITS = 300

/** 助手消息的可读文本：只取 text 块，思考与服务端工具块不参与匹配 */
const assistantText = (message: AssistantMessage): string =>
  message.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')

/**
 * 用户消息的可读文本：正文 + 手动压缩留下的摘要。
 * 压缩会把被替换掉的早期消息从 messages 里删掉，只剩摘要字符串；
 * 不读这里，压缩过的历史就彻底搜不到了。
 */
const userText = (message: UserMessage): string =>
  [message.content, message.summary].filter(Boolean).join('\n')

const messageText = (message: Message): string =>
  message.role === 'user' ? userText(message) : assistantText(message)

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
 * 逐条读取未加载的会话，命中即回调；返回的 cancel 用于中断（查询变化时），
 * done 解析为命中条数与是否被上限截断。
 */
export const searchSessions = (
  query: string,
  onHit: (hit: SessionSearchHit) => void,
  options: { maxHits?: number } = {}
): { done: Promise<SessionSearchResult>; cancel: () => void } => {
  const needle = collapse(query).toLowerCase()
  const maxHits = Math.max(1, options.maxHits ?? DEFAULT_MAX_HITS)
  let cancelled = false

  const done = (async (): Promise<SessionSearchResult> => {
    if (!needle) {
      return { hits: 0, truncated: false }
    }
    const { sessions, sessionCache } = useChatStore.getState()
    let hits = 0
    const seen = new Set<string>()
    for (const summary of sessions) {
      if (cancelled) {
        return { hits, truncated: false }
      }
      if (hits >= maxHits) {
        return { hits, truncated: true }
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
        if (hits >= maxHits) {
          return { hits, truncated: true }
        }
      }
    }
    return { hits, truncated: false }
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
