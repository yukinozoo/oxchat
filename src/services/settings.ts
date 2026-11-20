import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { DEFAULT_MODEL, type ChatModel } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'
import * as db from './chat/db.js'

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
  /** 朗读引擎：deepseek 走语音合成接口（计费），system 用系统朗读（免费） */
  ttsEngine: 'deepseek' | 'system'
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  model: ChatModel
  /** 思考深度：off 关闭思考；low/high/max 对应接口的 effort */
  thinkingDepth: ThinkingDepth
  /** 思考结束后自动折叠思考内容 */
  autoCollapseThinking: boolean
  /** 重新打开 App 时回到上次看的那条对话，而不是新对话 */
  resumeLastSession: boolean
  /** 上下文窗口（token）：0 表示不限，超出后从最早的消息开始丢弃 */
  contextWindow: number
  /** 达到触发阈值时先把更早的对话总结成摘要，再发送本轮请求 */
  autoCompact: boolean
  /** 自动压缩的触发阈值：占窗口的百分比 */
  compactThreshold: number
  /** 自动压缩后保留最近原文的比例：占窗口的百分比 */
  compactKeep: number
  /** 采样温度：0–2，官方默认 1.0 */
  temperature: number
  /** 全局提示词：作为每次请求的 system */
  globalPrompt: string
  /** 主题颜色（强调色）；空字符串表示使用默认蓝 */
  themeAccent: string
  /** 背景颜色；空字符串表示使用默认底色 */
  themeBackground: string
  /** 背景图片（缩放后的 data URL）；空字符串表示没有图片 */
  bgImage: string
  /** 背景图片不透明度：10–100 */
  bgImageOpacity: number
  /** 背景图片模糊 */
  bgImageBlur: boolean
  /** 正文字号缩放：0.85–1.4 */
  fontSize: number
  /** 跟随系统字号：开启时不做额外缩放 */
  fontSizeFollowSystem: boolean
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
  ttsEngine: 'oxchat:tts-engine',
  thinking: 'oxchat:thinking',
  search: 'oxchat:search',
  siderCollapsed: 'oxchat:sider-collapsed',
  model: 'oxchat:model',
  thinkingDepth: 'oxchat:thinking-depth',
  autoCollapseThinking: 'oxchat:auto-collapse-thinking',
  resumeLastSession: 'oxchat:resume-last-session',
  contextWindow: 'oxchat:context-window',
  autoCompact: 'oxchat:auto-compact',
  compactThreshold: 'oxchat:compact-threshold',
  compactKeep: 'oxchat:compact-keep',
  temperature: 'oxchat:temperature',
  globalPrompt: 'oxchat:global-prompt',
  themeAccent: 'oxchat:theme-accent',
  themeBackground: 'oxchat:theme-background',
  bgImage: 'oxchat:bg-image',
  bgImageOpacity: 'oxchat:bg-image-opacity',
  bgImageBlur: 'oxchat:bg-image-blur',
  fontSize: 'oxchat:font-size',
  fontSizeFollowSystem: 'oxchat:font-size-follow-system',
} as const

/** 字号缩放的可用区间与默认值 */
export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 1.4

/** 只接受 #rrggbb；其它值当作未设置 */
export const normalizeColor = (value: string | null): string =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : ''

const initialColor = (key: string): string => normalizeColor(read(key))

const initialBgImageOpacity = (): number => {
  const value = readNumber(KEYS.bgImageOpacity)
  return Number.isFinite(value) && value >= 10 && value <= 100 ? value : 40
}

const initialFontSize = (): number => {
  const value = readNumber(KEYS.fontSize)
  return Number.isFinite(value) && value >= FONT_SCALE_MIN && value <= FONT_SCALE_MAX ? value : 1
}

/** 未保存过时使用应用内字号（滑杆可用），需要时再打开跟随系统 */
const initialFontSizeFollowSystem = (): boolean =>
  read(KEYS.fontSizeFollowSystem) === 'true'

