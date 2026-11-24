import * as db from './db.js'
import { loadIndexSnapshot, type SearchDoc } from './searchIndex.js'
import { collapse, findRanges, fold, snippetAround, textMatches } from './searchText.js'
import { useChatStore } from './store.js'
import type { Message, SessionSummary } from './types.js'

/** 一条搜索命中：会话 + 片段来源 + 命中附近的上下文 */
export type SessionSearchHit = {
  sessionId: string
  title: string
  updatedAt: number
  /** 命中所在消息的角色，用于列表左侧图标 */
  source: 'user' | 'assistant'
  /** 命中的消息 ID：点开结果时用它把列表滚到那条消息；标题命中没有 */
  messageId: string
  /** 命中处前后截取的片段，已折叠空白 */
  snippet: string
  /** 片段里的命中区间（相对 snippet），供界面 <mark> 高亮；标题命中为空 */
  ranges: { start: number; end: number }[]
}

/** 一轮搜索的结果：命中条数与「是否因为上限被截断」 */
export type SessionSearchResult = {
  hits: number
  /** true 表示命中了上限，后面的会话没有再扫 */
  truncated: boolean
}

/**
 * 默认结果上限。真正的代价在列表渲染，所以上限开到 3000，界面再分页渲染。
 * 命中上限时返回 truncated，提示「细化关键词」，而不是静默截断。
 */
export const DEFAULT_MAX_HITS = 3000

/** 兜底直读时的会话缓存：还没建索引的历史会话不会每换一个关键词就重读一遍 */
const BODY_CACHE_LIMIT = 40
const bodyCache = new Map<string, { updatedAt: number; session: Message[] }>()

const rememberBody = (id: string, updatedAt: number, messages: Message[]) => {
  bodyCache.delete(id)
  bodyCache.set(id, { updatedAt, session: messages })
  while (bodyCache.size > BODY_CACHE_LIMIT) {
    const oldest = bodyCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    bodyCache.delete(oldest)
  }
}

/** 冒烟用 */
export const clearSearchBodyCache = (): void => bodyCache.clear()

/** 未打开的会话从 IndexedDB 读取一次；失败时跳过，不影响其它结果 */
const loadSummarySession = async (summary: SessionSummary) => {
  const cached = bodyCache.get(summary.id)
  if (cached && cached.updatedAt === summary.updatedAt) {
    // 命中过就把它挪到队尾（LRU）
    rememberBody(summary.id, cached.updatedAt, cached.session)
    return cached.session
  }
  try {
    const session = await db.loadSession(summary.id)
    if (session) {
      rememberBody(summary.id, summary.updatedAt, session.messages)
    }
    return session?.messages
  } catch {
    return undefined
  }
}

/**
 * 在本地全部会话里搜索标题与消息内容。
 *
 * 两条路径：
 * 1. **索引**（`oxchat-search` 库）：会话有索引就直接在内存文档里找，搜索期间零 IO；
 * 2. **兜底直读**：还没建好索引的会话照旧读库，保证结果不漏。
 *
 * 标题命中先整批发出去（不读库），界面能立刻看到东西，再慢慢补正文命中。
 */
export const searchSessions = (
  query: string,
  onHit: (hit: SessionSearchHit) => void,
  options: { maxHits?: number } = {}
): { done: Promise<SessionSearchResult>; cancel: () => void } => {
  const needle = fold(collapse(query))
  const maxHits = Math.max(1, options.maxHits ?? DEFAULT_MAX_HITS)
  let cancelled = false

  const done = (async (): Promise<SessionSearchResult> => {
    if (!needle) {
      return { hits: 0, truncated: false }
    }
    const { sessions, sessionCache } = useChatStore.getState()
    let hits = 0
    const seen = new Set<string>()
    const emit = (hit: SessionSearchHit) => {
      onHit(hit)
      hits += 1
    }

    // 第一遍：只查标题（纯内存，不读库）
    for (const summary of sessions) {
      if (fold(summary.title).includes(needle)) {
        seen.add(`${summary.id}|title`)
        emit({
          sessionId: summary.id,
          title: summary.title,
          updatedAt: summary.updatedAt,
          source: 'assistant',
          snippet: '',
          ranges: [],
          messageId: '',
        })
        if (hits >= maxHits) {
          return { hits, truncated: true }
        }
      }
    }

    // 第二遍：正文。有索引走内存，没有就直读会话
    const index = await loadIndexSnapshot()
    const searchDocs = (summary: SessionSummary, docs: readonly SearchDoc[]): boolean => {
      for (const doc of docs) {
        const match = textMatches(doc.text, needle)
        if (!match) {
          continue
        }
        const snippet = snippetAround(doc.text, match.index, needle.length)
        const key = `${summary.id}|${doc.role}|${snippet}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        emit({
          sessionId: summary.id,
          title: summary.title,
          updatedAt: summary.updatedAt,
          source: doc.role,
          snippet,
          ranges: findRanges(snippet, needle),
          messageId: doc.messageId,
        })
        if (hits >= maxHits) {
          return true
        }
      }
      return false
    }

    for (const summary of sessions) {
      if (cancelled) {
        return { hits, truncated: false }
      }
      if (hits >= maxHits) {
        return { hits, truncated: true }
      }
      const docs = index.byId.get(summary.id)
      if (docs) {
        if (searchDocs(summary, docs)) {
          return { hits, truncated: true }
        }
        continue
      }
      const messages = Object.hasOwn(sessionCache, summary.id)
        ? sessionCache[summary.id].messages
        : await loadSummarySession(summary)
      if (!messages || cancelled) {
        continue
      }
      // 搜全部消息：被切下去的分支也算「对话内容」，命中后跳转会先把分支切回来
      for (const message of messages) {
        const text = message.role === 'user'
          ? [message.content, message.summary].filter(Boolean).join('\n')
          : message.blocks
              .map((block) =>
                block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : ''
              )
              .filter(Boolean)
              .join('\n')
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
        emit({
          sessionId: summary.id,
          title: summary.title,
          updatedAt: summary.updatedAt,
          source: message.role,
          snippet,
          ranges: findRanges(snippet, needle),
          messageId: message.id,
        })
        if (hits >= maxHits) {
          return { hits, truncated: true }
        }
      }
    }
    return { hits, truncated: false }
  })()

  return { done, cancel: () => (cancelled = true) }
}

export { findRanges } from './searchText.js'
