import { streamMessage } from '../api/client.js'
import { estimateTokens } from '../../utils/tokens.js'
import { useSettings } from '../settings.js'
import { safeSlice } from '../../utils/safeText.js'
import type { Message } from './types.js'

/**
 * 人设延续：从一条很长的旧会话里把「她是谁、怎么说话、聊到哪了」捞出来。
 *
 * 设计取舍（对应 `OxChat-人设延续方案.md` 第十三节）：
 * - **默认只扫最近 200 条**，再对更早的部分等距抽样（每 10 条取 3 条），控制花费；
 * - 按字符预算切块，逐块出「局部结论」，最后再做一次合并请求（冲突以后者为准）；
 * - **风格样例只从 AI 回答里挑**：摘要一定会丢语气，原话不会，这是防漂移最有效的一招；
 * - 每条样例都带 `messageId`，界面上可以跳回原消息核对；
 * - 模型不给 JSON 也能用：宽松解析 + 分段兜底，不让一次格式跑偏把整次抽取废掉。
 */

/** 默认扫描范围：最近多少条 */
export const DEFAULT_RANGE = 200
/** 更早的部分每隔多少条取一条 */
const SAMPLE_STEP = 10
const SAMPLE_TAKE = 3
/** 单块正文上限（字符）：给「输入」留余量，避免撞模型上限 */
const CHUNK_CHARS = 12_000
/** 取样例的候选池上限 */
const SAMPLE_POOL = 120

export type StyleSample = { text: string; messageId: string }

export type PersonaDraft = {
  /** 角色设定（身份/外貌/背景） */
  description: string
  personality: string
  style: string
  rules: string
  scenario: string
  /** 剧情时间线：已发生的事与未兑现的约定 */
  timeline: string
  samples: StyleSample[]
}

export type ExtractProgress = {
  stage: 'sampling' | 'chunks' | 'merging' | 'samples'
  done: number
  total: number
}

const textOf = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

/**
 * 取样：最近 `range` 条全要，更早的部分等距抽（每 10 条取 3 条），
 * 保留原顺序，方便后续切成连续的转录。
 */
export const pickMessages = (messages: readonly Message[], range = DEFAULT_RANGE): Message[] => {
  if (messages.length <= range) {
    return [...messages]
  }
  const recentStart = messages.length - range
  const picked: Message[] = []
  for (let index = 0; index < recentStart; index += 1) {
    const bucket = index % SAMPLE_STEP
    if (bucket < SAMPLE_TAKE && textOf(messages[index]).trim()) {
      picked.push(messages[index])
    }
  }
  return [...picked, ...messages.slice(recentStart)]
}

/** 把消息拼成带说话人的转录（长消息按 2000 字截断，避免一条吃满一块） */
export const transcriptOf = (messages: readonly Message[]): string =>
  messages
    .map((message) => {
      const body = safeSlice(textOf(message).replace(/\s+/g, ' ').trim(), 0, 2_000)
      if (!body) {
        return ''
      }
      return `${message.role === 'user' ? '用户' : '角色'}：${body}`
    })
    .filter(Boolean)
    .join('\n')

/** 按字符预算切块（尽量在换行处断开） */
export const chunkTranscript = (transcript: string, limit = CHUNK_CHARS): string[] => {
  if (transcript.length <= limit) {
    return transcript ? [transcript] : []
  }
  const chunks: string[] = []
  let cursor = 0
  while (cursor < transcript.length) {
    let end = Math.min(transcript.length, cursor + limit)
    if (end < transcript.length) {
      const newline = transcript.lastIndexOf('\n', end)
      if (newline > cursor + limit * 0.6) {
        end = newline
      }
    }
    chunks.push(transcript.slice(cursor, end))
    cursor = end
  }
  return chunks
}

