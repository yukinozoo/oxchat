/**
 * DeepSeek 官方价格表（人民币 / 每百万 tokens）。
 * 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *
 * 高峰时段：UTC 01:00-04:00 与 06:00-10:00，周一至周五（中国法定节假日除外）。
 * 空闲时段价格为高峰的一半，其余时间（含周末）都按空闲计。
 * 节假日无法在客户端判断，这里按工作日规则估算。
 */
export type TokenPrice = {
  /** 缓存命中的输入 */
  cacheHit: number
  /** 缓存未命中的输入 */
  cacheMiss: number
  output: number
}

const PRICING: Record<string, { peak: TokenPrice; offPeak: TokenPrice }> = {
  'deepseek-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
}

/** 模型名归一：老名字与带版本的后缀都归到同一档价格 */
export const priceTableFor = (model: string | null | undefined): TokenPrice | null => {
  if (!model) {
    return null
  }
  const key = Object.keys(PRICING).find((name) => model.toLowerCase().includes(name))
  if (!key) {
    return null
  }
  return isPeakNow() ? PRICING[key].peak : PRICING[key].offPeak
}

/** 当前是否处于高峰时段（UTC 工作日 01-04 / 06-10 点） */
export const isPeakNow = (now: Date = new Date()): boolean => {
  const day = now.getUTCDay()
  if (day === 0 || day === 6) {
    return false
  }
  const hour = now.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

export type TokenUsageLike = {
  /** 未命中缓存的输入 */
  inputTokens: number
  /** 缓存写入 */
  cacheCreationTokens: number
  /** 缓存命中 */
  cacheReadTokens: number
  outputTokens: number
}

/** 按一次请求的 token 用量估算金额（元）；模型不在价格表里时返回 null */
export const estimateCost = (
  usage: TokenUsageLike,
  model: string | null | undefined
): number | null => {
  const price = priceTableFor(model)
  if (!price) {
    return null
  }
  const perMillion = 1_000_000
  return (
    (usage.cacheReadTokens / perMillion) * price.cacheHit +
    ((usage.inputTokens + usage.cacheCreationTokens) / perMillion) * price.cacheMiss +
    (usage.outputTokens / perMillion) * price.output
  )
}

/** 金额展示：小于一分钱也显示出来，避免看起来像 0 */
export const formatMoney = (value: number): string => {
  if (value === 0) {
    return '¥0.00'
  }
  if (value < 0.01) {
    return `¥${value.toFixed(4)}`
  }
  return `¥${value.toFixed(2)}`
}
