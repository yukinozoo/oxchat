import { markGiteeSynced, useSettings } from '../settings.js'
import { pushGiteeLog } from './giteeLog.js'

/**
 * 自动备份的时机（刻意做得可预期，不做"实时"）：
 * 1. 每完成 5 条回复后（够一批改动，又不至于每条都传一次整包）；
 * 2. 切到后台/离开页面时，若距上次成功同步超过 10 分钟且期间有新回复；
 * 3. 两次自动上传之间至少间隔 3 分钟（防抖）。
 * 失败不重试、不打扰：下一次命中时机自然会再试，手动按钮永远可用。
 */
export const AUTO_REPLY_THRESHOLD = 5
export const AUTO_MIN_GAP_MS = 3 * 60_000
export const AUTO_IDLE_GAP_MS = 10 * 60_000

export type AutoSyncReason = 'reply' | 'hide'

type AutoState = {
  /** 距上次成功同步后又完成了多少条回复 */
  pendingReplies: number
  /** 上次尝试（无论成败）的时间，用于防抖 */
  lastAttemptAt: number
  syncing: boolean
}

const state: AutoState = { pendingReplies: 0, lastAttemptAt: 0, syncing: false }

export const autoSyncState = (): Readonly<AutoState> => ({ ...state })
export const resetAutoSyncState = () => {
  state.pendingReplies = 0
  state.lastAttemptAt = 0
  state.syncing = false
}

export type AutoSyncInput = {
  enabled: boolean
  configured: boolean
  reason: AutoSyncReason
  pendingReplies: number
  lastAttemptAt: number
  lastSyncAt: number
  now: number
  syncing: boolean
}

/** 纯判断：什么时候该自动上传（便于冒烟与将来调整策略） */
export const shouldAutoSync = (input: AutoSyncInput): boolean => {
  if (!input.enabled || !input.configured || input.syncing) {
    return false
  }
  if (input.now - input.lastAttemptAt < AUTO_MIN_GAP_MS) {
    return false
  }
  if (input.reason === 'reply') {
    return input.pendingReplies >= AUTO_REPLY_THRESHOLD
  }
  // 切后台：只在"确实有新内容、且已经过去足够久"时补一次
  return input.pendingReplies > 0 && input.now - input.lastSyncAt >= AUTO_IDLE_GAP_MS
}

export const runAutoSync = async (
  reason: AutoSyncReason,
  deps: {
    push?: () => Promise<unknown>
    configured?: () => boolean
    now?: () => number
  } = {}
): Promise<boolean> => {
  const settings = useSettings.getState()
  const now = deps.now?.() ?? Date.now()
  // 动态引入：giteeSync → backup → store，静态引入会形成 store→autoSync→sync→backup→store 的环
  const sync = deps.push && deps.configured ? null : await import('./giteeSync.js')
  const configured = deps.configured
    ? deps.configured()
    : (sync?.isGiteeConfigured() ?? false)
  const push = deps.push ?? sync?.pushBackup
  if (!push) {
    return false
  }
  if (
    !shouldAutoSync({
      enabled: settings.giteeAutoSync,
      configured,
      reason,
      pendingReplies: state.pendingReplies,
      lastAttemptAt: state.lastAttemptAt,
      lastSyncAt: settings.giteeLastSync,
      now,
      syncing: state.syncing,
    })
  ) {
    return false
  }
  state.syncing = true
  state.lastAttemptAt = now
  try {
    await push()
    state.pendingReplies = 0
    markGiteeSynced()
    pushGiteeLog({ action: 'auto', ok: true })
    return true
  } catch (error) {
    // 自动备份失败保持安静：计数不清零，下次命中时机再试
    pushGiteeLog({
      action: 'auto',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    state.syncing = false
  }
}

/** 一条回复完成（成功落库后调用） */
export const noteReplyCompleted = () => {
  state.pendingReplies += 1
  void runAutoSync('reply')
}

/** 切到后台时补一次；页面被丢弃前调用不保证发完，尽力而为 */
export const noteAppHidden = () => {
  void runAutoSync('hide')
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      noteAppHidden()
    }
  })
}
