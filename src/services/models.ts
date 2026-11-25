import { create } from 'zustand'
import { fetchModels, fetchModelsForChannel } from './api/client.js'
import { channelById } from './channels.js'
import { DEFAULT_MODEL } from './api/types.js'

/**
 * 服务端可用模型列表。
 * 只在拿到 API Key 后按需拉取一次，失败时退回内置默认模型，不影响聊天。
 */
type ModelsState = {
  models: string[]
  loading: boolean
  /** 已经拉取成功时对应的 Key，用于避免重复请求 */
  loadedFor: string | null
  /** 每个自定义渠道各自拉到的模型列表（展开时才拉） */
  channelModels: Record<string, string[]>
  channelLoading: Record<string, boolean>
  /** 每个渠道最近一次拉取失败的原因（HTTP 状态 / 网络 / 跨域），面板里直接显示 */
  channelErrors: Record<string, string>
}

export const useModels = create<ModelsState>(() => ({
  models: [],
  loading: false,
  loadedFor: null,
  channelModels: {},
  channelLoading: {},
  channelErrors: {},
}))

/** 按渠道拉模型（展开某个自定义渠道时调用，同一个渠道只拉一次） */
export const loadChannelModels = async (channelId: string): Promise<void> => {
  const state = useModels.getState()
  const cached = state.channelModels[channelId]
  // 已经拿到模型就复用；之前失败（结果为空）允许重试，方便改完 Key 再点一次
  if (channelId === 'deepseek' || state.channelLoading[channelId] || (cached && cached.length > 0)) {
    return
  }
  const channel = channelById(channelId)
  if (!channel.apiKey.trim() || !channel.baseUrl.trim()) {
    return
  }
  useModels.setState((current) => ({ channelLoading: { ...current.channelLoading, [channelId]: true } }))
  try {
    const models = await fetchModelsForChannel(channel)
    useModels.setState((current) => ({
      channelModels: { ...current.channelModels, [channelId]: models },
      channelLoading: { ...current.channelLoading, [channelId]: false },
      channelErrors: { ...current.channelErrors, [channelId]: '' },
    }))
  } catch (error) {
    useModels.setState((current) => ({
      channelLoading: { ...current.channelLoading, [channelId]: false },
      channelErrors: {
        ...current.channelErrors,
        [channelId]: error instanceof Error ? error.message : String(error),
      },
    }))
  }
}

/** 拉取模型列表；同一把 Key 只请求一次（失败的 Key 允许重试） */
export const loadModels = async (apiKey: string): Promise<void> => {
  const { loading, loadedFor } = useModels.getState()
  if (!apiKey || loading || loadedFor === apiKey) {
    return
  }
  useModels.setState({ loading: true })
  try {
    const models = await fetchModels(apiKey)
    useModels.setState({ models, loading: false, loadedFor: apiKey })
  } catch {
    // 接口不可用或结构不符合预期：保留内置默认值
    useModels.setState({ loading: false, loadedFor: null })
  }
}

/** 供界面使用的模型列表：接口结果优先，至少包含默认与当前选中项 */
export const modelOptions = (current: string): string[] => {
  const { models } = useModels.getState()
  const list = models.length > 0 ? [...models] : [DEFAULT_MODEL]
  if (!list.includes(current)) {
    list.unshift(current)
  }
  return list
}
