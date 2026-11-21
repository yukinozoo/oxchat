import { markGiteeSynced, useSettings } from '../settings.js'
import { pushGiteeLog } from './giteeLog.js'

/**
 * 自动下行（拉取 + 合并）：
 * - 只在「进入应用 / 切回前台」时尝试，且两次尝试至少间隔 3 分钟；
 * - 正在生成回复或正在导入时跳过（拉取会中止流、重写历史）；
 * - 失败保持安静，记一条失败日志，下次机会再试。
 */
export const AUTO_PULL_MIN_GAP_MS = 3 * 60_000

type PullState = { lastAttemptAt: number; running: boolean }
const state: PullState = { lastAttemptAt: 0, running: false }

export const autoPullState = (): Readonly<PullState> => ({ ...state })
export const resetAutoPullState = () => {
  state.lastAttemptAt = 0
  state.running = false
}

export type AutoPullInput = {
  enabled: boolean
  configured: boolean
  streaming: number
  importing: boolean
  running: boolean
  lastAttemptAt: number
  now: number
}

/** 纯判断：这次进入前台该不该自动拉取 */
export const shouldAutoPull = (input: AutoPullInput): boolean => {
  if (!input.enabled || !input.configured || input.running || input.importing) {
    return false
  }
  if (input.streaming > 0) {
    return false
  }
  return input.now - input.lastAttemptAt >= AUTO_PULL_MIN_GAP_MS
}

export type AutoPullDeps = {
  pull?: () => Promise<File | null>
  onMerge?: (file: File) => Promise<{ imported: number; updated: number; skipped: number }>
  now?: () => number
  configured?: () => boolean
  streaming?: () => number
  importing?: () => boolean
}

let mergeImpl: AutoPullDeps['onMerge']

export const runAutoPull = async (deps: AutoPullDeps = {}): Promise<boolean> => {
  const settings = useSettings.getState()
  const now = deps.now?.() ?? Date.now()
  const configured = deps.configured ? deps.configured() : undefined
  const streaming = deps.streaming ? deps.streaming() : 0
  const importing = deps.importing ? deps.importing() : false
  if (
    !shouldAutoPull({
      enabled: settings.giteeAutoPull,
      configured: configured ?? Boolean(settings.giteeOwner && settings.giteeRepo && settings.giteeToken),
      streaming,
      importing,
      running: state.running,
      lastAttemptAt: state.lastAttemptAt,
      now,
    })
  ) {
    return false
  }
  state.running = true
  state.lastAttemptAt = now
  try {
    const { pullBackup } = await import('./giteeSync.js')
    const file = await (deps.pull ?? pullBackup)()
    if (!file) {
      return false
    }
    const merge = deps.onMerge ?? mergeImpl
    if (!merge) {
      return false
    }
    const result = await merge(file)
    markGiteeSynced()
    pushGiteeLog({
      action: 'download',
      ok: true,
      detail: `自动：+${result.imported} / ~${result.updated} / =${result.skipped}`,
    })
    return true
  } catch (error) {
    pushGiteeLog({
      action: 'download',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    state.running = false
  }
}

/** App 启动时注入"拉取后如何合并"，避免服务层直接依赖 store（会成环） */
export const registerAutoPullMerge = (merge: NonNullable<AutoPullDeps['onMerge']>) => {
  mergeImpl = merge
}
