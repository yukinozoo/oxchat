import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { CrashScreen } from './app/CrashScreen.js'
import { setupAppearance } from './app/appearance.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { registerServiceWorker } from './services/pwa.js'
import './app/theme.css'
import './app/global.css'

/** 启动阶段直接崩溃时，交给 index.html 的兜底逻辑把真实错误画出来（而不是只留白屏） */
const reportFatal = (error: unknown) => {
  const fatal = (window as { __oxchatFatal?: (detail: string) => void }).__oxchatFatal
  if (typeof fatal === 'function') {
    fatal(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  }
}

try {
  ensureKatex()
  setupTheme()
  setupAppearance()

  const container = document.getElementById('root') as HTMLElement
  createRoot(container).render(
    <CrashScreen>
      <App />
    </CrashScreen>
  )

  /**
   * 渲染自检：模块跑完、也没抛错，但根节点一直是空的（iOS Safari 上真出现过），
   * 15 秒兜底只会说「没渲染出内容」，看不出卡在哪。这里 2 秒就点名，并把现场信息带上。
   */
  window.setTimeout(() => {
    if (container.childElementCount > 0) {
      return
    }
    reportFatal(
      [
        '渲染没有产出任何节点（React 已挂载，但根节点仍为空）',
        `matchMedia: ${typeof window.matchMedia}`,
        `Intl.DisplayNames: ${typeof (Intl as { DisplayNames?: unknown }).DisplayNames}`,
        `localStorage: ${(() => {
          try {
            window.localStorage.getItem('oxchat:probe')
            return 'ok'
          } catch (error) {
            return error instanceof Error ? error.name : 'blocked'
          }
        })()}`,
        `indexedDB: ${typeof window.indexedDB}`,
      ].join('\n')
    )
  }, 2000)

  // 网页版注册 Service Worker（原生壳里自动跳过）：离线打开 + 二次启动更快
  registerServiceWorker()
} catch (error) {
  reportFatal(error)
  throw error
}
