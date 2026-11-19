import { currentFontScale, useSettings } from '../services/settings.js'

/**
 * 全局外观：把主题颜色、背景颜色、背景图片与字号写进文档级 CSS 变量。
 * 变量名与 theme.css 对应，组件不用感知具体取值。
 */

const hexToRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

const toHex = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')

/** 透明度叠加：把十六进制颜色转成 rgba */
export const withAlpha = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 按权重混合两种颜色，weight 是后者所占比例 */
export const mixColor = (from: string, to: string, weight: number): string => {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  return `#${a
    .map((value, index) => toHex(value + (b[index] - value) * weight))
    .join('')}`
}

/** 主题色要覆盖的变量：主色、按钮、气泡与侧栏强调 */
const ACCENT_VARS = [
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-button-ghost-active-hover',
  '--dsw-specific-bubble',
  '--dsw-specific-sidebar-nav-item-active-accent',
] as const

/** 背景色覆盖的变量：页面底色与浅底容器 */
const BACKGROUND_VARS = ['--dsw-alias-bg-base', '--dsw-alias-bg-subtle'] as const

/** 排版变量：字号缩放要连同行高一起重算，避免行距变形 */
const FONT_VARS = [
  '--ds-font-size-m',
  '--dsw-font-markdown-h1',
  '--dsw-font-markdown-h2',
  '--dsw-font-markdown-h3',
  '--dsw-font-markdown-h4',
  '--dsw-font-markdown-base',
  '--dsw-font-markdown-base-strong',
  '--dsw-font-markdown-table',
  '--dsw-font-markdown-table-head',
  '--dsw-font-markdown-small',
  '--dsw-font-markdown-small-strong',
  '--dsw-font-s-strong-14',
  '--dsw-font-xs-13',
  '--oxchat-font-scale',
] as const

/** 字号与行高按比例缩放后写回排版变量 */
const fontVars = (scale: number): [string, string][] => {
  const size = (value: number) => `${Math.round(value * scale * 100) / 100}px`
  const text = (weight: string, value: number, line: number) =>
    `${weight}${size(value)}/${size(line)} var(--dsw-font-family)`
  return [
    ['--oxchat-font-scale', String(scale)],
    ['--ds-font-size-m', size(14)],
    ['--dsw-font-markdown-h1', text('700 ', 24, 34)],
    ['--dsw-font-markdown-h2', text('700 ', 22, 32)],
    ['--dsw-font-markdown-h3', text('700 ', 20, 30)],
    ['--dsw-font-markdown-h4', text('600 ', 16, 28)],
    ['--dsw-font-markdown-base', text('', 16, 28)],
    ['--dsw-font-markdown-base-strong', text('600 ', 16, 28)],
    ['--dsw-font-markdown-table', text('', 15, 25)],
    ['--dsw-font-markdown-table-head', text('500 ', 15, 25)],
    ['--dsw-font-markdown-small', text('', 14, 24)],
    ['--dsw-font-markdown-small-strong', text('600 ', 14, 24)],
    ['--dsw-font-s-strong-14', text('500 ', 14, 22)],
    ['--dsw-font-xs-13', text('', 13, 20)],
  ]
}
const IMAGE_VARS = ['--oxchat-bg-image', '--oxchat-bg-opacity', '--oxchat-bg-blur'] as const

const clearVars = (style: CSSStyleDeclaration, names: readonly string[]) => {
  for (const name of names) {
    style.removeProperty(name)
  }
}

export const applyAppearance = () => {
  const body = document.body
  if (!body) {
    return
  }
  const style = body.style
  const { themeAccent, themeBackground, bgImage, bgImageOpacity, bgImageBlur } =
    useSettings.getState()
  const dark = body.hasAttribute('data-ds-dark-theme')

  if (themeAccent) {
    style.setProperty('--dsw-alias-brand-primary', themeAccent)
    style.setProperty('--dsw-alias-brand-text', themeAccent)
    style.setProperty('--dsw-alias-button-primary-fill', themeAccent)
    style.setProperty(
      '--dsw-alias-button-primary-hover',
      mixColor(themeAccent, dark ? '#ffffff' : '#000000', 0.14)
    )
    style.setProperty('--dsw-alias-button-ghost-active-border', themeAccent)
    style.setProperty(
      '--dsw-alias-button-ghost-active-fill',
      withAlpha(themeAccent, dark ? 0.22 : 0.12)
    )
    style.setProperty(
      '--dsw-alias-button-ghost-active-hover',
      withAlpha(themeAccent, dark ? 0.3 : 0.18)
    )
    style.setProperty('--dsw-specific-bubble', withAlpha(themeAccent, dark ? 0.22 : 0.1))
    style.setProperty(
      '--dsw-specific-sidebar-nav-item-active-accent',
      withAlpha(themeAccent, dark ? 0.26 : 0.14)
    )
  } else {
    clearVars(style, ACCENT_VARS)
  }

  // 深色下把浅色底压进夜色里，色相不变但不刺眼
  const base = themeBackground
    ? dark
      ? mixColor(themeBackground, '#0f1115', 0.86)
      : themeBackground
    : ''
  if (bgImage) {
    // 页面底色保持不透明（设置页、面板需要它）；聊天区靠 --oxchat-surface-base 透出图片，
    // 再由遮罩层保证正文可读性
    if (base) {
      for (const name of BACKGROUND_VARS) {
        style.setProperty(name, base)
      }
    } else {
      clearVars(style, BACKGROUND_VARS)
    }
    body.classList.add('has-bg-image')
    style.setProperty('--oxchat-bg-image', `url("${bgImage}")`)
    style.setProperty('--oxchat-bg-opacity', String(bgImageOpacity / 100))
    style.setProperty('--oxchat-bg-blur', bgImageBlur ? '8px' : '0px')
  } else {
    if (base) {
      for (const name of BACKGROUND_VARS) {
        style.setProperty(name, base)
      }
    } else {
      clearVars(style, BACKGROUND_VARS)
    }
    body.classList.remove('has-bg-image')
    clearVars(style, IMAGE_VARS)
  }

  for (const [name, value] of fontVars(currentFontScale())) {
    style.setProperty(name, value)
  }
}

/** 设置变化时重新应用：主题切换由 theme.ts 触发，其余由这里订阅 */
export const setupAppearance = () => {
  applyAppearance()
  useSettings.subscribe(applyAppearance)
  return () => {
    clearVars(document.body.style, ACCENT_VARS)
    clearVars(document.body.style, BACKGROUND_VARS)
    clearVars(document.body.style, FONT_VARS)
    clearVars(document.body.style, IMAGE_VARS)
    document.body.classList.remove('has-bg-image')
  }
}
