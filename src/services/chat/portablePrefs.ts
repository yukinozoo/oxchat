/**
 * 能跟着备份走的「本机配置」：自定义模型渠道、摘要模板。
 *
 * 不含 API Key 与 DeepSeek 官方 Key（安全），也不含界面类设置（换设备无意义）。
 * 导入策略：**只补本机没有的**，别用别人的配置覆盖你正在用的。
 */
const CHANNELS_KEY = 'oxchat:channels'
const ACTIVE_CHANNEL_KEY = 'oxchat:active-channel'
const TEMPLATE_OVERRIDES_KEY = 'oxchat:compact-template-overrides'
const TEMPLATE_CUSTOM_KEY = 'oxchat:compact-template-custom'

export type PortablePrefs = {
  channels?: string
  activeChannel?: string
  templateOverrides?: string
  templateCustom?: string
}

const read = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export const collectPortablePrefs = (): PortablePrefs => {
  const prefs: PortablePrefs = {}
  const channels = read(CHANNELS_KEY)
  const activeChannel = read(ACTIVE_CHANNEL_KEY)
  const templateOverrides = read(TEMPLATE_OVERRIDES_KEY)
  const templateCustom = read(TEMPLATE_CUSTOM_KEY)
  if (channels) {
    prefs.channels = channels
  }
  if (activeChannel && activeChannel !== 'deepseek') {
    prefs.activeChannel = activeChannel
  }
  if (templateOverrides) {
    prefs.templateOverrides = templateOverrides
  }
  if (templateCustom) {
    prefs.templateCustom = templateCustom
  }
  return prefs
}

/** 只写本机还空着的键，返回写入了几项 */
export const applyPortablePrefs = (prefs: PortablePrefs | undefined): number => {
  if (!prefs) {
    return 0
  }
  const pairs: [string, string | undefined][] = [
    [CHANNELS_KEY, prefs.channels],
    [ACTIVE_CHANNEL_KEY, prefs.activeChannel],
    [TEMPLATE_OVERRIDES_KEY, prefs.templateOverrides],
    [TEMPLATE_CUSTOM_KEY, prefs.templateCustom],
  ]
  let written = 0
  for (const [key, value] of pairs) {
    if (!value || read(key)) {
      continue
    }
    try {
      localStorage.setItem(key, value)
      written += 1
    } catch {
      // 存不下就算了
    }
  }
  return written
}
