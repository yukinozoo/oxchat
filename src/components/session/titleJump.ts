import { useRef } from 'react'
import { requestJumpToFirst } from '../messages/scrollContext.js'

/** 双击间隔上限：超过就当成两次独立点击，避免慢速连点误触 */
const DOUBLE_TAP_MS = 350

/**
 * 顶栏标题的双击手势：跳到会话第 1 条消息。
 * 用 click 计时而不是 onDoubleClick：iOS WebView 不会为非链接元素派发 dblclick，
 * 而 click 在鼠标和触屏上都会来。
 */
export const useTitleJump = () => {
  const lastTapRef = useRef(0)
  return () => {
    const now = Date.now()
    if (now - lastTapRef.current <= DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      requestJumpToFirst()
      return
    }
    lastTapRef.current = now
  }
}
