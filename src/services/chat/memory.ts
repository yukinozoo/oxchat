import { translate } from '../../i18n/index.js'
import { useSettings } from '../settings.js'
import { createId } from '../../utils/id.js'
import { getVisibleMessages } from './branches.js'
import type { AttachmentMemory, Message, MemoryNote, Session, SessionMemory } from './types.js'

/**
 * 长期记忆：把早期的对话折叠成一组可读笔记。
 *
 * 与「摘要替换消息」的区别：消息一条都不删（可回看、可恢复），
 * 只是把它们的 id 记进 foldedIds，构建请求时跳过；笔记可以手改，再次整理时保留。
 *
 * 笔记分两类：
 * - **manual**（用户手写/手改）：整理时原样保留，注入时**永不省略**；
 * - **summary**（整理生成）：下一次整理整体替换，注入时按预算封顶。
 */
export const MAX_NOTES = 40
/** 单条笔记长度上限：默认 600 字，按摘要档位可放宽 */
export const MAX_NOTE_CHARS = 600

/** 注入 system 的「前情提要」总字数上限：再长就不值得每轮付费了 */
export const SUMMARY_SECTION_CAP = 24_000

/** 单条资料记忆在 system 里的渲染上限（正常提炼结果 ≤ 800 字） */
const MAX_ATTACHMENT_RENDER_CHARS = 1_200
/** 资料记忆整段渲染上限：即使被手动改长，也不让它撑爆 system */
const MAX_ATTACHMENT_SECTION_CHARS = 6_000

const ATTACHMENT_SECTION_HEAD: Record<'zh-CN' | 'en-US', [string, string]> = {
  'zh-CN': [
    '【资料记忆】以下是用户此前上传附件的提炼摘要，供需要时备查；不要整段复述，也不要把它当成当前话题。',
    '（资料记忆较多，已省略一部分）',
  ],
  'en-US': [
    '[Attachment memory] Condensed summaries of files the user uploaded earlier, kept for reference. Do not recite them or treat them as the current topic.',
    '(More attachment memories omitted)',
  ],
}

/** 笔记来源归一：老数据的 edited:true 视为 manual */
export const noteSource = (note: MemoryNote): 'manual' | 'summary' =>
  note.source ?? (note.edited ? 'manual' : 'summary')

/** 已折叠的消息 id 集合 */
export const foldedIdSet = (session: Session): Set<string> =>
  new Set(session.memory?.foldedIds ?? [])

/**
 * 进入请求上下文的消息：可见分支里剔除已折叠的部分。
 * 搜索、花费统计仍然看全部消息，只有请求上下文受影响。
 */
export const contextMessages = (session: Session): Message[] => {
  const folded = foldedIdSet(session)
  const path = getVisibleMessages(session)
  return folded.size === 0 ? path : path.filter((message) => !folded.has(message.id))
}

/** 把摘要文本拆成笔记：按行切、去掉列表符号、合并空行、单条限长 */
export const notesFromSummary = (
  summary: string,
  now = Date.now(),
  options: { maxChars?: number } = {}
): MemoryNote[] => {
  const maxChars = options.maxChars ?? MAX_NOTE_CHARS
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0)
  return lines.slice(0, MAX_NOTES).map((text) => ({
    id: createId(),
    text: text.slice(0, maxChars),
    source: 'summary' as const,
    createdAt: now,
  }))
}

/**
 * 覆盖式合并：用户手写的笔记排在最前并原样保留（一条不少），
 * 其余位置放这次整理出来的新笔记 —— 旧的 summary 笔记整体让位，不再越攒越多。
 */
export const mergeNotes = (
  existing: readonly MemoryNote[],
  incoming: readonly MemoryNote[]
): MemoryNote[] => {
  const manual = existing.filter((note) => noteSource(note) === 'manual' && note.text.trim())
  const seen = new Set(manual.map((note) => note.text))
  const merged: MemoryNote[] = [...manual]
  for (const note of incoming) {
    if (merged.length >= MAX_NOTES) {
      break
    }
    const text = note.text.trim()
    if (!text || seen.has(text)) {
      continue
    }
    seen.add(text)
    merged.push({ ...note, source: 'summary' })
  }
  return merged
}

