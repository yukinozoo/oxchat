import { useEffect } from 'react'

/** 更新清单与安装包：只在原生壳里可用，网页版不显示入口 */
type AppUpdatePlugin = {
  check: (options: { manifests: string[] }) => Promise<UpdateManifest>
  download: (options: {
    sources: string[]
    sha256: string
    size: number
    fileName: string
  }) => Promise<{ path: string; size: number }>
  install: (options: { path: string }) => Promise<{ needPermission: boolean }>
  openInstallSettings: () => Promise<void>
  addListener: (
    event: 'updateProgress',
    listener: (payload: { done: number; total: number }) => void
  ) => { remove: () => Promise<void> } | undefined
}

export type UpdateManifest = {
  versionCode: number
  versionName: string
  size: number
  sha256: string
  notes: string
  sources: string[]
}

export type CurrentVersion = { version: string; build: number }

const plugin = (): AppUpdatePlugin | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { AppUpdate?: AppUpdatePlugin } } }).Capacitor
    ?.Plugins?.AppUpdate

/** 网页版没有原生更新能力 */
export const updateAvailable = (): boolean => Boolean(plugin())

const appPlugin = () =>
  (window as unknown as {
    Capacitor?: { Plugins?: { App?: { getInfo?: () => Promise<{ version?: string; build?: string }> } } }
  }).Capacitor?.Plugins?.App

/** 当前安装的版本：原生壳里取真实 versionName / versionCode */
export const currentVersion = async (): Promise<CurrentVersion | null> => {
  const app = appPlugin()
  if (!app?.getInfo) {
    return null
  }
  try {
    const info = await app.getInfo()
    return { version: info.version ?? '', build: Number(info.build ?? 0) || 0 }
  } catch {
    return null
  }
}

/**
 * 更新清单地址：优先 GitHub Pages（同域名、无跨域），
 * 国内直连不稳时退到 gh-proxy 转发的仓库原始文件。
 */
const MANIFESTS = [
  'https://yukinozoo.github.io/oxchat/update.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/yukinozoo/oxchat/main/src/update.json',
]

export type UpdateCheck =
  | { status: 'unsupported' }
  | { status: 'latest'; current: CurrentVersion }
  | { status: 'available'; current: CurrentVersion; manifest: UpdateManifest }
  | { status: 'error'; message: string }

/** 检查更新：清单拿不到时直接报错，不假装「已是最新」 */
export const checkForUpdate = async (): Promise<UpdateCheck> => {
  const instance = plugin()
  if (!instance) {
    return { status: 'unsupported' }
  }
  const current = await currentVersion()
  if (!current) {
    return { status: 'error', message: 'missing app info' }
  }
  try {
    const manifest = await instance.check({ manifests: MANIFESTS })
    if (!manifest || !manifest.versionCode) {
      return { status: 'error', message: 'bad manifest' }
    }
    return manifest.versionCode > current.build
      ? { status: 'available', current, manifest }
      : { status: 'latest', current }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/** 静默检查：一天最多一次，失败不打扰用户 */
const SILENT_KEY = 'oxchat:update-checked-at'
const SILENT_INTERVAL = 24 * 60 * 60 * 1000

export const shouldCheckSilently = (): boolean => {
  try {
    const last = Number(localStorage.getItem(SILENT_KEY) ?? 0)
    return !Number.isFinite(last) || Date.now() - last > SILENT_INTERVAL
  } catch {
    return true
  }
}

export const markChecked = () => {
  try {
    localStorage.setItem(SILENT_KEY, String(Date.now()))
  } catch {
    // 存储不可用时忽略
  }
}

/** 下载更新包并上报进度，返回本地 APK 路径 */
export const downloadUpdate = async (
  manifest: UpdateManifest,
  onProgress: (percent: number) => void
): Promise<string> => {
  const instance = plugin()
  if (!instance) {
    throw new Error('unsupported')
  }
  const handle = instance.addListener('updateProgress', ({ done, total }) => {
    if (total > 0) {
      onProgress(Math.min(100, Math.round((done / total) * 100)))
    }
  })
  try {
    const result = await instance.download({
      sources: manifest.sources,
      sha256: manifest.sha256,
      size: manifest.size,
      fileName: `OxChat-${manifest.versionName || 'update'}.apk`,
    })
    onProgress(100)
    return result.path
  } finally {
    if (handle && typeof handle === 'object' && typeof handle.remove === 'function') {
      void handle.remove()
    }
  }
}

/** 拉起系统安装界面；没有「安装未知应用」权限时打开设置页 */
export const installUpdate = async (path: string): Promise<'installed' | 'need-permission'> => {
  const instance = plugin()
  if (!instance) {
    throw new Error('unsupported')
  }
  const result = await instance.install({ path })
  if (result.needPermission) {
    await instance.openInstallSettings()
    return 'need-permission'
  }
  return 'installed'
}

/** 挂载时静默检查一次：一天最多一次，失败静默 */
export const useSilentUpdateCheck = (
  onFound: (manifest: UpdateManifest, current: CurrentVersion) => void
) => {
  useEffect(() => {
    if (!updateAvailable() || !shouldCheckSilently()) {
      return
    }
    let alive = true
    void checkForUpdate()
      .then((result) => {
        if (!alive) {
          return
        }
        markChecked()
        if (result.status === 'available') {
          onFound(result.manifest, result.current)
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // 只在启动时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** 版本号展示成 MB */
export const formatSize = (bytes: number): string =>
  bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : ''
