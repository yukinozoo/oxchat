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
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  model: ChatModel
  /** 思考深度：off 关闭思考；low/high/max 对应接口的 effort */
  thinkingDepth: ThinkingDepth
  /** 当前使用的模型渠道 id（'deepseek' 或自定义渠道） */
  activeChannel: string
  /** 思考结束后自动折叠思考内容 */
  autoCollapseThinking: boolean
  /** 是否在提问尾部附带极小的时间标记（`[环境时钟: HH:mm]`），规则句另有一句静态进 system */
  sendClockTime: boolean
  /** 附件原件存哪：native = App 私有目录（安卓），idb = WebView 的 IndexedDB（网页版/逃生） */
  fileStore: 'native' | 'idb'
  /** 我的气泡底色（#rrggbb）；空串表示跟随强调色 */
  bubbleUser: string
  /** AI 气泡底色（#rrggbb）；空串表示跟随强调色 */
  bubbleAi: string
  /** 我的气泡不透明度（10~100，100 = 沿用按主题算出的默认值） */
  bubbleUserAlpha: number
  /** AI 气泡不透明度（10~100） */
  bubbleAiAlpha: number
  /** 给 AI 回答套气泡（默认关：多数人习惯无边框正文） */
  aiBubble: boolean
  /** 重新打开 App 时回到上次看的那条对话，而不是新对话 */
  resumeLastSession: boolean
  /** 在 AI 回复下方显示官方返回的 token / 缓存用量（默认关） */
  showMessageUsage: boolean
  /** 整理（压缩）前自动备份一份对话（默认开） */
  compactBackup: boolean
  /** 单份文档的 token 预算：超出后本地截断再上传 */
  /** Gitee 同步：仓库所有者 / 仓库名 / 私人令牌（原生壳里同时写加密存储） */
  giteeOwner: string
  giteeRepo: string
  giteeToken: string
  /** 上次成功同步的时间戳，0 表示还没同步过 */
  giteeLastSync: number
  /** 自动备份：每 5 条回复 / 切后台超 10 分钟时自动上传 */
  giteeAutoSync: boolean
  /** 自动拉取：进入应用 / 切回前台时静默拉取并合并（近实时多端） */
  giteeAutoPull: boolean
  /** 上下文窗口（token）：0 表示不限，超出后从最早的消息开始丢弃 */
  contextWindow: number
  /** 达到触发阈值时先把更早的对话总结成摘要，再发送本轮请求 */
  autoCompact: boolean
  /** 自动压缩的触发阈值：占窗口的百分比 */
  compactThreshold: number
  /** 自动压缩后保留最近原文的比例：占窗口的百分比 */
  compactKeep: number
  /** 压缩面板：压缩范围（keepRecent / all / earlier / nearer） */
  compactScope: string
  /** 压缩面板：保留最近原文的轮数 */
  compactKeepRounds: number
  /** 压缩面板：「较早 / 较近历史」的字数限制 */
  compactChars: number
  /** 压缩面板：摘要用哪个模型；空字符串表示跟随当前对话模型 */
  compactModel: string
  /** 压缩面板：摘要目标字数 */
  compactSummaryChars: number
  /** 压缩面板：总输出上限（token）；0 表示不传，交给服务端默认 */
  compactMaxOutput: number
  /** 压缩面板：把被压缩的用户提问原文一起带上 */
  compactVerbatimUser: boolean
  /** 压缩面板：选中的摘要模板 id（内置：general/roleplay/debug/plan/study） */
  compactTemplate: string
  /** 采样温度：0–2，官方默认 1.0 */
  temperature: number
  /** 全局提示词：作为每次请求的 system */
  globalPrompt: string
  /** 「我的角色」的名字（用于界面显示与 system 里的称呼） */
  userName: string
  /** 「我的角色」的头像（data URL，正方形）；空字符串表示用名字首字占位 */
  userAvatar: string
  /** 主题颜色（强调色）；空字符串表示使用默认蓝 */
  themeAccent: string
  /** 背景颜色；空字符串表示使用默认底色 */
  themeBackground: string
  /** 背景图片（缩放后的 data URL）；空字符串表示没有图片 */
  bgImage: string
  /** 记录过背景图但这次没读出来（用来提示"重新选一张"） */
  bgImageMissing: boolean
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
  thinking: 'oxchat:thinking',
  search: 'oxchat:search',
  siderCollapsed: 'oxchat:sider-collapsed',
  model: 'oxchat:model',
  thinkingDepth: 'oxchat:thinking-depth',
  activeChannel: 'oxchat:active-channel',
  autoCollapseThinking: 'oxchat:auto-collapse-thinking',
  sendClockTime: 'oxchat:send-clock-time',
  fileStore: 'oxchat:file-store',
  bubbleUser: 'oxchat:bubble-user',
  bubbleAi: 'oxchat:bubble-ai',
  bubbleUserAlpha: 'oxchat:bubble-user-alpha',
  bubbleAiAlpha: 'oxchat:bubble-ai-alpha',
  aiBubble: 'oxchat:ai-bubble',
  resumeLastSession: 'oxchat:resume-last-session',
  showMessageUsage: 'oxchat:show-message-usage',
  compactBackup: 'oxchat:compact-backup',
  giteeOwner: 'oxchat:gitee-owner',
  giteeRepo: 'oxchat:gitee-repo',
  giteeToken: 'oxchat:gitee-token',
  giteeLastSync: 'oxchat:gitee-last-sync',
  giteeAutoSync: 'oxchat:gitee-auto-sync',
  giteeAutoPull: 'oxchat:gitee-auto-pull',
  contextWindow: 'oxchat:context-window',
  autoCompact: 'oxchat:auto-compact',
  compactThreshold: 'oxchat:compact-threshold',
  compactKeep: 'oxchat:compact-keep',
  compactScope: 'oxchat:compact-scope',
  compactKeepRounds: 'oxchat:compact-keep-rounds',
  compactChars: 'oxchat:compact-chars',
  compactModel: 'oxchat:compact-model',
  compactSummaryChars: 'oxchat:compact-summary-chars',
  compactMaxOutput: 'oxchat:compact-max-output',
  compactVerbatimUser: 'oxchat:compact-verbatim-user',
  compactTemplate: 'oxchat:compact-template',
  temperature: 'oxchat:temperature',
  globalPrompt: 'oxchat:global-prompt',
  userName: 'oxchat:user-name',
  userAvatar: 'oxchat:user-avatar',
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

