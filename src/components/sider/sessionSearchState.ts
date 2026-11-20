import { create } from 'zustand'
import type { SessionSearchHit } from '../../services/chat/localSearch.js'

/**
 * 侧栏搜索界面的状态。
 *
 * 放在全局而不是组件里，是因为手机端的侧栏抽屉一关就整个卸载：
 * 搜完点进对话、再右滑回来时，用户期望还停在原来那批搜索结果上。
 */
type SessionSearchState = {
  /** 侧栏正在显示搜索界面（而不是会话列表） */
  active: boolean
  /** 上次输入的关键词，回来时原样回填 */
  query: string
  /**
   * 上一次跑出来的结果。回来时先直接铺这批，避免重新搜索期间出现空的
   * 「没有找到相关对话」，让人以为对话内容丢了；关键词改了才重跑。
   */
  results: { query: string; hits: SessionSearchHit[]; truncated: number | null } | null
}

export const useSessionSearch = create<SessionSearchState>(() => ({
  active: false,
  query: '',
  results: null,
}))

export const openSessionSearch = (): void => useSessionSearch.setState({ active: true })

/** 返回会话列表：关键词保留，方便再次进入搜索时接着用 */
export const closeSessionSearch = (): void => useSessionSearch.setState({ active: false })

export const setSessionSearchQuery = (query: string): void =>
  useSessionSearch.setState({ query })

/** 存下这次的结果，供下次打开搜索界面直接复用 */
export const setSearchResults = (
  results: { query: string; hits: SessionSearchHit[]; truncated: number | null } | null
): void => useSessionSearch.setState({ results })
