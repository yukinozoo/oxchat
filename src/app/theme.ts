import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'
import { applyAppearance, wallpaperIsDark } from './appearance.js'
import { onMediaChange, safeMatchMedia } from './viewport.js'

export type Theme = 'light' | 'dark'

/** 用 safeMatchMedia：模块顶层直接调 window.matchMedia，缺 API 的环境会启动即白屏 */
const query = safeMatchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => onMediaChange(query, listener)

const getOsTheme = (): Theme => (query?.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
  syncNativeBars(backgroundColor)
}

/**
 * 把「顶部实际是什么颜色」与「图标该浅还是该深」同步给原生壳（`AppThemePlugin`）。
 *
 * - 颜色取**最外层 frame 的真实底色**（不是 body）：设了壁纸时 frame 是 transparent，
 *   这时要告诉原生用透明系统栏，让壁纸一直铺到时间/电量后面，而不是盖一条实色带子；
 * - 图标深浅：跟随主题；有壁纸时改看壁纸明暗（量不出来就退回主题）。
 *
 * Android 15+ 强制边到边，状态栏区域露的是原生窗口背景，`setStatusBarColor` 会被忽略，
 * 所以原生侧要连窗口/DecorView 的底色一起刷。网页版没有这个插件，静默跳过。
 */
const syncNativeBars = (fallbackColor: string) => {
  const plugin = (
    window as unknown as {
      Capacitor?: { Plugins?: { AppTheme?: { set: (options: { dark: boolean; color: string }) => Promise<unknown> } } }
    }
  ).Capacitor?.Plugins?.AppTheme
  if (!plugin) {
    return
  }
  const frame = document.querySelector<HTMLElement>('[data-app-frame]')
  const frameColor = frame ? getComputedStyle(frame).backgroundColor : ''
  const wallpapered = document.body.classList.contains('has-bg-image')
  const transparent =
    wallpapered || frameColor === 'transparent' || frameColor === 'rgba(0, 0, 0, 0)'
  const color = transparent ? 'transparent' : frameColor || fallbackColor
  const themeDark = document.body.classList.contains('dark')
  const send = (dark: boolean) =>
    void plugin.set({ dark, color }).catch(() => {
      // 原生侧失败不影响网页
    })
  if (!wallpapered || !bgImageOf()) {
    send(themeDark)
    return
  }
  // 有壁纸：先按主题发一次，量出壁纸明暗后再校正一次（两帧内完成，不会闪）
  send(themeDark)
  void wallpaperIsDark(bgImageOf()).then((dark) => {
    if (dark !== null && dark !== themeDark) {
      send(dark)
    }
  })
}

/** 当前壁纸的 data URL（没有就空串） */
const bgImageOf = (): string => {
  const value = getComputedStyle(document.body).getPropertyValue('--oxchat-bg-image').trim()
  const match = /url\(["']?(.*?)["']?\)/.exec(value)
  return match ? match[1] : ''
}

/** 同步页面主题、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
  // 主题色与背景可能依赖深浅色，切换后重新计算
  applyAppearance()
  // 原生系统栏跟着换底色与图标明暗（网页版没有插件，跳过）
  syncNativeBars(getComputedStyle(document.body).backgroundColor)
}

let appliedTheme: Theme | null = null

const syncTheme = () => {
  const theme = resolveTheme(useSettings.getState().themePreference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  // 换壁纸 / 改不透明度 / 改气泡都不会走主题切换，但顶部底色变了：
  // 这里跟着外观 store 再同步一次，否则状态栏会一直留着上一次的颜色（白条就是这么来的）
  let scheduled = 0
  useSettings.subscribe(() => {
    if (scheduled) {
      return
    }
    scheduled = window.requestAnimationFrame(() => {
      scheduled = 0
      syncNativeBars(getComputedStyle(document.body).backgroundColor)
    })
  })
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  onMediaChange(query, syncTheme)
  useSettings.subscribe(syncTheme)
}