/** 具体时刻默认开启：off 才算关闭（用户问「现在几点」时模型才有据可依） */
const initialSendClockTime = (): boolean => read(KEYS.sendClockTime) !== 'false'

/** 附件存储位置：只有显式选过 IndexedDB 才算 idb；网页版由调用方判断插件是否存在 */
const initialFileStore = (): 'native' | 'idb' =>
  read(KEYS.fileStore) === 'idb' ? 'idb' : 'native'

const initialBubbleColor = (key: string): string => normalizeColor(read(key))

/** 气泡不透明度：10~100，默认 100（= 沿用强调色派生的默认值） */
const initialBubbleAlpha = (key: string): number => {
  const raw = Number(read(key))
  if (!Number.isFinite(raw) || raw <= 0) {
    return 100
  }
  return Math.min(100, Math.max(10, Math.round(raw)))
}
/** 默认关闭：不打扰「每次都是新对话」的习惯 */
const initialResumeLastSession = (): boolean => read(KEYS.resumeLastSession) === 'true'
/** 默认关闭：多数人不想每条回复都挂一串数字 */
const initialShowMessageUsage = (): boolean => read(KEYS.showMessageUsage) === 'true'
/** 默认开启：备份很便宜，整理出错时能救回来 */
const initialCompactBackup = (): boolean => read(KEYS.compactBackup) !== 'false'
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

/** 读取整数设置，越界回落到默认 */
const initialInt = (key: string, fallback: number, min: number, max: number): number => {
  const value = readNumber(key)
  return Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback
}

