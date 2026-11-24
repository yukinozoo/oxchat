import { streamMessage } from '../api/client.js'
import { DEFAULT_MODEL } from '../api/types.js'
import type { Locale } from '../settings.js'
import { useSettings } from '../settings.js'
import { extractDocumentText, isExtractableDocument } from '../documents/extract.js'
import { safeSlice, safeTruncate } from '../../utils/safeText.js'
import type { AttachmentMemory, FileAttachment, Message } from './types.js'

/**
 * 独立资料记忆：整理（折叠）附件轮次时，把「这份资料讲了什么」单独提炼成一张卡片。
 *
 * 为什么要独立于笔记：
 * - 笔记是**覆盖式**的（下一次整理整体替换），长会话里早期的文档要点会被后来的剧情冲掉；
 * - 附件正文本身在折叠后就不在上下文里了，`fileText.ts` 的片段也只是给摘要当素材；
 * - 资料记忆单独存、单独注入（【资料记忆】段），用户还能手动改。
 *
 * 省 token 的做法：图片、以及本地读不到正文的附件（扫描件、导入的历史附件、服务端解析的 PDF）
 * **不发请求**，直接用这一轮的提问 + 回复拼一条要点；只有真读到正文的文档才单独提炼一次。
 */

/** 单份资料摘要上限（正常提炼结果一般 300~800 字） */
export const ATTACHMENT_SUMMARY_MAX_CHARS = 800
/** 送进提炼请求的附件正文上限：超长按「前 42% / 中 20% / 后 38%」抽样 */
export const ATTACHMENT_DOC_CHARS = 24_000
/** 提炼时带上的提问 / 回复各自的上限 */
const ATTACHMENT_CONTEXT_CHARS = 2_000
/** 资料记忆列表总字数预算：别让它反客为主挤掉笔记 */
export const ATTACHMENT_TOTAL_CHARS = 3_000

const MARKER: Record<Locale, string> = {
  'zh-CN': '\n\n……（中间部分省略）……\n\n',
  'en-US': '\n\n[... middle omitted ...]\n\n',
}

/**
 * 超长正文按「前 42% + 中间 20% + 后 38%」抽样：开头通常是目录/设定，中间是主体，
 * 结尾是结论与数据表，三处都不丢。
 */
export const sampleAttachmentText = (
  text: string,
  locale: Locale = 'zh-CN',
  limit: number = ATTACHMENT_DOC_CHARS
): string => {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (clean.length <= limit) {
    return clean
  }
  const marker = MARKER[locale]
  const room = Math.max(600, limit - marker.length * 2)
  const headLen = Math.floor(room * 0.42)
  const midLen = Math.floor(room * 0.2)
  const tailLen = room - headLen - midLen
  const midStart = Math.max(headLen, Math.floor((clean.length - midLen) / 2))
  const tailStart = Math.max(midStart + midLen, clean.length - tailLen)
  return [
    safeSlice(clean, 0, headLen),
    safeSlice(clean, midStart, midStart + midLen),
    safeSlice(clean, tailStart, clean.length),
  ].join(marker)
}

const PROMPTS: Record<Locale, string> = {
  'zh-CN': `你是资料提炼助手。用户上传过一份附件，并围绕它与 AI 助手聊过。请为后续对话留下一份可备查的结构化资料摘要，而不是复述原文。

要求：
1. 输出 300~800 字，按下面小标题分段，没有内容的段直接省略：
【资料概况】文件是什么、主题与用途
【核心设定】世界观、人物、术语、规则等（如有）
【关键数据】重要的数字、参数、名单、结论
【对话结论】用户这次关心的点与 AI 给出的重要结论
【后续可用】以后回答时需要遵守或反复引用的信息
2. 只写对后续对话有用的事实，按主题归纳；不要逐段复述、不要整段翻译、不要写「开头说…结尾说…」。
3. 正文被抽样截断的部分不要编造，只依据给出的内容总结，不要假装读过没给出的部分。
4. 关键名称、数字、专有名词保留原写法。
5. 只输出摘要正文，不要代码块、不要前言后语。`,
  'en-US': `You distill reference material. The user uploaded a file earlier and talked about it with an AI assistant. Produce a structured digest that stays available for later turns - do not restate the file.

Rules:
1. Output 300-800 characters, grouped under these headings and skipping empty ones:
[Overview] what the file is, its topic and purpose
[Core setting] world, characters, terms, rules (if any)
[Key data] important numbers, parameters, names, conclusions
[Conversation outcome] what the user cared about and the assistant's important conclusions
[Reusable later] facts to follow or cite in future replies
2. Keep only facts useful later, grouped by theme; no section-by-section retelling, no full translation, no "the beginning says ... the end says ...".
3. Never invent the parts that were sampled out; summarise only what is given and do not pretend to have read the rest.
4. Preserve names, numbers and proper nouns as written.
5. Output the digest only, no code fences, no preamble or closing.`,
}

