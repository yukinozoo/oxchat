import { create } from 'zustand'
/**
 * 模型渠道：DeepSeek 官方 + 用户自建（OpenAI 兼容 / Anthropic / Responses）。
 *
 * 为什么单独一层：模型名不同、Key 也不同，选择器里要按渠道分组显示；
 * 渠道本身存在 localStorage（`oxchat:channels`），当前选中的渠道存设置表。
 *
 * 注意：自定义渠道的**请求路由**还没接（下一批做协议适配），
 * 选中自定义渠道后发送会明确提示，而不是悄悄发到 DeepSeek。
 */
export type ChannelProtocol = 'openai' | 'anthropic' | 'responses'

export type Channel = {
  id: string
  name: string
  protocol: ChannelProtocol
  baseUrl: string
  apiKey: string
  /** 该渠道下的模型默认带图片能力（下一批接请求时用） */
  vision: boolean
  /** 该渠道下的模型默认开思考 */
  thinking: boolean
}

export const DEEPSEEK_CHANNEL_ID = 'deepseek'
export const DEEPSEEK_CHANNEL: Channel = {
  id: DEEPSEEK_CHANNEL_ID,
  name: 'DeepSeek 官方',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  vision: true,
  thinking: false,
}

const KEY = 'oxchat:channels'

/** 没有 localStorage 的环境（SSR / 冒烟的静态渲染）当作空列表 */
const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const parse = (raw: string | null): Channel[] => {
  if (!raw) {
    return []
  }
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) {
      return []
    }
    return list.filter(
      (item): item is Channel =>
        Boolean(item) &&
        typeof (item as Channel).id === 'string' &&
        typeof (item as Channel).name === 'string' &&
        typeof (item as Channel).baseUrl === 'string'
    )
  } catch {
    return []
  }
}

/**
 * 渠道存在 localStorage 里（不是 zustand），改了以后界面不会自动重渲染。
 * 这里用一个版本号把「渠道有变化」广播出去：保存 / 删除 / 切换渠道都会 +1，
 * 关心它的组件（欢迎页按钮、侧栏图标、模型面板）订阅它就能立刻更新。
 */
export const useChannelsVersion = create<{ version: number }>(() => ({ version: 0 }))

const bumpChannels = () => {
  useChannelsVersion.setState((state) => ({ version: state.version + 1 }))
}

const write = (list: Channel[]): void => {
  try {
    storage()?.setItem(KEY, JSON.stringify(list))
  } catch {
    // 存不下只影响下次打开
  }
  bumpChannels()
}

/** 全部渠道：官方永远排第一，且不可删除 */
export const listChannels = (): Channel[] => [DEEPSEEK_CHANNEL, ...parse(storage()?.getItem(KEY) ?? null)]

export const channelById = (id: string | null | undefined): Channel =>
  listChannels().find((channel) => channel.id === id) ?? DEEPSEEK_CHANNEL

/** 新建一个自定义渠道；图片与思考默认都开（用户不需要每次手动勾） */
export const createChannel = (input: {
  name: string
  protocol: ChannelProtocol
  baseUrl: string
  apiKey: string
}): string => {
  const id = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const list = parse(storage()?.getItem(KEY) ?? null)
  write([
    ...list,
    {
      id,
      name: input.name.trim(),
      protocol: input.protocol,
      baseUrl: input.baseUrl.trim(),
      apiKey: input.apiKey.trim(),
      vision: true,
      thinking: true,
    },
  ])
  return id
}

export const updateChannel = (id: string, patch: Partial<Omit<Channel, 'id'>>): void => {
  if (id === DEEPSEEK_CHANNEL_ID) {
    return
  }
  write(
    parse(storage()?.getItem(KEY) ?? null).map((channel) =>
      channel.id === id ? { ...channel, ...patch, id: channel.id } : channel
    )
  )
}

export const removeChannel = (id: string): void => {
  if (id === DEEPSEEK_CHANNEL_ID) {
    return
  }
  write(parse(storage()?.getItem(KEY) ?? null).filter((channel) => channel.id !== id))
}

/** 第一个可用的自定义渠道（填了 Base URL 与 Key）；没有则 null */
export const usableCustomChannel = (): Channel | null =>
  listChannels().find(
    (channel) =>
      channel.id !== DEEPSEEK_CHANNEL_ID && channel.baseUrl.trim() !== '' && channel.apiKey.trim() !== ''
  ) ?? null

/** 能不能直接开聊：有官方 Key，或有可用的自定义渠道 */
export const hasUsableChannel = (deepseekKey: string | null): boolean =>
  Boolean(deepseekKey?.trim()) || usableCustomChannel() !== null

/**
 * 组件里用的版本：渠道存在 localStorage，保存/删除后不会自动重渲染，
 * 订阅版本号后 `hasUsableChannel` 的结果才会跟着变（欢迎页按钮、侧栏图标、设置副标题都靠它）。
 */
export const useHasUsableChannel = (deepseekKey: string | null): boolean => {
  useChannelsVersion((state) => state.version)
  return hasUsableChannel(deepseekKey)
}
