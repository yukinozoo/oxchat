import type { MessageParam } from '../api/types.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { sanitizeSurrogates } from '../../utils/safeText.js'

/**
 * 请求体的唯一出口。
 *
 * 为什么必须收口：服务端把「带扩展字段」的请求按**另一套限制**处理 ——
 * 实测（2026-11-16，真 Key）：
 *
 * | 项 | 数值 |
 * |---|---|
 * | 上下文窗口 | 1,048,576 token（两个模型相同） |
 * | 输出上限 | 393,216 token |
 * | **扩展模式输入上限** | **32,768 token** |
 *
 * 只要请求体里出现下面任意一条，就进入扩展模式：`title:{enabled:true}`、
 * `tools` 含 `deepseek_read_url`、`tools` 含 `deepseek_web_search`、
 * `safety_check.level='high'`。也就是说：**只要声明了服务端工具，1M 上下文就用不上**。
 *
 * 所以这里做四道闸门：估算输入超过 30,000 token 时强制「标准模式」——不声明工具、
 * 不请求标题、审查降档，把 1M 窗口换回来；长对话因此能发出去，而不是直接失败。
 */

/** 超过这个估算量就退标准模式（留出输出余量与估算误差） */
export const EXTENDED_INPUT_LIMIT_TOKENS = 30_000

export type BuildRequestInput = {
  model: ChatModel
  /** 模型能力：不支持服务端工具的模型（v4-pro）一律不发 tools/title */
  caps: { serverTools: boolean; title: boolean }
  system: string
  messages: MessageParam[]
  thinking: boolean
  effort?: 'low' | 'high' | 'max'
  temperature?: number
  /** 用户是否开着智能搜索 */
  search: boolean
  /** 本轮是否需要服务端生成标题 */
  wantTitle: boolean
  /** 估算的本轮输入 token（历史 + 本轮提问 + system） */
  tokens: number
  /** 外部强制标准模式（服务端已用「输入过长」打回过一次） */
  forceStandard?: boolean
}

export type BuiltRequest = {
  body: CreateMessageRequest
  /** 这次是标准模式（工具/标题/严格审查都让位） */
  standardOnly: boolean
  /** pro 且用户想联网：字段按能力屏蔽了，界面应提示 */
  proCapsBlocked: boolean
}

const cleanText = (text: string): string => sanitizeSurrogates(text)

/** 消息里的文本块同样兜一遍孤立代理（切坏的 emoji 会让服务端 JSON 解析 400） */
const cleanBlocks = <T extends { type: string }>(blocks: readonly T[]): T[] =>
  blocks.map((block) =>
    block.type === 'text' && 'text' in block
      ? { ...block, text: cleanText((block as { text: string }).text) }
      : block
  )

const cleanMessages = (messages: readonly MessageParam[]): MessageParam[] =>
  messages.map((message) => {
    if (message.role === 'latest_reminder') {
      return { role: 'latest_reminder', content: cleanText(message.content) }
    }
    if (message.role === 'assistant') {
      return { role: 'assistant', content: cleanBlocks(message.content) }
    }
    const content = message.content
    return typeof content === 'string'
      ? { role: 'user', content: cleanText(content) }
      : { role: 'user', content: cleanBlocks(content) }
  })

/** 服务端工具：读链接始终声明；智能搜索开关控制是否另行声明搜索工具 */
const serverTools = (search: boolean): NonNullable<CreateMessageRequest['tools']> => {
  const tools: NonNullable<CreateMessageRequest['tools']> = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

export const buildRequest = (input: BuildRequestInput): BuiltRequest => {
  const { caps } = input
  // 非标准模式下我们一律带 safety_check=high（严格审查），所以任何请求本来都是扩展模式：
  // 判断只有一个条件 —— 估算输入是否超过 30k，或者服务端已经用「输入过长」打回过。
  const standardOnly =
    Boolean(input.forceStandard) || input.tokens > EXTENDED_INPUT_LIMIT_TOKENS
  const proCapsBlocked = !caps.serverTools && input.search

  const body: CreateMessageRequest = {
    model: input.model,
    system: cleanText(input.system),
    messages: cleanMessages(input.messages),
    thinking: { type: input.thinking ? 'enabled' : 'disabled' },
    ...(input.thinking && input.effort ? { output_config: { effort: input.effort } } : {}),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    // 标准模式：不声明工具、不请求标题、审查降档 —— 只有这样才能用满 1M 窗口
    ...(standardOnly || !caps.serverTools ? {} : { tools: serverTools(input.search) }),
    ...(standardOnly ? {} : { safety_check: { level: 'high' as const } }),
    ...(!standardOnly && caps.title && input.wantTitle ? { title: { enabled: true } } : {}),
  }

  return { body, standardOnly, proCapsBlocked }
}