/** 折叠一段消息，返回新的 memory（notes 由调用方给） */
export const foldMessages = (
  memory: SessionMemory | undefined,
  head: readonly Message[],
  notes: readonly MemoryNote[],
  now = Date.now(),
  /** 本次整理提炼出的资料记忆；不传表示沿用已有的 */
  attachments?: readonly AttachmentMemory[]
): SessionMemory => {
  const foldedIds = new Set(memory?.foldedIds ?? [])
  for (const message of head) {
    foldedIds.add(message.id)
  }
  const rounds = head.filter((message) => message.role === 'assistant').length
  // 资料记忆独立于覆盖式的笔记：不传就沿用旧的，传了就换新的（提炼失败时上层传 undefined 保住旧的）
  const keptAttachments = attachments ?? memory?.attachments
  return {
    notes: [...notes],
    ...(keptAttachments && keptAttachments.length > 0
      ? { attachments: [...keptAttachments] }
      : {}),
    foldedIds: [...foldedIds],
    foldedRounds: (memory?.foldedRounds ?? 0) + rounds,
    // 用户写过的整理要求要一直留着，下次整理继续生效
    ...(memory?.instruction ? { instruction: memory.instruction } : {}),
    updatedAt: now,
  }
}

/**
 * 注入 system 的长期记忆段落：分两段，优先级写在最前面。
 *
 * - 【用户设定】手写笔记，**永不省略**（用户明确要求记住的东西）；
 * - 【前情提要】整理生成的摘要，按 SUMMARY_SECTION_CAP 封顶，超出时保留最近的部分；
 * - 优先级：最近原文 > 本轮提问 > 提要。避免模型拿很久以前的提要压过眼前的对话。
 */
export const renderMemorySection = (session: Session): string => {
  const memory = session.memory
  if (!memory) {
    return ''
  }
  const locale = useSettings.getState().locale
  const attachments = (memory.attachments ?? []).filter((item) => item.summary.trim() !== '')
  const usable = memory.notes.filter((note) => !note.disabled)
  const manual = usable.filter((note) => noteSource(note) === 'manual' && note.text.trim())
  const summary = usable.filter((note) => noteSource(note) === 'summary' && note.text.trim())
  if (manual.length === 0 && summary.length === 0 && attachments.length === 0) {
    return ''
  }
  const parts: string[] = [translate('memorySectionPriority')]
  if (manual.length > 0) {
    parts.push(
      `${translate('memorySectionManual')}\n${manual.map((note) => `- ${note.text}`).join('\n')}`
    )
  }
  if (summary.length > 0) {
    // 从最近更新的笔记往回取，直到达到字数上限；超出部分直接省略并标注
    const kept: string[] = []
    let used = 0
    let omitted = 0
    for (let index = summary.length - 1; index >= 0; index -= 1) {
      const line = `- ${summary[index].text}`
      if (used + line.length > SUMMARY_SECTION_CAP) {
        omitted = index + 1
        break
      }
      kept.unshift(line)
      used += line.length + 1
    }
    const body = kept.join('\n')
    parts.push(
      omitted > 0
        ? `${translate('memorySectionSummary')}\n${translate('memorySectionOmitted', { count: omitted })}\n${body}`
        : `${translate('memorySectionSummary')}\n${body}`
    )
  }
  // 笔记是压缩索引，不是回复范本：不写这句，模型会照着清单的极简文风回话
  if (manual.length > 0 || summary.length > 0) {
    parts.push(translate('memorySectionStyleGuard'))
  }
  // 资料记忆：单独一段，共享 24K 总封顶，超出时先丢最旧的
  if (attachments.length > 0) {
    const [head, omittedNote] = ATTACHMENT_SECTION_HEAD[locale === 'zh-CN' ? 'zh-CN' : 'en-US']
    const lines: string[] = []
    let used = head.length
    for (const item of attachments) {
      const body = item.summary.trim().slice(0, MAX_ATTACHMENT_RENDER_CHARS)
      const line = locale === 'zh-CN' ? `· 《${item.name}》\n${body}` : `· "${item.name}"\n${body}`
      if (used + line.length > MAX_ATTACHMENT_SECTION_CHARS) {
        lines.push(omittedNote)
        break
      }
      used += line.length
      lines.push(line)
    }
    if (lines.length > 0) {
      parts.push([head, ...lines].join('\n\n'))
    }
  }
  return parts.join('\n\n')
}
