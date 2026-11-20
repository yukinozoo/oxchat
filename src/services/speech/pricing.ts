/**
 * 语音合成的计费口径（官方文档：api-docs.deepseek.com/zh-cn/guides/tts.md）
 * - 每 10,000 计费字符 3 元，限时 5 折 1.5 元
 * - 汉字算 2 个字符，其余（字母/数字/空格/标点）算 1 个
 */
export const SPEECH_PRICE_PER_10K = 1.5
export const SPEECH_PRICE_LIST = 3

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/** 一段文本折算成多少个「计费字符」 */
export const billedCharsOf = (text: string): number => {
  let total = 0
  for (const char of text) {
    total += CJK.test(char) ? 2 : 1
  }
  return total
}

/** 按限时 5 折价估算花费；只用于展示，真实账单以官方为准 */
export const estimateSpeechCost = (billedChars: number): number =>
  (billedChars / 10_000) * SPEECH_PRICE_PER_10K
