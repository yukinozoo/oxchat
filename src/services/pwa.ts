import { showToast } from '../components/base/toastState.js'

/**
 * 网页版 PWA 的注册与更新提示。
 * 原生壳里由 Capacitor 提供资源，不需要 Service Worker。
 */

const isNativeShell = (): boolean => {
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return Boolean(capacitor?.isNativePlatform?.())
}

/** 是否以「添加到主屏幕」的独立窗口打开（iOS 用 navigator.standalone） */
export const isStandalonePwa = (): boolean => {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return iosStandalone === true || window.matchMedia('(display-mode: standalone)').matches
}

let started = false

/** 注册 Service Worker：只在网页版、HTTPS/localhost 下进行 */
export const registerServiceWorker = (): void => {
  if (started || isNativeShell() || !('serviceWorker' in navigator)) {
    return
  }
  const secure = location.protocol === 'https:' || location.hostname === 'localhost'
  if (!secure) {
    return
  }
  started = true
  const start = () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', {
          updateViaCache: 'none',
        })
        // 新版本装好但还没接管：提示一下，不自动刷新（聊天中途刷新会打断输入）
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) {
            return
          }
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              showToast({ key: 'pwaUpdateReady' })
            }
          })
        })
      } catch {
        // 注册失败不影响正常使用（只是没有离线能力）
      }
    })()
  }
  // 页面已经加载完就立刻注册，否则等 load；只跑一次
  if (document.readyState === 'complete') {
    start()
  } else {
    window.addEventListener('load', start, { once: true })
  }
}