/** 全局提示词的默认值：与官方客户端一致 */
export const DEFAULT_GLOBAL_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 上下文窗口的可选值（token）；0 表示不限 */
export const CONTEXT_WINDOWS = [0, 8000, 16000, 32000, 64000, 128000, 1000000] as const

/** 上下文窗口的显示文案：0 交给调用方显示「不限」，百万级用 M 表示 */
export const formatContextWindow = (value: number): string =>
  value <= 0 ? '' : value >= 1_000_000 ? `${value / 1_000_000}M` : `${Math.round(value / 1000)}K`

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

/** 默认走 DeepSeek 音色；系统朗读需要用户主动切换 */
const initialTtsEngine = (): 'deepseek' | 'system' =>
  read(KEYS.ttsEngine) === 'system' ? 'system' : 'deepseek'

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
/** 默认关闭：不打扰「每次都是新对话」的习惯 */
const initialResumeLastSession = (): boolean => read(KEYS.resumeLastSession) === 'true'

/** 读取数字设置：没保存过时给 NaN，避免 Number(null) 被当成 0 而吃掉落默认值 */
const readNumber = (key: string): number => {
  const raw = read(key)
  return raw === null || raw === '' ? Number.NaN : Number(raw)
}

/** 读取 0–100 的百分比设置，非法值回落到默认 */
const initialPercent = (key: string, fallback: number): number => {
  const value = readNumber(key)
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback
}

/** 未保存过时默认 1M：新对话按百万级窗口起步，超出才压缩或丢弃 */
const initialContextWindow = (): number => {
  const value = readNumber(KEYS.contextWindow)
  return (CONTEXT_WINDOWS as readonly number[]).includes(value) ? value : 1000000
}

/** 未保存过时默认开启自动压缩，窗口不限时不会触发 */
const initialAutoCompact = (): boolean => read(KEYS.autoCompact) !== 'false'

/** 温度：0–2，非法值回落到官方默认 1.0 */
const initialTemperature = (): number => {
  const value = readNumber(KEYS.temperature)
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : 1
}

const initialGlobalPrompt = (): string => read(KEYS.globalPrompt) ?? DEFAULT_GLOBAL_PROMPT

