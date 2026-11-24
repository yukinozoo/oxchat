import type { Session } from '../types.js'
import type { CharacterCard } from '../characters.js'

/**
 * 归档附带的本机数据（sidecar）。
 *
 * 官方导出格式只有四段（manifest / user / 会话 / index + 图片），**没有**长期记忆与置顶：
 * `toArchive.ts` 里 `pinned` 是硬编码 false，`memory` 字段根本不存在。于是「整理」出来的
 * 笔记、折叠状态、置顶在换设备或 Gitee 同步后全丢 —— 长会话到新设备等于记忆清零。
 *
 * 这里用**额外一个文件**承载它们，不碰官方格式：
 * - 官方前端导入时读不到这个文件 → 忽略；
 * - 我们自己的导入端识别它并回填（旧版本客户端会把它当未知条目，所以导入端必须放行这个路径）。
 */
export const EXTRAS_PATH = 'oxchat-extras.json'

export type SessionExtras = {
  memory?: Session['memory']
  pinned?: boolean
  /** 本条对话的自动压缩开关 */
  autoCompact?: boolean
  /** 本条对话选用的开场白下标 */
  greetingIndex?: number
  /** 这条会话绑的角色。官方格式里没有这个字段，只能跟着 sidecar 走 */
  characterId?: string
}

export type ExtrasFile = {
  format: 1
  sessions: Record<string, SessionExtras>
  /** 删除墓碑：id → 删除时间（毫秒）。其它设备据此删掉本地那份，避免「删了又回来」 */
  deleted?: Record<string, number>
  /** 自定义角色卡；内置角色不进包 */
  characters?: CharacterCard[]
  /** 自定义模型渠道 / 摘要模板等本机配置（字符串原样带，导入只补空缺） */
  prefs?: {
    channels?: string
    activeChannel?: string
    templateOverrides?: string
    templateCustom?: string
  }
}

/** 收集需要写进 sidecar 的会话；一条都没有时返回 null（不写空文件） */
export const toExtrasFile = (
  sessions: Iterable<{
    id: string
    pinned?: boolean
    memory?: Session['memory']
    characterId?: string
  }>,
  deleted: Record<string, number> = {},
  characters: CharacterCard[] = [],
  prefs?: ExtrasFile['prefs']
): ExtrasFile | null => {
  const entries: Record<string, SessionExtras> = {}
  for (const session of sessions) {
    const memory = session.memory
    const hasMemory = Boolean(
      memory &&
        (memory.notes.length > 0 ||
          memory.foldedIds.length > 0 ||
          (memory.attachments?.length ?? 0) > 0)
    )
    const sessionWithFlags = session as typeof session & {
      autoCompact?: boolean
      greetingIndex?: number
    }
    if (!hasMemory && !session.pinned && !session.characterId && sessionWithFlags.autoCompact === undefined && sessionWithFlags.greetingIndex === undefined) {
      continue
    }
    entries[session.id] = {
      ...(memory && hasMemory ? { memory } : {}),
      ...(session.pinned ? { pinned: true } : {}),
      ...(session.characterId ? { characterId: session.characterId } : {}),
      ...(sessionWithFlags.autoCompact !== undefined ? { autoCompact: sessionWithFlags.autoCompact } : {}),
      ...(sessionWithFlags.greetingIndex !== undefined ? { greetingIndex: sessionWithFlags.greetingIndex } : {}),
    }
  }
  const hasDeleted = Object.keys(deleted).length > 0
  const hasCharacters = characters.length > 0
  const hasPrefs = Boolean(prefs && Object.keys(prefs).length > 0)
  if (Object.keys(entries).length === 0 && !hasDeleted && !hasCharacters && !hasPrefs) {
    return null
  }
  return {
    format: 1,
    sessions: entries,
    ...(hasDeleted ? { deleted } : {}),
    ...(hasCharacters ? { characters } : {}),
    ...(hasPrefs ? { prefs } : {}),
  }
}

