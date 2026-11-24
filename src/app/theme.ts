import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'
import { applyAppearance } from './appearance.js'
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
 * 把页面底色与深浅同步给原生壳（`AppThemePlugin`）。
 *
 * Android 15+ 强制边到边以后，状态栏/导航栏区域露出来的是原生窗口背景色，
 * 网页改不了；`setStatusBarColor` 也会被系统忽略。所以每次主题或底色变化都要告诉原生一侧，
 * 让它把窗口/DecorView 的底色一起刷掉，并切状态栏图标的明暗。
 * 网页版没有这个插件，静默跳过。
 */
const syncNativeBars = (color: string) => {
  const plugin = (
    window as unknown as {
      Capacitor?: { Plugins?: { AppTheme?: { set: (options: { dark: boolean; color: string }) => Promise<unknown> } } }
    }
  ).Capacitor?.Plugins?.AppTheme
  if (!plugin) {
    return
  }
  void plugin
    .set({ dark: document.body.classList.contains('dark'), color })
    .catch(() => {
      // 原生侧失败不影响网页
    })
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
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  onMediaChange(query, syncTheme)
  useSettings.subscribe(syncTheme)
}
