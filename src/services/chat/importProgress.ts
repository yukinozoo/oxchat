import { create } from 'zustand'

/**
 * 导入任务进度：放在全局 store 里，是因为大包导入要能「关掉对话框继续跑」，
 * 进度条挂在页面顶部，不跟随弹窗生命周期。
 */
export type ImportPhase = 'reading' | 'writing'

export type ImportJob = {
  active: boolean
  phase: ImportPhase
  /** 已处理的会话数 */
  done: number
  /** 会话总数；预扫描失败时为 0，界面按「已处理 N 个」显示 */
  total: number
}

const initial: ImportJob = { active: false, phase: 'reading', done: 0, total: 0 }

export const useImportJob = create<ImportJob>(() => initial)

export const beginImportJob = (total = 0): void => {
  useImportJob.setState({ active: true, phase: 'reading', done: 0, total })
}

export const reportImportProgress = (done: number, total: number, phase?: ImportPhase): void => {
  const current = useImportJob.getState()
  if (!current.active) {
    return
  }
  useImportJob.setState({
    done,
    total: total > 0 ? total : current.total,
    ...(phase === undefined ? {} : { phase }),
  })
}

export const endImportJob = (): void => {
  useImportJob.setState(initial)
}
