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

  createRoot(document.getElementById('root') as HTMLElement).render(
    <CrashScreen>
      <App />
    </CrashScreen>
  )

  // 网页版注册 Service Worker（原生壳里自动跳过）：离线打开 + 二次启动更快
  registerServiceWorker()
} catch (error) {
  reportFatal(error)
  throw error
}
