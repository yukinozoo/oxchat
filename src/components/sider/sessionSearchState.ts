import { create } from 'zustand'

/**
 * 侧栏搜索界面的状态。
 *
 * 放在全局而不是组件里，是因为手机端的侧栏抽屉一关就整个卸载：
 * 搜完点进对话、再右滑回来时，用户期望还停在原来那批搜索结果上。
 */
type SessionSearchState = {
  /** 侧栏正在显示搜索界面（而不是会话列表） */
  active: boolean
  /** 上次输入的关键词，回来时原样回填并重新搜一遍 */
  query: string
}

export const useSessionSearch = create<SessionSearchState>(() => ({ active: false, query: '' }))

export const openSessionSearch = (): void => useSessionSearch.setState({ active: true })

/** 返回会话列表：关键词保留，方便再次进入搜索时接着用 */
export const closeSessionSearch = (): void => useSessionSearch.setState({ active: false })

export const setSessionSearchQuery = (query: string): void =>
  useSessionSearch.setState({ query })
