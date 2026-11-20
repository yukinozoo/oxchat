import { modelCaps } from '../modelCaps.js'
import { useSettings } from '../settings.js'

/**
 * 「要不要手动压缩」的判定：把选择权交给用户，不自动改写对话。
 *
 * 触发条件取两者中更早的那个：
 * - 自动压缩的触发阈值（窗口 × 阈值%）
 * - 当前模型的单轮输入上限（例如 v4-pro 的 32768）
 * 窗口设为「不限」(<=0) 时只看模型上限。
 */
export const shouldSuggestCompact = (tokens: number): boolean => {
  const { contextWindow, compactThreshold, model } = useSettings.getState()
  const limits: number[] = []
  if (contextWindow > 0) {
    limits.push((contextWindow * compactThreshold) / 100)
  }
  const inputLimit = modelCaps(model).inputLimit
  if (inputLimit !== null) {
    limits.push(inputLimit)
  }
  if (limits.length === 0) {
    return false
  }
  return tokens > Math.min(...limits)
}
