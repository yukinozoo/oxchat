import { translate } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { getVisibleMessages } from './branches.js'
import type { Message, MemoryNote, Session, SessionMemory } from './types.js'

/**
 * 长期记忆：把早期的对话折叠成一组可读笔记。
 *
 * 与「摘要替换消息」的区别：消息一条都不删（可回看、可恢复），
 * 只是把它们的 id 记进 foldedIds，构建请求时跳过；笔记可以手改，再次整理时保留。
 */
export const MAX_NOTES = 40
/** 单条笔记长度上限，防止一次摘要塞进一整段 */
const MAX_NOTE_CHARS = 600

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
export const notesFromSummary = (summary: string, now = Date.now()): MemoryNote[] => {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0)
  return lines.slice(0, MAX_NOTES).map((text) => ({
    id: createId(),
    text: text.slice(0, MAX_NOTE_CHARS),
    createdAt: now,
  }))
}

/**
 * 覆盖式合并：用户改过的笔记排在最前并原样保留，
 * 其余位置放这次整理出来的新笔记，总数封顶 MAX_NOTES。
 */
export const mergeNotes = (
  existing: readonly MemoryNote[],
  incoming: readonly MemoryNote[]
): MemoryNote[] => {
  const pinned = existing.filter((note) => note.edited)
  const fresh = [...incoming]
  const seen = new Set(pinned.map((note) => note.text))
  const merged = [...pinned]
  for (const note of fresh) {
    if (merged.length >= MAX_NOTES) {
      break
    }
    if (seen.has(note.text)) {
      continue
    }
    merged.push(note)
  }
  return merged
}

/** 折叠一段消息，返回新的 memory（notes 由调用方给） */
export const foldMessages = (
  memory: SessionMemory | undefined,
  head: readonly Message[],
  notes: readonly MemoryNote[],
  now = Date.now()
): SessionMemory => {
  const foldedIds = new Set(memory?.foldedIds ?? [])
  for (const message of head) {
    foldedIds.add(message.id)
  }
  const rounds = head.filter((message) => message.role === 'assistant').length
  return {
    notes: [...notes],
    foldedIds: [...foldedIds],
    foldedRounds: (memory?.foldedRounds ?? 0) + rounds,
    updatedAt: now,
  }
}

/** 注入 system 的长期记忆段落；没有笔记时返回空串 */
export const renderMemorySection = (session: Session): string => {
  const memory = session.memory
  if (!memory || memory.notes.length === 0) {
    return ''
  }
  const header = translate('memorySystemHeader')
  const body = memory.notes.map((note) => `- ${note.text}`).join('\n')
  return `${header}\n${body}`
}
