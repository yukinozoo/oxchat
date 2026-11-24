import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * 网页版的「有新版本」检查。
 *
 * App（原生壳）有 `AppUpdate` 插件读 update.json 比对 versionCode；网页版没有插件，
 * 所以这里自己来：构建时会把 `update.json` 的 versionCode 写进
 * `<meta name="application-version-code">`，运行时再拉一次线上 `update.json`，
 * 线上比本页新就弹一条可点刷新的提示。
 *
 * 只提示、不自动刷新：聊天中途刷新会打断输入（和 App 里「稍后」的取舍一致）。
 */

/** 线上清单地址：同源优先（快、无跨域），失败退 jsDelivr */
const MANIFESTS = ['./update.json', 'https://cdn.jsdelivr.net/gh/yukinozoo/oxchat@main/src/update.json']

/** 一天最多自动查一次，别每次刷新都去问 */
const CHECKED_KEY = 'oxchat:web-update-checked-at'
const CHECK_INTERVAL = 24 * 60 * 60 * 1000

type Notice = { versionName: string; versionCode: number }

type WebUpdateState = {
  notice: Notice | null
  /** 用户点了「刷新」：先让 SW 更新，再重载 */
  reload: () => void
  dismiss: () => void
}

export const useWebUpdate = create<WebUpdateState>((set) => ({
  notice: null,
  reload: () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker?.getRegistration?.()
        await registration?.update?.()
      } catch {
        // 拿不到 SW 就直接刷新
      }
      window.location.reload()
    })()
  },
  dismiss: () => set({ notice: null }),
}))

const meta = (name: string): string =>
  document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? ''

/** 本页是哪一版构建出来的；没有 meta（老产物/开发态）时返回 null */
export const currentWebBuild = (): { versionName: string; versionCode: number } | null => {
  const versionCode = Number(meta('application-version-code'))
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    return null
  }
  return { versionName: meta('application-version'), versionCode }
}

const shouldCheck = (): boolean => {
  try {
    const last = Number(localStorage.getItem(CHECKED_KEY) ?? 0)
    return !Number.isFinite(last) || last === 0 || Date.now() - last > CHECK_INTERVAL
  } catch {
    return true
  }
}

const markChecked = () => {
  try {
    localStorage.setItem(CHECKED_KEY, String(Date.now()))
  } catch {
    // 存储不可用时忽略
  }
}

type Manifest = { versionName?: unknown; versionCode?: unknown }

/** 拉线上清单，比本页新就返回它，否则 null；任何失败都当作「没查到」 */
export const checkWebUpdate = async (
  send: typeof fetch = fetch
): Promise<Notice | null> => {
  const current = currentWebBuild()
  if (!current) {
    return null
  }
  for (const url of MANIFESTS) {
    try {
      const response = await send(url, { cache: 'no-store' })
      if (!response.ok) {
        continue
      }
      const manifest = (await response.json()) as Manifest
      const versionCode = Number(manifest.versionCode)
      if (!Number.isFinite(versionCode) || versionCode <= current.versionCode) {
        return null
      }
      return {
        versionCode,
        versionName: typeof manifest.versionName === 'string' ? manifest.versionName : String(versionCode),
      }
    } catch {
      // 换下一个源
    }
  }
  return null
}

/** 启动时查一次（网页版才有意义）；原生壳里 AppUpdate 那套已经在跑，别重复打扰 */
export const useWebUpdateCheck = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled || !shouldCheck()) {
      return
    }
    let alive = true
    void checkWebUpdate()
      .then((notice) => {
        if (!alive) {
          return
        }
        markChecked()
        if (notice) {
          useWebUpdate.setState({ notice })
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // 只在启动时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
