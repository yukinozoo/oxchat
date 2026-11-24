import type { AssistantMessage, Message, UserMessage } from './types.js'

/**
 * 搜索用的文本工具：折叠、命中区间、片段截取、消息正文提取。
 *
 * 单独成模块是因为「正文搜索」有两条路径（现读会话 / 读内存索引），
 * 两边必须用**同一套规则**取文本与算区间，否则同一条消息两种结果对不上。
 */

/** 助手消息的可读文本：正文 + 思考过程。搜索结果卡片的文字是外部资料，不参与匹配。 */
export const assistantText = (message: AssistantMessage): string =>
  message.blocks
    .map((block) => {
      if (block.type === 'text') {
        return block.text
      }
      return block.type === 'thinking' ? block.thinking : ''
    })
    .filter(Boolean)
    .join('\n')

/**
 * 用户消息的可读文本：正文 + 手动压缩留下的摘要。
 * 压缩会把被替换掉的早期消息删掉、只剩摘要字符串，不读这里就搜不到压缩过的历史。
 */
export const userText = (message: UserMessage): string =>
  [message.content, message.summary].filter(Boolean).join('\n')

export const messageText = (message: Message): string =>
  message.role === 'user' ? userText(message) : assistantText(message)

/** 折叠空白：搜索与片段都基于折叠后的文本，避免换行把关键词切断 */
export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * 逐字符折叠：全角 ASCII → 半角、全角空格 → 空格、ASCII 大写 → 小写。
 *
 * 只做 **1:1 映射**（一个码元换一个码元），所以折叠后的索引可以原样用于原串 ——
 * 界面高亮切的是原始片段，不必做位置换算。用 `toLowerCase()` 不行：像 `İ`
 * 小写后会变成两个码元，索引就错位了。
 */
const foldCode = (code: number): number => {
  const half =
    code >= 0xff01 && code <= 0xff5e ? code - 0xfee0 : code === 0x3000 ? 0x20 : code
  return half >= 0x41 && half <= 0x5a ? half + 0x20 : half
}

export const fold = (text: string): string => {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    out += String.fromCharCode(foldCode(text.charCodeAt(index)))
  }
  return out
}

const SNIPPET_BEFORE = 18
const SNIPPET_AFTER = 34

/** 截取命中前后的上下文；两侧被截断时补省略号 */
export const snippetAround = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - SNIPPET_BEFORE)
  const end = Math.min(text.length, index + length + SNIPPET_AFTER)
  const body = collapse(text.slice(start, end))
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/** 找出所有命中区间（大小写不敏感、全角半角等价）；界面据此渲染 <mark> */
export const findRanges = (text: string, query: string): { start: number; end: number }[] => {
  const needle = fold(collapse(query))
  if (!needle || !text) {
    return []
  }
  const haystack = fold(text)
  const ranges: { start: number; end: number }[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) {
      return ranges
    }
    ranges.push({ start: index, end: index + needle.length })
    from = index + needle.length
  }
}

/** 在折叠后的文本里找第一次命中 */
export const textMatches = (text: string, needle: string): { index: number } | null => {
  const index = fold(text).indexOf(needle)
  return index === -1 ? null : { index }
}
