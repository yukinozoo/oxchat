import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { DEFAULT_MODEL, type ChatModel } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、思考自动折叠 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  model: ChatModel
  /** 思考深度：off 关闭思考；low/high/max 对应接口的 effort */
  thinkingDepth: ThinkingDepth
  /** 思考结束后自动折叠思考内容 */
  autoCollapseThinking: boolean
}

/** 四档思考深度：不思考 / 低 / 中 / 高 */
export type ThinkingDepth = 'off' | 'low' | 'mid' | 'high'

/** 界面档位 → 接口 effort（中档映射到 high，高档用 max） */
export const effortOfDepth = (depth: ThinkingDepth): 'low' | 'high' | 'max' =>
  depth === 'low' ? 'low' : depth === 'high' ? 'max' : 'high'

const KEYS = {
  apiKey: 'oxchat:api-key',
  locale: 'oxchat:locale',
  location: 'oxchat:location',
  themePreference: 'oxchat:theme-preference',
  ttsVoice: 'oxchat:tts-voice',
  thinking: 'oxchat:thinking',
  search: 'oxchat:search',
  siderCollapsed: 'oxchat:sider-collapsed',
  model: 'oxchat:model',
  thinkingDepth: 'oxchat:thinking-depth',
  autoCollapseThinking: 'oxchat:auto-collapse-thinking',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时使用默认模型 */
const initialModel = (): ChatModel => read(KEYS.model)?.trim() || DEFAULT_MODEL

/** 未保存过时默认「高」思考强度；保存过的沿用用户选择 */
const initialThinkingDepth = (): ThinkingDepth => {
  const saved = read(KEYS.thinkingDepth)
  if (saved === 'off' || saved === 'low' || saved === 'mid' || saved === 'high') {
    return saved
  }
  return 'high'
}

/** 未保存过时默认开启：与官方客户端行为一致 */
const initialAutoCollapseThinking = (): boolean => read(KEYS.autoCollapseThinking) !== 'false'

export const useSettings = create<Settings>(() => {
  // 思考开关与强度保持一致：默认高强度时开关也应为开
  const thinkingDepth = initialThinkingDepth()
  return {
    apiKey: read(KEYS.apiKey),
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    thinking: thinkingDepth !== 'off',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
    model: initialModel(),
    thinkingDepth,
    autoCollapseThinking: initialAutoCollapseThinking(),
  }
})

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinkingEffort = (thinkingDepth: ThinkingDepth) => {
  write(KEYS.thinkingDepth, thinkingDepth)
  // thinking 仍作为「是否开启思考」的快照，供消息记录使用
  write(KEYS.thinking, String(thinkingDepth !== 'off'))
  useSettings.setState({ thinkingDepth, thinking: thinkingDepth !== 'off' })
}

export const setThinking = (thinking: boolean) => {
  setThinkingEffort(
    thinking
      ? useSettings.getState().thinkingDepth === 'off'
        ? 'mid'
        : useSettings.getState().thinkingDepth
      : 'off'
  )
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setAutoCollapseThinking = (autoCollapseThinking: boolean) => {
  write(KEYS.autoCollapseThinking, String(autoCollapseThinking))
  useSettings.setState({ autoCollapseThinking })
}

export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
}