/** 花费估算：按估算 token 数 × 单价（传进来，缺省 0 就只显示 token） */
export const estimateExtraction = (
  messages: readonly Message[],
  range = DEFAULT_RANGE
): { chars: number; tokens: number; chunks: number } => {
  const transcript = transcriptOf(pickMessages(messages, range))
  const chunks = chunkTranscript(transcript)
  // 合并那一步要把所有局部结论再喂一次，约等于正文的 1/4
  const tokens = estimateTokens(transcript) + Math.round(estimateTokens(transcript) / 4)
  return { chars: transcript.length, tokens, chunks: chunks.length }
}

const EXTRACT_SYSTEM = `你在帮用户把一段很长的角色扮演/人机恋对话「接续」到另一个应用里。请从这段对话里提炼出这个人是谁、怎么说话、聊到哪了。

要求：
1. 只写对话里**明确支持**的内容；没提到的写「未提及」，不要脑补。
2. 分小节输出，用下面这些标题（没有内容的小节省略）：
【角色设定】身份、外貌、年龄、背景（一两句）
【性格】稳定的人格特点
【说话风格】句长、语气词、口癖、怎么称呼对方、括号动作描写的习惯、有哪些明显不像她的「助理腔」要避免
【行为准则】她的底线、不会做的事、双方约定
【关系状态】与用户当前的关系阶段、称呼、雷点
【剧情时间线】按先后列出关键事件与还没兑现的约定（每条一行，尽量具体）
3. 用第三人称客观描述，不要替角色说话，不要续写。
4. 输出纯文本，不要代码块、不要前言后语。`

const MERGE_SYSTEM = `你会收到同一个人物设定的多段局部结论，请合并成一份不重复、不冲突的最终档案。

要求：
1. 输出格式与输入一致，沿用【角色设定】【性格】【说话风格】【行为准则】【关系状态】【剧情时间线】这些小标题。
2. 重复的信息合并；互相矛盾的以后面出现的为准，并在该条后面用「（此前后说法不同，以较新为准）」标注。
3. 不要新增没有依据的内容，不要写前言后语。`

const SECTION_TITLES = ['角色设定', '性格', '说话风格', '行为准则', '关系状态', '剧情时间线'] as const
type SectionTitle = (typeof SECTION_TITLES)[number]

/** 把模型输出按【小标题】切开；解析不出来就整段当作角色设定 */
export const splitSections = (raw: string): Record<string, string> => {
  const text = raw
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .replace(/\r\n/g, '\n')
  const result: Record<string, string> = {}
  const pattern = /【([^】]{1,12})】/g
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) {
    return { 角色设定: text.trim() }
  }
  for (let index = 0; index < matches.length; index += 1) {
    const title = matches[index][1].trim()
    const start = (matches[index].index ?? 0) + matches[index][0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length
    const body = text.slice(start, end).trim()
    if (title && body) {
      result[title] = result[title] ? `${result[title]}\n${body}` : body
    }
  }
  return result
}

const section = (sections: Record<string, string>, title: SectionTitle): string =>
  (sections[title] ?? '').trim()

/**
 * 挑风格样例：只看角色自己的回答，长度合适、有语气/动作描写、不是纯列表或代码。
 * 纯启发式（不额外花钱），同一批里优先短的、带括号动作或语气词的。
 */
