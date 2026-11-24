import { Component, type ErrorInfo, type ReactNode } from 'react'
import { translate } from '../i18n/index.js'

/**
 * 崩溃兜底（错误边界）。
 *
 * 为什么需要：React 组件在渲染/生命周期里抛错时，整棵树的更新会中断 ——
 * 表现就是**一整片空白**，控制台里才有真实原因。安卓 WebView 上用户连"哪里错了"都看不到。
 * 之前只有 `index.html` 的内联脚本兜"脚本还没跑起来"那一段，跑起来之后崩了仍然白屏。
 *
 * 这里接住渲染期异常，把错误原文 + 堆栈画在页面上，并提供「复制」与「重新加载」。
 * 注意错误边界**接不住**：事件回调里的异常、异步 Promise、计时器 —— 那些由全局
 * `error` / `unhandledrejection` 处理（index.html 内联脚本已覆盖）。
 */

type Props = { children: ReactNode }
type State = { error: Error | null; info: string }

const copyText = (text: string): boolean => {
  try {
    void navigator.clipboard?.writeText(text)
    return true
  } catch {
    // 老内核没有 clipboard：退回选中 textarea 复制
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export class CrashScreen extends Component<Props, State> {
  override state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // 组件栈比调用栈更有用：能直接定位是哪个组件崩的
    this.setState({ info: info.componentStack ?? '' })
    // 同时交给 index.html 的兜底记录一份，方便用户截图时对照
    const fatal = (window as { __oxchatFatal?: (detail: string) => void }).__oxchatFatal
    if (typeof fatal === 'function') {
      fatal(`${error.message}\n${error.stack ?? ''}\n${info.componentStack ?? ''}`)
    }
  }

  /** 冒烟用：清掉错误重新渲染子树 */
  private retry = () => this.setState({ error: null, info: '' })

  override render() {
    const { error, info } = this.state
    if (!error) {
      return this.props.children
    }
    const detail = [error.message, error.stack ?? '', info].filter(Boolean).join('\n\n')
    return (
      <div className="oxchat-crash" role="alert">
        <div className="oxchat-crash-card">
          <div className="oxchat-crash-title">{translate('crashTitle')}</div>
          <div className="oxchat-crash-hint">{translate('crashHint')}</div>
          <pre className="oxchat-crash-detail">{detail.slice(0, 4000)}</pre>
          <div className="oxchat-crash-actions">
            <button type="button" onClick={() => copyText(detail)}>
              {translate('crashCopy')}
            </button>
            <button
              type="button"
              onClick={() => {
                this.retry()
              }}
            >
              {translate('crashRetry')}
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              {translate('crashReload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
