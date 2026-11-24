import { create } from 'zustand'
import { CHANGELOG, entryFor, latestEntry, type ChangelogEntry } from '../../services/changelog.js'

/** 已读标记：存版本号，换版本后会再弹一次 */
const SEEN_KEY = 'oxchat:changelog-seen'

const readSeen = (): string => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}

const writeSeen = (value: string) => {
  try {
    localStorage.setItem(SEEN_KEY, value)
  } catch {
    // 存储不可用时只是下次还会弹，不影响使用
  }
}

type ChangelogState = {
  /** 当前展示的版本记录；null 表示弹窗关闭 */
  entry: ChangelogEntry | null
  /** 展示单条记录（自动读取「已读」判断） */
  maybeShow: (versionCode: number | null, hasApiKey: boolean) => void
  /** 手动打开（关于页入口） */
  open: (versionCode: number | null) => void
  close: () => void
}

export const useChangelog = create<ChangelogState>((set, get) => ({
  entry: null,
  maybeShow: (versionCode, hasApiKey) => {
    // 首装（没有 API Key）不弹：别打断新用户看欢迎页
    if (!hasApiKey) {
      return
    }
    const entry = entryFor(versionCode)
    if (!entry || get().entry) {
      return
    }
    if (readSeen() === String(entry.versionCode)) {
      return
    }
    set({ entry })
  },
  open: (versionCode) => {
    set({ entry: entryFor(versionCode) ?? latestEntry() })
  },
  close: () => {
    const entry = get().entry
    if (entry) {
      writeSeen(String(entry.versionCode))
    }
    set({ entry: null })
  },
}))

/** 冒烟用：把所有版本的「已读」标记清掉 */
export const resetChangelogSeen = () => writeSeen('')

/** 冒烟用：当前已读到的版本号 */
export const readChangelogSeen = () => readSeen()

/** 版本条数（关于页显示「共 N 版」用） */
export const changelogCount = () => CHANGELOG.length
