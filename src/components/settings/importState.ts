import { create } from 'zustand'

/** 导入进度：已处理 / 总数（按对话计数），总数由预扫描 ZIP 得到 */
export type ImportProgress = { done: number; total: number } | null

/**
 * 导入状态放在组件之外：设置页关闭后组件会卸载，
 * 但导入仍在后台进行，重新进入设置时要能看到实时进度。
 */
type ImportState = {
  busy: boolean
  progress: ImportProgress
}

export const useImportState = create<ImportState>(() => ({ busy: false, progress: null }))

export const setImportBusy = (busy: boolean) => useImportState.setState({ busy })

export const setImportProgress = (progress: ImportProgress) =>
  useImportState.setState({ progress })

/** 防重入：一次只跑一个导入 */
let running = false

export const isImportRunning = () => running

export const setImportRunning = (value: boolean) => {
  running = value
}
