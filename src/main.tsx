import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupAppearance } from './app/appearance.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { registerServiceWorker } from './services/pwa.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupAppearance()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

// 网页版注册 Service Worker（原生壳里自动跳过）：离线打开 + 二次启动更快
registerServiceWorker()