export const pickStyleSamples = (
  messages: readonly Message[],
  count = 8
): StyleSample[] => {
  const replied = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({ id: message.id, text: textOf(message).trim() }))
    .filter((item) => item.text.length >= 12 && item.text.length <= 300)
    .filter((item) => !/^[-*•\d]/.test(item.text))
    .filter((item) => !/```|\|.*\|/.test(item.text))
    .filter((item) => /[。……！？～~（）()""'']/.test(item.text))
    .slice(-SAMPLE_POOL)

  const scored = replied.map((item) => {
    let score = 0
    if (/（[^）]{1,20}）/.test(item.text)) {
      score += 3 // 括号里的动作/神态描写，最像「她」
    }
    if (/[呀呢啦嘛哦哦噢诶唔噗哼]/.test(item.text)) {
      score += 2 // 语气词
    }
    if (/[～~]/.test(item.text)) {
      score += 1
    }
    if (item.text.length <= 80) {
      score += 1 // 短的更适合当样例
    }
    return { ...item, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((item) => ({ text: item.text, messageId: item.id }))
}

export type ExtractOptions = {
  apiKey: string
  messages: readonly Message[]
  /** 扫描范围：最近多少条（默认 200） */
  range?: number
  /** 要几条风格样例（默认 8） */
  sampleCount?: number
  signal: AbortSignal
  /** 抽取用模型；默认跟随压缩模型，再退当前对话模型 */
  model?: string
  onProgress?: (progress: ExtractProgress) => void
  /** 冒烟替换用；默认走真实接口 */
  send?: typeof streamMessage
}

const collect = async (
  send: typeof streamMessage,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  signal: AbortSignal
): Promise<string> => {
  const events = send(
    apiKey,
    {
      model,
      system,
      messages: [{ role: 'user', content: user }],
      thinking: { type: 'disabled' },
      safety_check: { level: 'high' },
      tools: [],
    },
    signal
  )
  let text = ''
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text.trim()
}

/**
 * 从一条会话里抽人设档案。分块抽 → 合并 → 挑样例；中途取消按 `AbortError` 抛出。
 * 任何一块失败都只跳过那一块（少一段结论好过整次重来）。
 */
export const extractPersona = async ({
  apiKey,
  model: modelInput,
  messages,
  range = DEFAULT_RANGE,
  sampleCount = 8,
  signal,
  onProgress,
  send = streamMessage,
}: ExtractOptions): Promise<PersonaDraft> => {
  const model = modelInput || useSettings.getState().compactModel || useSettings.getState().model || 'deepseek-flash'
  const picked = pickMessages(messages, range)
  const transcript = transcriptOf(picked)
  if (!transcript.trim()) {
    throw new Error('empty transcript')
  }
  const chunks = chunkTranscript(transcript)
  const partials: string[] = []
  onProgress?.({ stage: 'chunks', done: 0, total: chunks.length })

  for (const [index, chunk] of chunks.entries()) {
    if (signal.aborted) {
      throw new Error('Aborted')
    }
    try {
      const part = await collect(
        send,
        apiKey,
        model,
        EXTRACT_SYSTEM,
        `这是第 ${index + 1}/${chunks.length} 段对话，请照样例输出局部结论：\n\n${chunk}`,
        signal
      )
      if (part) {
        partials.push(part)
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      // 单块失败跳过：少一段也比整次重来好
    }
    onProgress?.({ stage: 'chunks', done: index + 1, total: chunks.length })
  }

  if (signal.aborted) {
    throw new Error('Aborted')
  }
  if (partials.length === 0) {
    throw new Error('empty extraction')
  }

  let merged = partials[0]
  if (partials.length > 1) {
    onProgress?.({ stage: 'merging', done: 0, total: 1 })
    try {
      merged = await collect(
        send,
        apiKey,
        model,
        MERGE_SYSTEM,
        partials.map((part, index) => `第 ${index + 1} 段结论：\n${part}`).join('\n\n'),
        signal
      )
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      merged = partials.join('\n\n')
    }
    onProgress?.({ stage: 'merging', done: 1, total: 1 })
  }

  onProgress?.({ stage: 'samples', done: 0, total: 1 })
  const sections = splitSections(merged)
  const samples = pickStyleSamples(picked, sampleCount)
  onProgress?.({ stage: 'samples', done: 1, total: 1 })

  return {
    description: section(sections, '角色设定'),
    personality: section(sections, '性格'),
    style: section(sections, '说话风格'),
    rules: section(sections, '行为准则'),
    scenario: section(sections, '关系状态'),
    timeline: section(sections, '剧情时间线'),
    samples,
  }
}