export const useSettings = create<Settings>(() => {
  // 思考开关与强度保持一致：默认高强度时开关也应为开
  const thinkingDepth = initialThinkingDepth()
  return {
    apiKey: read(KEYS.apiKey),
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    ttsEngine: initialTtsEngine(),
    thinking: thinkingDepth !== 'off',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
    model: initialModel(),
    thinkingDepth,
    autoCollapseThinking: initialAutoCollapseThinking(),
    resumeLastSession: initialResumeLastSession(),
    contextWindow: initialContextWindow(),
    autoCompact: initialAutoCompact(),
    compactThreshold: initialPercent(KEYS.compactThreshold, 50),
    compactKeep: initialPercent(KEYS.compactKeep, 20),
    temperature: initialTemperature(),
    globalPrompt: initialGlobalPrompt(),
    themeAccent: initialColor(KEYS.themeAccent),
    themeBackground: initialColor(KEYS.themeBackground),
    // 背景图体积大，放在 IndexedDB，启动后异步载入（见 loadBackgroundImage）
    bgImage: '',
    bgImageOpacity: initialBgImageOpacity(),
    bgImageBlur: read(KEYS.bgImageBlur) === 'true',
    fontSize: initialFontSize(),
    fontSizeFollowSystem: initialFontSizeFollowSystem(),
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

export const setTtsEngine = (ttsEngine: 'deepseek' | 'system') => {
  write(KEYS.ttsEngine, ttsEngine)
  useSettings.setState({ ttsEngine })
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

export const setResumeLastSession = (resumeLastSession: boolean) => {
  write(KEYS.resumeLastSession, String(resumeLastSession))
  useSettings.setState({ resumeLastSession })
}

export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
}

export const setContextWindow = (contextWindow: number) => {
  write(KEYS.contextWindow, String(contextWindow))
  useSettings.setState({ contextWindow })
}

export const setAutoCompact = (autoCompact: boolean) => {
  write(KEYS.autoCompact, String(autoCompact))
  useSettings.setState({ autoCompact })
}

export const setCompactThreshold = (compactThreshold: number) => {
  write(KEYS.compactThreshold, String(compactThreshold))
  useSettings.setState({ compactThreshold })
}

export const setCompactKeep = (compactKeep: number) => {
  write(KEYS.compactKeep, String(compactKeep))
  useSettings.setState({ compactKeep })
}

export const setTemperature = (temperature: number) => {
  write(KEYS.temperature, String(temperature))
  useSettings.setState({ temperature })
}

export const setGlobalPrompt = (globalPrompt: string) => {
  write(KEYS.globalPrompt, globalPrompt)
  useSettings.setState({ globalPrompt })
}

/** 每次请求使用的 system：清空后回落到默认值，避免发出空提示词 */
export const currentSystemPrompt = (): string =>
  useSettings.getState().globalPrompt.trim() || DEFAULT_GLOBAL_PROMPT

export const setThemeAccent = (themeAccent: string) => {
  write(KEYS.themeAccent, normalizeColor(themeAccent) || null)
  useSettings.setState({ themeAccent: normalizeColor(themeAccent) })
}

export const setThemeBackground = (themeBackground: string) => {
  write(KEYS.themeBackground, normalizeColor(themeBackground) || null)
  useSettings.setState({ themeBackground: normalizeColor(themeBackground) })
}

export const setBgImage = (bgImage: string) => {
  useSettings.setState({ bgImage })
  write(KEYS.bgImage, null)
  if (bgImage) {
    void db.setSetting(BG_IMAGE_STORAGE_KEY, bgImage).catch(() => undefined)
  } else {
    void db.deleteSetting(BG_IMAGE_STORAGE_KEY).catch(() => undefined)
  }
}

/** 背景图在 IndexedDB 里的键 */
const BG_IMAGE_STORAGE_KEY = 'oxchat:bg-image'

/**
 * 启动后异步载入背景图；顺手把旧版本存在 localStorage 里的 base64 迁到 IndexedDB，
 * 免得继续和 API Key 抢那 5MB 配额。
 */
const loadBackgroundImage = async () => {
  try {
    const stored = await db.getSetting(BG_IMAGE_STORAGE_KEY)
    if (stored) {
      useSettings.setState({ bgImage: stored })
      return
    }
    const legacy = read(KEYS.bgImage)
    if (legacy) {
      await db.setSetting(BG_IMAGE_STORAGE_KEY, legacy)
      write(KEYS.bgImage, null)
      useSettings.setState({ bgImage: legacy })
    }
  } catch {
    // 没有可用的 IndexedDB（隐私模式等）：背景图功能不可用，其它设置不受影响
  }
}

void loadBackgroundImage()

export const setBgImageOpacity = (bgImageOpacity: number) => {
  const value = Math.min(100, Math.max(10, Math.round(bgImageOpacity)))
  write(KEYS.bgImageOpacity, String(value))
  useSettings.setState({ bgImageOpacity: value })
}

export const setBgImageBlur = (bgImageBlur: boolean) => {
  write(KEYS.bgImageBlur, String(bgImageBlur))
  useSettings.setState({ bgImageBlur })
}

export const setFontSize = (fontSize: number) => {
  const value = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(fontSize * 100) / 100))
  write(KEYS.fontSize, String(value))
  useSettings.setState({ fontSize: value })
}

export const setFontSizeFollowSystem = (fontSizeFollowSystem: boolean) => {
  write(KEYS.fontSizeFollowSystem, String(fontSizeFollowSystem))
  useSettings.setState({ fontSizeFollowSystem })
}

/** 当前生效的字号缩放：跟随系统时不额外缩放 */
export const currentFontScale = (): number => {
  const { fontSize, fontSizeFollowSystem } = useSettings.getState()
  return fontSizeFollowSystem ? 1 : fontSize
}
