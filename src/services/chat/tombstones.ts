/**
 * 删除墓碑。
 *
 * 同步是按「整包覆盖 + 同 id 按 updatedAt 合并」工作的：A 设备删掉一条会话，
 * 本地就什么都不剩了，B 设备下次拉到的包里仍然有它 —— 于是「删了又回来」。
 * 墓碑就是替这条会话留下一张「某某时间被删」的小纸条：随备份一起走，
 * 其他设备看到就把本地那份也删掉。
 *
 * 存在 localStorage（体积小、随包导出），最多留 300 条、90 天自动过期。
 */
export type Tombstone = { id: string; at: number }

const STORAGE_KEY = 'oxchat:tombstones'
const MAX_ENTRIES = 300
/** 超过这个天数的墓碑不再保留：这么久以前的删除不值得再同步 */
const TTL_MS = 90 * 24 * 60 * 60 * 1000

const read = (): Tombstone[] => {
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
        (item): item is Tombstone =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Tombstone).id === 'string' &&
          typeof (item as Tombstone).at === 'number'
      )
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

const write = (list: Tombstone[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)))
  } catch {
    // 存储不可用时只是这一台设备不上报删除，不影响其它功能
  }
}

/** 当前全部墓碑（已按时间倒序，过期的自动剔除） */
export const loadTombstones = (now = Date.now()): Tombstone[] => {
  const list = read().filter((item) => now - item.at < TTL_MS)
  return list.sort((a, b) => b.at - a.at)
}

/** 记一条删除；同 id 重复删只会保留最新时间 */
export const addTombstone = (id: string, at = Date.now()): void => {
  const list = read().filter((item) => item.id !== id)
  list.unshift({ id, at })
  write(list)
}

/** 合并远端墓碑（取每条更晚的时间），返回合并后条数 */
export const mergeTombstones = (remote: readonly Tombstone[]): number => {
  if (remote.length === 0) {
    return 0
  }
  const byId = new Map<string, number>()
  for (const item of read()) {
    byId.set(item.id, item.at)
  }
  for (const item of remote) {
    const existing = byId.get(item.id) ?? 0
    if (item.at > existing) {
      byId.set(item.id, item.at)
    }
  }
  const merged = [...byId.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
  write(merged)
  return merged.length
}

/** 导出用：id → 删除时间 */
export const tombstoneMap = (now = Date.now()): Record<string, number> => {
  const map: Record<string, number> = {}
  for (const item of loadTombstones(now)) {
    map[item.id] = item.at
  }
  return map
}

/** 清理某条墓碑（例如用户又把这条会话导入回来了） */
export const dropTombstone = (id: string): void => {
  const list = read().filter((item) => item.id !== id)
  write(list)
}

/** 冒烟用：清空 */
export const clearTombstones = (): void => write([])
