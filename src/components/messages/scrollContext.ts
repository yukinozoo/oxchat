import { createContext, useContext } from 'react'

/** 渲染更新后请求滚到底部；用户上滑离开底部时由列表忽略 */
export const ScrollToBottomContext = createContext<() => void>(() => {})

export const useScrollToBottom = () => useContext(ScrollToBottomContext)

/**
 * 顶栏双击「回到第 1 条」：顶栏不知道消息列表的窗口状态，
 * 用一个极轻的订阅通道把意图传下去（不做全局状态，避免多余重渲染）。
 */
const jumpToFirstListeners = new Set<() => void>()

export const requestJumpToFirst = () => {
  for (const listener of [...jumpToFirstListeners]) {
    listener()
  }
}

export const onJumpToFirst = (listener: () => void) => {
  jumpToFirstListeners.add(listener)
  return () => {
    jumpToFirstListeners.delete(listener)
  }
}
