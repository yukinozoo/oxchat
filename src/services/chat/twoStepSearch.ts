import type { CreateMessageRequest, MessageParam, WebSearchResult } from '../api/types.js'
import { DEFAULT_MODEL } from '../api/types.js'
import { streamMessage } from '../api/client.js'
import { translate } from '../../i18n/index.js'

/**
 * 联网搜索「两步法」。
 *
 * 背景：只要请求体里带服务端工具（`deepseek_web_search` / `deepseek_read_url`），
 * 服务端就把这次请求按「扩展模式」处理，**输入上限只有 32768 token**；
 * 而 1M 的上下文窗口只对不带扩展字段的标准模式开放。
 * 于是长对话一旦开搜索，就只能二选一：要么关掉搜索，要么失败。
 *
 * 两步法把两件事拆开做：
 * 1. **检索步**：只带最近几轮 + 精简指令，走扩展模式跑一次搜索，拿到资料摘要与结果列表；
 * 2. **作答步**：把资料压成一段参考资料挂到最后一条提问尾部，用**标准模式**（1M 窗口）
 *    带上完整历史正常回答。
 *
 * 资料放在提问尾部而不是 system：system 一变，这一轮的提示词前缀缓存就全失效了。
 */

/** 检索步带多少轮历史：够理解「刚才说的那个」就行，多了反而超预算 */
const SEARCH_CONTEXT_ROUNDS = 3
/** 单条消息在检索步里的最大字数（按字截，中文 1 字≈1 token） */
const SEARCH_MESSAGE_CHARS = 1_200
/** 资料段落总长上限 */
const REFERENCE_CHARS = 6_000
/** 最多列几条搜索结果 */
const MAX_SNIPPETS = 10

export type SearchStepResult = {
  /** 模型给的一句话资料摘要 */
  summary: string
  /** 搜索结果（标题 + 链接 + 摘要） */
  results: WebSearchResult[]
  /** 这次检索有没有真的调用工具；false 表示模型没搜，调用方应回退 */
  usedTools: boolean
}

/** 单段文本压短：检索步只需要知道「在聊什么」，不需要完整推理过程 */
const shrinkText = (text: string, limit = SEARCH_MESSAGE_CHARS): string =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

/**
 * 只保留最近的轮次，并把每条消息压短。
 * 扩展模式的输入上限是 32768 token，不问青红皂白把整段历史塞进去必然 400。
 */
export const trimForSearch = (
  messages: readonly MessageParam[],
  rounds = SEARCH_CONTEXT_ROUNDS
): MessageParam[] => {
  const roundStart: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      roundStart.push(index)
    }
  })
  const from = roundStart.length <= rounds ? 0 : roundStart[roundStart.length - rounds]
  return messages.slice(from).map((message): MessageParam => {
    if (message.role === 'latest_reminder') {
      return message
    }
    if (typeof message.content === 'string') {
      return { ...message, content: shrinkText(message.content) } as MessageParam
    }
    // 数组形式（带附件或 assistant 块）：只压文本块，附件与工具块原样留着
    const blocks = message.content.map((block) =>
      block.type === 'text' ? { ...block, text: shrinkText(block.text) } : block
    )
    return message.role === 'assistant'
      ? { role: 'assistant', content: blocks as never }
      : { role: 'user', content: blocks as never }
  })
}

/** 检索步的请求体：声明两个工具、关闭思考（搜索本身够慢） */
export const searchRequest = (
  model: string,
  messages: MessageParam[]
): CreateMessageRequest => ({
  model: model as CreateMessageRequest['model'],
  system: translate('searchStepSystem'),
  messages: [
    ...messages,
    {
      role: 'user',
      content: translate('searchStepInstruction', { max: SEARCH_MESSAGE_CHARS }),
    },
  ],
  thinking: { type: 'disabled' },
  safety_check: { level: 'high' },
  tools: [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
    { type: 'deepseek_web_search', name: 'deepseek_web_search' },
  ],
})

/** 把检索到的资料拼成一段（挂在提问尾部） */
export const formatReference = (summary: string, results: readonly WebSearchResult[]): string => {
  const parts: string[] = []
  if (summary.trim()) {
    parts.push(`摘要：${summary.trim()}`)
  }
  const listed = results
    .slice(0, MAX_SNIPPETS)
    .map((item, index) => `${index + 1}. ${item.title}（${item.url}）\n   ${item.snippet}`)
  if (listed.length > 0) {
    parts.push(`搜索结果：\n${listed.join('\n')}`)
  }
  const body = parts.join('\n\n')
  return body.length > REFERENCE_CHARS ? `${body.slice(0, REFERENCE_CHARS)}…` : body
}

/** 两步法第二步：把资料挂到最后一条提问尾部（不动 system，保住前缀缓存） */
export const withReference = (
  messages: readonly MessageParam[],
  reference: string
): MessageParam[] => {
  if (!reference.trim()) {
    return messages.slice()
  }
  const block = `${translate('searchReferenceHeader')}\n${reference}`
  let lastUser = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUser = index
      break
    }
  }
  if (lastUser < 0) {
    return messages.slice()
  }
  const target = messages[lastUser]
  let next: MessageParam = target
  if (target.role === 'user') {
    if (typeof target.content === 'string') {
      next = { role: 'user', content: `${target.content}\n\n${block}` }
    } else {
      const content = target.content as { type: string; text?: string }[]
      next = {
        role: 'user',
        content: [...content, { type: 'text', text: block }] as never,
      }
    }
  }
  return messages.map((message, index) => (index === lastUser ? next : message))
}

/**
 * 跑检索步：消费一次流，收集文本摘要与搜索结果块。
 * 失败时抛错，由调用方决定「按普通请求继续」还是「报错」。
 */
export const runSearchStep = async (
  apiKey: string,
  model: string | null | undefined,
  messages: MessageParam[],
  signal: AbortSignal,
  send: typeof streamMessage = streamMessage
): Promise<SearchStepResult> => {
  const events = send(
    apiKey,
    searchRequest(model ?? DEFAULT_MODEL, trimForSearch(messages)),
    signal
  )
  let summary = ''
  let usedTools = false
  const results: WebSearchResult[] = []
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      summary += event.delta.text
      continue
    }
    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block.type === 'web_search_tool_result') {
        usedTools = true
        for (const item of block.content) {
          if (item.type === 'web_search_result') {
            results.push(item)
          }
        }
      } else if (block.type === 'server_tool_use' || block.type === 'web_fetch_tool_result') {
        usedTools = true
      }
    }
  }
  return { summary, results, usedTools }
}