const COMPACT_SCOPES = ['keepRecent', 'all', 'earlier', 'nearer'] as const

/** 压缩范围：非法值回落到「保留最近原文」 */
const initialScope = (): string => {
  const value = read(KEYS.compactScope)
  return value && (COMPACT_SCOPES as readonly string[]).includes(value) ? value : 'keepRecent'
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
    thinking: thinkingDepth !== 'off',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
    model: initialModel(),
    thinkingDepth,
    activeChannel: read(KEYS.activeChannel) ?? 'deepseek',
    autoCollapseThinking: initialAutoCollapseThinking(),
    sendClockTime: initialSendClockTime(),
    fileStore: initialFileStore(),
    bubbleUser: initialBubbleColor(KEYS.bubbleUser),
    bubbleAi: initialBubbleColor(KEYS.bubbleAi),
    bubbleUserAlpha: initialBubbleAlpha(KEYS.bubbleUserAlpha),
    bubbleAiAlpha: initialBubbleAlpha(KEYS.bubbleAiAlpha),
    aiBubble: read(KEYS.aiBubble) === 'true',
    resumeLastSession: initialResumeLastSession(),
    showMessageUsage: initialShowMessageUsage(),
    compactBackup: initialCompactBackup(),
    giteeOwner: read(KEYS.giteeOwner) ?? '',
    giteeRepo: read(KEYS.giteeRepo) ?? '',
    giteeToken: read(KEYS.giteeToken) ?? '',
    giteeLastSync: Number(read(KEYS.giteeLastSync) ?? 0) || 0,
    giteeAutoSync: read(KEYS.giteeAutoSync) === 'true',
    giteeAutoPull: read(KEYS.giteeAutoPull) === 'true',
    contextWindow: initialContextWindow(),
    autoCompact: initialAutoCompact(),
    compactThreshold: initialPercent(KEYS.compactThreshold, 50),
    compactKeep: initialPercent(KEYS.compactKeep, 20),
    compactScope: initialScope(),
    compactKeepRounds: initialInt(KEYS.compactKeepRounds, 6, 1, 50),
    compactChars: initialInt(KEYS.compactChars, 6000, 500, 200_000),
    compactModel: read(KEYS.compactModel) ?? '',
    compactSummaryChars: initialInt(KEYS.compactSummaryChars, 4096, 300, 20_000),
    compactMaxOutput: initialInt(KEYS.compactMaxOutput, 0, 0, 64_000),
    compactVerbatimUser: read(KEYS.compactVerbatimUser) === 'true',
    compactTemplate: read(KEYS.compactTemplate) ?? 'general',
    temperature: initialTemperature(),
    globalPrompt: initialGlobalPrompt(),
    userName: read(KEYS.userName) ?? '',
    userAvatar: read(KEYS.userAvatar) ?? '',
    themeAccent: initialColor(KEYS.themeAccent),
    themeBackground: initialColor(KEYS.themeBackground),
    // 背景图体积大，放在 IndexedDB，启动后异步载入（见 loadBackgroundImage）
    bgImage: '',
    bgImageMissing: false,
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


export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setActiveChannel = (activeChannel: string) => {
  write(KEYS.activeChannel, activeChannel)
  useSettings.setState({ activeChannel })
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

export const setFileStore = (fileStore: 'native' | 'idb') => {
  write(KEYS.fileStore, fileStore)
  useSettings.setState({ fileStore })
}

export const setSendClockTime = (sendClockTime: boolean) => {
  write(KEYS.sendClockTime, String(sendClockTime))
  useSettings.setState({ sendClockTime })
}

export const setBubbleUser = (bubbleUser: string) => {
  write(KEYS.bubbleUser, normalizeColor(bubbleUser) || null)
  useSettings.setState({ bubbleUser: normalizeColor(bubbleUser) })
}

export const setBubbleAi = (bubbleAi: string) => {
  write(KEYS.bubbleAi, normalizeColor(bubbleAi) || null)
  useSettings.setState({ bubbleAi: normalizeColor(bubbleAi) })
}

export const setBubbleUserAlpha = (bubbleUserAlpha: number) => {
  const value = Math.min(100, Math.max(10, Math.round(bubbleUserAlpha)))
  write(KEYS.bubbleUserAlpha, String(value))
  useSettings.setState({ bubbleUserAlpha: value })
}

export const setBubbleAiAlpha = (bubbleAiAlpha: number) => {
  const value = Math.min(100, Math.max(10, Math.round(bubbleAiAlpha)))
  write(KEYS.bubbleAiAlpha, String(value))
  useSettings.setState({ bubbleAiAlpha: value })
}

export const setAiBubble = (aiBubble: boolean) => {
  write(KEYS.aiBubble, String(aiBubble))
  useSettings.setState({ aiBubble })
}

export const setGiteeRepoConfig = (owner: string, repo: string) => {
  write(KEYS.giteeOwner, owner.trim())
  write(KEYS.giteeRepo, repo.trim())
  useSettings.setState({ giteeOwner: owner.trim(), giteeRepo: repo.trim() })
}

/** 原生壳里把令牌加密存一份；网页版只能落 localStorage，需在界面上提示风险 */
const secureStore = () => {
  if (typeof window === 'undefined') {
    return undefined
  }
  const capacitor = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
  return capacitor?.Plugins?.SecureStore as
    | {
        save: (options: { key: string; value: string }) => Promise<void>
        get: (options: { key: string }) => Promise<{ value: string | null }>
        remove: (options: { key: string }) => Promise<void>
      }
    | undefined
}

const GITEE_TOKEN_KEY = 'oxchat:gitee-token'

export const setGiteeToken = (token: string) => {
  const value = token.trim()
  write(KEYS.giteeToken, value || null)
  useSettings.setState({ giteeToken: value })
  const store = secureStore()
  if (store) {
    void (value ? store.save({ key: GITEE_TOKEN_KEY, value }) : store.remove({ key: GITEE_TOKEN_KEY })).catch(
      () => undefined
    )
  }
}

export const setGiteeAutoPull = (giteeAutoPull: boolean) => {
  write(KEYS.giteeAutoPull, String(giteeAutoPull))
  useSettings.setState({ giteeAutoPull })
}

export const setGiteeAutoSync = (giteeAutoSync: boolean) => {
  write(KEYS.giteeAutoSync, String(giteeAutoSync))
  useSettings.setState({ giteeAutoSync })
}

export const markGiteeSynced = (at = Date.now()) => {
  write(KEYS.giteeLastSync, String(at))
  useSettings.setState({ giteeLastSync: at })
}

/** 原生壳启动时从加密存储补读一次令牌（localStorage 里可能没有） */
const hydrateGiteeToken = async () => {
  const store = secureStore()
  if (!store || useSettings.getState().giteeToken) {
    return
  }
  try {
    const { value } = await store.get({ key: GITEE_TOKEN_KEY })
    if (value) {
      useSettings.setState({ giteeToken: value })
    }
  } catch {
    // 解不开（重装/密钥被清）时保持空，让用户重新填
  }
}

void hydrateGiteeToken()

export const setCompactBackup = (compactBackup: boolean) => {
  write(KEYS.compactBackup, String(compactBackup))
  useSettings.setState({ compactBackup })
}

export const setShowMessageUsage = (showMessageUsage: boolean) => {
  write(KEYS.showMessageUsage, String(showMessageUsage))
  useSettings.setState({ showMessageUsage })
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

export const setCompactKeepRounds = (compactKeepRounds: number) => {
  write(KEYS.compactKeepRounds, String(compactKeepRounds))
  useSettings.setState({ compactKeepRounds })
}

export const setCompactKeep = (compactKeep: number) => {
  write(KEYS.compactKeep, String(compactKeep))
  useSettings.setState({ compactKeep })
}

export const setCompactPanel = (
  patch: Partial<
    Pick<
      Settings,
      | 'compactScope'
      | 'compactKeepRounds'
      | 'compactChars'
      | 'compactModel'
      | 'compactSummaryChars'
      | 'compactMaxOutput'
      | 'compactVerbatimUser'
      | 'compactTemplate'
    >
  >
) => {
  const keys: Record<string, string> = {
    compactScope: KEYS.compactScope,
    compactKeepRounds: KEYS.compactKeepRounds,
    compactChars: KEYS.compactChars,
    compactModel: KEYS.compactModel,
    compactSummaryChars: KEYS.compactSummaryChars,
    compactMaxOutput: KEYS.compactMaxOutput,
    compactVerbatimUser: KEYS.compactVerbatimUser,
    compactTemplate: KEYS.compactTemplate,
  }
  for (const [field, value] of Object.entries(patch)) {
    const key = keys[field]
    if (key) {
      write(key, String(value))
    }
  }
  useSettings.setState(patch)
}

export const setTemperature = (temperature: number) => {
  write(KEYS.temperature, String(temperature))
  useSettings.setState({ temperature })
}

export const setUserName = (userName: string) => {
  write(KEYS.userName, userName)
  useSettings.setState({ userName })
}

export const setUserAvatar = (userAvatar: string) => {
  write(KEYS.userAvatar, userAvatar)
  useSettings.setState({ userAvatar })
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

/**
 * 保存背景图：先落一个"曾经设置过"的标记，再写 IndexedDB。
 * 写库是异步的（应用可能马上被安装/杀进程打断），所以这里 await 并回报结果，
 * UI 失败时能明确提示，而不是下次启动发现图没了。
 */
export const setBgImage = async (bgImage: string): Promise<boolean> => {
  useSettings.setState({ bgImage, bgImageMissing: false })
  write(KEYS.bgImage, null)
  if (!bgImage) {
    write(BG_IMAGE_MARKER_KEY, null)
    try {
      await db.deleteSetting(BG_IMAGE_STORAGE_KEY)
    } catch {
      // 删不掉也不影响：下次启动读到空图会当作没有
    }
    return true
  }
  write(BG_IMAGE_MARKER_KEY, '1')
  try {
    await db.setSetting(BG_IMAGE_STORAGE_KEY, bgImage)
    return true
  } catch (error) {
    write(BG_IMAGE_MARKER_KEY, null)
    db.reportStorageError('save background image')(error)
    return false
  }
}

/** 背景图在 IndexedDB 里的键 */
const BG_IMAGE_STORAGE_KEY = 'oxchat:bg-image'
/** localStorage 里的「设置过背景图」标记：读库失败时用来区分"没设过"和"丢了" */
const BG_IMAGE_MARKER_KEY = 'oxchat:bg-image-saved'

/**
 * 启动后异步载入背景图；顺手把旧版本存在 localStorage 里的 base64 迁到 IndexedDB，
 * 免得继续和 API Key 抢那 5MB 配额。
 */
const loadBackgroundImage = async (attempt = 0) => {
  try {
    const stored = await db.getSetting(BG_IMAGE_STORAGE_KEY)
    if (stored) {
      useSettings.setState({ bgImage: stored, bgImageMissing: false })
      return
    }
    const legacy = read(KEYS.bgImage)
    if (legacy) {
      await db.setSetting(BG_IMAGE_STORAGE_KEY, legacy)
      write(KEYS.bgImage, null)
      write(BG_IMAGE_MARKER_KEY, '1')
      useSettings.setState({ bgImage: legacy, bgImageMissing: false })
      return
    }
    // 标记在、图不在：要么写库没成功，要么数据被清过 —— 让界面提示重新选一张
    if (read(BG_IMAGE_MARKER_KEY)) {
      useSettings.setState({ bgImageMissing: true })
    }
  } catch (error) {
    // 打开数据库可能被阻塞（多标签页升级等）：稍后重试一次，仍失败才放弃
    if (attempt === 0) {
      setTimeout(() => void loadBackgroundImage(1), 1500)
      return
    }
    db.reportStorageError('load background image')(error)
    if (read(BG_IMAGE_MARKER_KEY)) {
      useSettings.setState({ bgImageMissing: true })
    }
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
