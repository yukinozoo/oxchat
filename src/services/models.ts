import { create } from 'zustand'
import { fetchModels } from './api/client.js'
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
}

export const useModels = create<ModelsState>(() => ({
  models: [],
  loading: false,
  loadedFor: null,
}))

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