/** 解析 sidecar；结构不对时返回 null（当成旧包处理，不影响导入） */
export const parseExtras = (text: string): ExtrasFile | null => {
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object') {
      return null
    }
    const record = value as { format?: unknown; sessions?: unknown }
    if (record.format !== 1 || !record.sessions || typeof record.sessions !== 'object') {
      return null
    }
    const deleted: Record<string, number> = {}
    const rawDeleted = (record as { deleted?: unknown }).deleted
    if (rawDeleted && typeof rawDeleted === 'object') {
      for (const [id, at] of Object.entries(rawDeleted as Record<string, unknown>)) {
        if (typeof at === 'number') {
          deleted[id] = at
        }
      }
    }
    const sessions: Record<string, SessionExtras> = {}
    for (const [id, raw] of Object.entries(record.sessions as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') {
        continue
      }
      const entry = raw as {
        memory?: unknown
        pinned?: unknown
        characterId?: unknown
        autoCompact?: unknown
        greetingIndex?: unknown
      }
      sessions[id] = {
        ...(entry.memory && typeof entry.memory === 'object'
          ? { memory: entry.memory as Session['memory'] }
          : {}),
        ...(entry.pinned === true ? { pinned: true } : {}),
        ...(typeof entry.characterId === 'string' && entry.characterId !== ''
          ? { characterId: entry.characterId }
          : {}),
        ...(typeof entry.autoCompact === 'boolean' ? { autoCompact: entry.autoCompact } : {}),
        ...(typeof entry.greetingIndex === 'number' ? { greetingIndex: entry.greetingIndex } : {}),
      }
    }
    const characters = Array.isArray((record as { characters?: unknown }).characters)
      ? ((record as { characters: unknown[] }).characters.filter(
          (item): item is CharacterCard =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as CharacterCard).id === 'string' &&
            typeof (item as CharacterCard).name === 'string'
        ) as CharacterCard[])
      : []
    const rawPrefs = (record as { prefs?: unknown }).prefs
    const prefs: ExtrasFile['prefs'] = {}
    if (rawPrefs && typeof rawPrefs === 'object') {
      const source = rawPrefs as Record<string, unknown>
      for (const key of ['channels', 'activeChannel', 'templateOverrides', 'templateCustom'] as const) {
        if (typeof source[key] === 'string' && (source[key] as string) !== '') {
          prefs[key] = source[key] as string
        }
      }
    }
    return {
      format: 1,
      sessions,
      ...(Object.keys(deleted).length > 0 ? { deleted } : {}),
      ...(characters.length > 0 ? { characters } : {}),
      ...(Object.keys(prefs).length > 0 ? { prefs } : {}),
    }
  } catch {
    return null
  }
}

/** 把 sidecar 回填到会话上；没有对应条目时原样返回 */
export const applyExtras = (session: Session, extras: SessionExtras | undefined): Session => {
  if (!extras) {
    return session
  }
  const memory = extras.memory
  const valid =
    memory && Array.isArray(memory.notes) && Array.isArray(memory.foldedIds)
      ? {
          notes: memory.notes,
          foldedIds: memory.foldedIds,
          // 资料记忆也要跟着备份走，否则换设备/同步后附件摘要全丢
          ...(Array.isArray(memory.attachments) && memory.attachments.length > 0
            ? { attachments: memory.attachments }
            : {}),
          foldedRounds:
            typeof memory.foldedRounds === 'number' ? memory.foldedRounds : memory.foldedIds.length,
          // 会话级整理要求也在这份 memory 里，别在回填时丢掉
          ...(typeof memory.instruction === 'string' && memory.instruction.trim()
            ? { instruction: memory.instruction }
            : {}),
          updatedAt: typeof memory.updatedAt === 'number' ? memory.updatedAt : Date.now(),
        }
      : undefined
  const hasFlags = extras.autoCompact !== undefined || extras.greetingIndex !== undefined
  if (!valid && extras.pinned !== true && !extras.characterId && !hasFlags) {
    return session
  }
  return {
    ...session,
    ...(valid ? { memory: valid } : {}),
    ...(extras.pinned === true ? { pinned: true } : {}),
    ...(extras.characterId ? { characterId: extras.characterId } : {}),
    ...(extras.autoCompact !== undefined ? { autoCompact: extras.autoCompact } : {}),
    ...(extras.greetingIndex !== undefined ? { greetingIndex: extras.greetingIndex } : {}),
  }
}

/** 从归档文件里读 sidecar（没有该条目时返回 null） */
export const readExtrasFromArchive = async (file: File): Promise<ExtrasFile | null> => {
  const { readEntryByPath } = await import('./zipReader.js')
  const blob = await readEntryByPath(file, EXTRAS_PATH).catch(() => null)
  return blob ? parseExtras(await blob.text()) : null
}
