import { estimateTokens } from './tokens.js'

/**
 * 文本安全工具。
 *
 * JS 字符串按 UTF-16 存储，emoji / 扩展 B 区汉字占两个「代理」。任何按字符数的
 * 截断，只要切点落在代理对中间，就会留下一个孤立代理；`JSON.stringify` 会把它
 * 写成 `\udXXX`，服务端的 JSON 解析器直接 400（实测报错：`unexpected end of hex
 * escape`）。所以：切字符串一律走这里；发送前再用 `sanitizeSurrogates` 兜一次底。
 */

const SURROGATE = /[\uD800-\uDFFF]/

/** 孤立代理替换成 U+FFFD；没有代理时原样返回（快路径） */
export const sanitizeSurrogates = (text: string): string => {
  if (!SURROGATE.test(text)) {
    return text
  }
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1]
        i += 1
      } else {
        out += '\uFFFD'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD'
    } else {
      out += text[i]
    }
  }
  return out
}

/** 起点落在低位代理上时后移一位，避免切出半个 emoji */
const alignStart = (text: string, start: number) => {
  if (start <= 0) {
    return 0
  }
  const code = text.charCodeAt(start)
  return code >= 0xdc00 && code <= 0xdfff ? start + 1 : start
}

/** 终点落在高位代理上时前移一位 */
const alignEnd = (text: string, end: number) => {
  if (end >= text.length) {
    return text.length
  }
  if (end <= 0) {
    return 0
  }
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end
}

/** 安全切片：等价于 text.slice(start, end)，但不会切断代理对 */
export const safeSlice = (text: string, start: number, end: number = text.length): string => {
  const from = alignStart(text, Math.max(0, start))
  const to = alignEnd(text, Math.min(text.length, end))
  return from >= to ? '' : text.slice(from, to)
}

/** 保留开头：超出上限时截断并加省略号（切点对齐代理对） */
export const safeTruncate = (text: string, limit: number, suffix = '…'): string =>
  text.length <= limit ? text : `${safeSlice(text, 0, limit)}${suffix}`

/** 保留结尾（用于「…后面的内容」这类倒序截取） */
export const safeTail = (text: string, limit: number): string =>
  text.length <= limit ? text : `…${safeSlice(text, text.length - limit)}`

/**
 * 截断后「模型读了多少」的百分比。
 * 截断的前提就是 kept < total，但 538,461 / 540,000 用四舍五入会显示成 100%，
 * 用户会以为整份都读了。所以向下取整并夹在 1~99：截断时永远不会出现 100%，
 * 也不会因为比例太小显示 0%。
 */
export const truncatePercent = (kept: number, total: number): number => {
  if (total <= 0 || kept >= total) {
    return 100
  }
  return Math.min(99, Math.max(1, Math.floor((kept / total) * 100)))
}

/**
 * 按 token 预算折算字符数（用本项目的估算口径，中文 1 字 1 token、其余 4 字符 1 token）。
 * `charsForTokens(0)` 返回 0；算式是反解 `estimateTokens`：token = 汉字数 + 其余/4，
 * 这里按「全按 4 字符 1 token」的保守上限给字符数，宁可少给也不超预算。
 */
export const charsForTokens = (tokens: number): number => Math.max(0, Math.floor(tokens * 4))

/** 这段文本按本项目口径估算占多少 token（与 estimateTokens 同源，便于统一调用点） */
export const estimateTextTokens = (text: string): number => estimateTokens(text)
