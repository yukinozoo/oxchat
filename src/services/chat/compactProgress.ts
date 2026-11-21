/** 分段整理的进度：段数多时界面要能显示「正在整理 3/12」，否则看着像卡住 */
type Progress = { done: number; total: number }

let current: Progress = { done: 0, total: 0 }
const listeners = new Set<() => void>()

export const compactProgress = (): Progress => current

export const setCompactProgress = (done: number, total: number): void => {
  current = { done, total }
  for (const listener of listeners) {
    listener()
  }
}

export const resetCompactProgress = (): void => setCompactProgress(0, 0)

export const subscribeCompactProgress = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
