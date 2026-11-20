/**
 * OxChat 的 Service Worker：让「添加到主屏幕」的 PWA 能离线打开、二次启动秒开。
 *
 * 策略：
 * - 导航请求（打开页面）network-first：有新版本立刻生效，断网时回退缓存里的 index.html
 * - 静态资源（文件名带 hash）cache-first：命中缓存就不再走网络
 * - 跨域请求（api.deepseek.com 等）一律不接管，直接放行
 *
 * 这个文件不参与打包，由 rspack 的 Copy 插件原样复制到站点根目录（作用域才能是整站）。
 */
const CACHE = 'oxchat-shell-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png']

self.addEventListener('install', (event) => {
  // 不等旧页面关掉：新版本装上就接管，配合下面的 network-first 导航立刻生效
  self.skipWaiting()
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 单个资源失败不阻塞安装（例如首次部署时图标还没就位）
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          const response = await fetch(request)
          if (response.ok) {
            await cache.put('./index.html', response.clone())
          }
          return response
        } catch (error) {
          const cached = (await cache.match('./index.html')) ?? (await cache.match('./'))
          if (cached) {
            return cached
          }
          throw error
        }
      })()
    )
    return
  }
  // 版本化资源：先读缓存
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(request)
      if (cached) {
        return cached
      }
      const response = await fetch(request)
      if (response.ok && (url.pathname.includes('/static/') || url.pathname.endsWith('.png'))) {
        await cache.put(request, response.clone())
      }
      return response
    })()
  )
})
