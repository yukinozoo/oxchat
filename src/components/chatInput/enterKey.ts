import { useRef } from 'react'

/**
 * 回车键的判定：手机软键盘的回车应当换行，桌面键盘的回车才是发送。
 *
 * 这里把「按了什么键 / 是不是在输入法组词 / 当前是不是手机布局」抽成纯函数，
 * 是因为各端键盘差异太大：Android WebView 组词时会派发 keyCode 229，
 * iOS 中文输入法确认候选与真回车只差一个 isComposing，光靠 event.key 判断会误发消息。
 */
export type EnterAction =
  /** 发送消息 */
  | 'send'
  /** 在光标处插入换行（组件自己插，不依赖键盘默认行为） */
  | 'newline'
  /** 交给浏览器原生处理（桌面 Shift+Enter 就是原生换行） */
  | 'native'
  /** 不处理：输入法组词中的回车由输入法自己消费 */
  | 'ignore'

export type EnterContext = {
  key: string
  shiftKey: boolean
  /** 输入法正在组词，或刚结束组词的极短时间内收到的回车 */
  imeActive: boolean
  /** 触屏 / 手机布局（原生壳强制手机布局） */
  softKeyboard: boolean
}

export const resolveEnterAction = ({ key, shiftKey, imeActive, softKeyboard }: EnterContext): EnterAction => {
  if (key !== 'Enter') {
    return 'ignore'
  }
  // 组词中的回车是「选候选词」，不能当发送，也不能插换行
  if (imeActive) {
    return 'ignore'
  }
  if (softKeyboard) {
    return 'newline'
  }
  if (shiftKey) {
    return 'native'
  }
  return 'send'
}

/** 在选区处插入换行，返回新文本与插入后的光标位置 */
export const insertNewline = (
  text: string,
  start: number,
  end: number
): { text: string; caret: number } => {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  return { text: `${text.slice(0, from)}\n${text.slice(to)}`, caret: from + 1 }
}

/**
 * 输入法组词守卫：把「正在组词 / 刚结束组词」的判断集中到一处，
 * 多行输入框（聊天输入、消息编辑）共用同一套规则，避免某个端漏判导致误发。
 */
export const useImeGuard = () => {
  const composingRef = useRef(false)
  const endedAtRef = useRef(0)
  return {
    compositionHandlers: {
      onCompositionStart: () => {
        composingRef.current = true
      },
      onCompositionEnd: () => {
        composingRef.current = false
        endedAtRef.current = Date.now()
      },
    },
    isImeActive: (native: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean =>
      composingRef.current ||
      native.isComposing ||
      native.keyCode === 229 ||
      Date.now() - endedAtRef.current < 80,
  }
}