const LABELS: Record<
  Locale,
  { fileName: string; question: string; answer: string; content: string; sampled: string }
> = {
  'zh-CN': {
    fileName: '【文件名】',
    question: '【用户提问】',
    answer: '【AI 回复（节选）】',
    content: '【附件正文（节选）】',
    sampled: '（正文超长，已按前/中/后抽样，未给出的部分不要编造。）',
  },
  'en-US': {
    fileName: '[File name]',
    question: '[User question]',
    answer: '[Assistant reply (excerpt)]',
    content: '[File text (excerpt)]',
    sampled: '(The file was too long and has been sampled from head/middle/tail; do not invent the missing parts.)',
  },
}

const buildPrompt = ({
  locale,
  file,
  question,
  answer,
  content,
  sampled,
}: {
  locale: Locale
  file: FileAttachment
  question: string
  answer: string
  content: string
  sampled: boolean
}): string => {
  const label = LABELS[locale]
  const parts = [`${label.fileName}${file.name}`]
  if (question) {
    parts.push(`${label.question}\n${question}`)
  }
  if (answer) {
    parts.push(`${label.answer}\n${answer}`)
  }
  parts.push(`${label.content}\n${content}`)
  if (sampled) {
    parts.push(label.sampled)
  }
  return parts.join('\n\n')
}

