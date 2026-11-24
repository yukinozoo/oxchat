import { cleanOutboundText } from './clean.js'
import type { ModelCaps } from '../modelCaps.js'

/**
 * 请求用 system 的最终形态。
 *
 * 两件事：
 * 1. 清掉协议标记与孤立代理（脏 system 同样会让请求被拒）；
 * 2. 不支持 `latest_reminder` 的模型（v4-pro）没有快照可用，把日期直接拼进
 *    system —— 否则模型看不到「今天几号」。flash 等支持快照的模型不加，避免
 *    system 内容随日期变化、把前缀缓存打掉。
 */
export const systemForRequest = (
  base: string,
  caps: Pick<ModelCaps, 'supportsReminder'>,
  now: Date = new Date()
): string => {
  if (caps.supportsReminder) {
    return cleanOutboundText(base)
  }
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
  return cleanOutboundText(`${base}\n\n【当前时间】${date}`)
}
