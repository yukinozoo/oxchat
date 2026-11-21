/**
 * 备份管理的操作记录：只存本机 localStorage，最多保留 30 条。
 * 记录的是"什么时候上传/拉取、成功与否、大概多大/多少个会话"，方便用户自己核对同步情况。
 */
export type GiteeLogAction = 'upload' | 'download' | 'auto'

export type GiteeLogEntry = {
  at: number
  action: GiteeLogAction
  ok: boolean
  /** 附加信息：大小、会话数、失败原因等 */
  detail?: string
}

const STORAGE_KEY = 'oxchat:gitee-log'
const MAX_ENTRIES = 30

const safeRead = (): GiteeLogEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter(
        (item): item is GiteeLogEntry =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as GiteeLogEntry).at === 'number' &&
          (['upload', 'download', 'auto'] as const).includes((item as GiteeLogEntry).action)
      )
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

export const loadGiteeLog = (): GiteeLogEntry[] => safeRead()

export const pushGiteeLog = (entry: Omit<GiteeLogEntry, 'at'> & { at?: number }): GiteeLogEntry[] => {
  const next = [{ ...entry, at: entry.at ?? Date.now() }, ...safeRead()].slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用就只在内存里返回，不影响同步本身
  }
  return next
}

export const clearGiteeLog = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