/** 读不到正文时（图片、扫描件、导入的历史附件）的兜底要点：只用这一轮问答，不再发请求 */
const fallbackSummary = ({
  locale,
  file,
  question,
  answer,
}: {
  locale: Locale
  file: FileAttachment
  question: string
  answer: string
}): string => {
  const title =
    locale === 'zh-CN' ? `附件《${file.name}》` : `Attachment "${file.name}"`
  const q = locale === 'zh-CN' ? '当时提问' : 'User asked'
  const a = locale === 'zh-CN' ? '回复要点' : 'Reply highlights'
  return safeTruncate(
    [
      title,
      question ? `${q}：${safeTruncate(question, 300)}` : '',
      answer ? `${a}：${safeTruncate(answer, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    ATTACHMENT_SUMMARY_MAX_CHARS
  )
}

const cleanSummary = (raw: string, limit: number): string =>
  safeTruncate(
    raw
      .replace(/^\s*```[a-zA-Z]*\s*/, '')
      .replace(/\s*```\s*$/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    limit
  )

/** 总量控制：新的优先保留；最后一条放不下时温和截断，不整条丢 */
export const fitAttachmentBudget = (
  list: readonly AttachmentMemory[],
  budget: number = ATTACHMENT_TOTAL_CHARS
): AttachmentMemory[] => {
  const newestFirst = [...list].sort((a, b) => b.createdAt - a.createdAt)
  const kept: AttachmentMemory[] = []
  let used = 0
  for (const item of newestFirst) {
    const left = budget - used
    if (left < 120) {
      break
    }
    if (item.summary.length <= left) {
      kept.push(item)
      used += item.summary.length
      continue
    }
    kept.push({ ...item, summary: safeTruncate(item.summary, Math.max(120, left - 1)) })
    break
  }
  return kept.sort((a, b) => a.createdAt - b.createdAt)
}

const replyTextOf = (message: Message | undefined): string => {
  if (!message || message.role !== 'assistant') {
    return ''
  }
  return message.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

export type ExtractOptions = {
  apiKey: string
  locale: Locale
  /** 本次被折叠的消息（按顺序）；只处理 user.files 非空的轮次 */
  messages: readonly Message[]
  /** 会话里已有的资料记忆：用于去重与合并 */
  existing?: readonly AttachmentMemory[]
  /** 读本地附件正文：读不到返回 null / 空串（调用方负责兜底） */
  readFileContent: (file: FileAttachment) => Promise<string | null | undefined>
  signal: AbortSignal
  /** 指定提炼模型；不传则跟随设置里的压缩模型，再退当前对话模型 */
  model?: string
  /** 冒烟替换用；默认走真实接口 */
  send?: typeof streamMessage
}

/**
 * 提炼本次折叠轮次里的附件资料记忆。**不写库**，返回合并后的完整列表，
 * 由调用方（整理流程）一并写入 `memory.attachments`。
 */
export const extractAttachmentMemories = async ({
  apiKey,
  locale,
  messages,
  existing = [],
  readFileContent,
  signal,
  model,
  send = streamMessage,
}: ExtractOptions): Promise<AttachmentMemory[]> => {
  const prefs = useSettings.getState()
  const useModel = model || prefs.compactModel || prefs.model || DEFAULT_MODEL
  const baseTime = Date.now()
  const seenIds = new Set(
    existing.map((item) => item.fileId).filter((id): id is string => typeof id === 'string' && id !== '')
  )
  const seenNames = new Set(existing.map((item) => item.name))
  const created: AttachmentMemory[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'user' || message.files.length === 0) {
      continue
    }
    const answer = replyTextOf(messages[index + 1])
    for (const file of message.files) {
      if (signal.aborted) {
        throw new Error('Aborted')
      }
      if (
        seenIds.has(file.id) ||
        (file.serverId !== null && seenIds.has(file.serverId)) ||
        seenNames.has(file.name)
      ) {
        continue
      }
      // 读不到正文不算失败：退化成「这一轮问答」的要点，至少留下这份资料存在过
      let raw = ''
      if (!file.isImage) {
        try {
          raw = (await readFileContent(file)) ?? ''
        } catch {
          raw = ''
        }
      }
      try {
        if (signal.aborted) {
          throw new Error('Aborted')
        }
        const question = safeTruncate(message.content.trim(), ATTACHMENT_CONTEXT_CHARS)
        const reply = safeTruncate(answer, ATTACHMENT_CONTEXT_CHARS)
        let summary = ''
        if (raw.trim()) {
          const text = sampleAttachmentText(raw, locale)
          const sampled = raw.replace(/\r\n/g, '\n').trim().length > ATTACHMENT_DOC_CHARS
          let output = ''
          const events = send(
            apiKey,
            {
              model: useModel,
              system: PROMPTS[locale],
              messages: [
                {
                  role: 'user',
                  content: buildPrompt({ locale, file, question, answer: reply, content: text, sampled }),
                },
              ],
              thinking: { type: 'disabled' },
              safety_check: { level: 'high' },
              tools: [],
            },
            signal
          )
          for await (const event of events) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              output += event.delta.text
            }
          }
          summary = cleanSummary(output, ATTACHMENT_SUMMARY_MAX_CHARS)
        }
        if (!summary.trim()) {
          // 图片、读不到正文、或者模型没给出东西：退化成「这一轮聊了什么」
          summary = reply || question ? fallbackSummary({ locale, file, question, answer: reply }) : ''
        }
        if (!summary.trim()) {
          continue
        }
        created.push({
          id: `att-${file.id}`,
          name: file.name,
          summary,
          fileId: file.id,
          createdAt: baseTime + created.length,
        })
        seenIds.add(file.id)
        if (file.serverId !== null) {
          seenIds.add(file.serverId)
        }
        seenNames.add(file.name)
      } catch (error) {
        if (signal.aborted) {
          throw error
        }
        // 单份附件提炼失败不该让整次整理失败，跳过它
        continue
      }
    }
  }
  return fitAttachmentBudget([...existing, ...created])
}

/** 读本地原件当正文：优先用已有片段（省一次解码），其次 docx/pptx/xlsx/epub/rtf 的抽取，最后按纯文本解码 */
export const readAttachmentText = async (
  file: FileAttachment,
  loadBlob: (id: string) => Promise<Blob | undefined>,
  excerpt?: string
): Promise<string | null> => {
  if (excerpt && excerpt.trim()) {
    return excerpt
  }
  const blob = await loadBlob(file.id)
  if (!blob) {
    return null
  }
  if (isExtractableDocument(file.name)) {
    try {
      const text = await extractDocumentText(file.name, blob)
      if (text && text.trim()) {
        return text
      }
    } catch {
      // 抽不动就退回按文本解码，再不济交给上层用问答兜底
    }
  }
  if (file.isImage) {
    return null
  }
  try {
    const buffer = await blob.arrayBuffer()
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      try {
        return new TextDecoder('gb18030').decode(buffer)
      } catch {
        return null
      }
    }
  } catch {
    return null
  }
}
