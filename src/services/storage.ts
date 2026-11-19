/**
 * 本地存储健康度：持久化申请、用量估算与备份提醒。
 * 纯前端应用的存储随时可能被浏览器回收，这里只做“看得见 + 提前提醒”，不改变数据本身。
 */

const PERSISTED_KEY = 'oxchat:storage-persisted'
const PERSIST_ATTEMPT_KEY = 'oxchat:persist-attempt-at'
/** 被拒后隔一天再自动重试，避免每次打开都打扰浏览器 */
const PERSIST_RETRY_MS = 24 * 60 * 60 * 1000
const BACKUP_KEY = 'oxchat:last-backup-at'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用时忽略
  }
}

export type StorageStatus = {
  usage: number
  quota: number
  /** 浏览器是否已授予持久化存储 */
  persisted: boolean
  /** 当前浏览器是否支持申请 */
  supported: boolean
}

/** 申请持久化：浏览器会据此避免在磁盘紧张时清掉本站数据 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false
  }
  write(PERSIST_ATTEMPT_KEY, String(Date.now()))
  try {
    if (await navigator.storage.persisted?.()) {
      write(PERSISTED_KEY, 'true')
      return true
    }
    const granted = await navigator.storage.persist()
    write(PERSISTED_KEY, granted ? 'true' : 'false')
    return granted
  } catch {
    return false
  }
}

/** 读取当前用量与配额 */
export const storageStatus = async (): Promise<StorageStatus> => {
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.storage?.persist)
  let usage = 0
  let quota = 0
  let persisted = read(PERSISTED_KEY) === 'true'
  try {
    const estimate = await navigator.storage?.estimate?.()
    usage = estimate?.usage ?? 0
    quota = estimate?.quota ?? 0
    if (navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted()
    }
  } catch {
    // 拿不到估算值时只显示申请状态
  }
  return { usage, quota, persisted, supported }
}

/** 是否适合自动再申请一次持久化（一天一次） */
export const shouldRetryPersist = (): boolean => {
  const last = Number(read(PERSIST_ATTEMPT_KEY) ?? 0) || 0
  return Date.now() - last > PERSIST_RETRY_MS
}

export const lastBackupAt = (): number => Number(read(BACKUP_KEY) ?? 0) || 0

export const markBackupDone = () => write(BACKUP_KEY, String(Date.now()))

/** 超过这个天数没备份就提醒 */
export const BACKUP_REMINDER_DAYS = 7

/** 距离上次备份的天数；从没备份过时返回 null */
export const daysSinceBackup = (): number | null => {
  const last = lastBackupAt()
  if (!last) {
    return null
  }
  return Math.floor((Date.now() - last) / (24 * 60 * 60 * 1000))
}

export const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}
