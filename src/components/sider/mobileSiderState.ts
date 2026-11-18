import { create } from 'zustand'
import { closeDrawerOffset } from './drawerGesture.js'

/** 出场动画时长，与 --drawer-duration 保持一致 */
const CLOSE_DURATION = 300

/** 移动端侧边栏抽屉：顶栏菜单按钮打开，点遮罩、切换会话或开启新对话后关闭 */
/**
 * dragging：本次打开是否由手势发起。
 * 手势打开时不能再播放"滑入到位"动画，否则会把跟手位移顶掉。
 */
export const useMobileSider = create(() => ({ open: false, dragging: false }))

export const openMobileSider = (dragging = false) =>
  useMobileSider.setState({ open: true, dragging })

export const setSiderDragging = (dragging: boolean) => useMobileSider.setState({ dragging })

export const closeMobileSider = () => {
  if (!useMobileSider.getState().open) {
    return
  }
  // 先播完位移再卸载，避免主界面瞬间弹回
  closeDrawerOffset()
  window.setTimeout(() => useMobileSider.setState({ open: false, dragging: false }), CLOSE_DURATION)
}
