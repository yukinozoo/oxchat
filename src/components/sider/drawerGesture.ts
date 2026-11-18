/**
 * 抽屉位移的统一入口。
 *
 * 用 CSS 变量驱动动画而不是 React state：跟手拖拽时每帧都会变，
 * 走 state 会让整个侧边栏重渲染，滚动也跟着卡。
 *   --drawer-offset   当前位移（px）
 *   --drawer-progress 0~1 的打开进度，供遮罩透明度、圆角、阴影使用
 *   --drawer-duration 过渡时长；拖拽时设为 0ms，松手后恢复
 */
const OPEN_DURATION = '280ms'
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

/** 抽屉最大宽度：与 .mobile 的 300px / 100vw-56px 对齐 */
export const drawerWidth = () => Math.min(300, window.innerWidth - 56)

export const setDrawerOffset = (offset: number, animate: boolean) => {
  const root = document.documentElement
  const width = drawerWidth()
  const clamped = Math.max(0, Math.min(width, offset))
  root.style.setProperty('--drawer-duration', animate ? OPEN_DURATION : '0ms')
  root.style.setProperty('--drawer-easing', EASING)
  root.style.setProperty('--drawer-offset', `${clamped}px`)
  root.style.setProperty('--drawer-progress', String(width > 0 ? clamped / width : 0))
}

/** 打开到位（带动效） */
export const openDrawerOffset = () => setDrawerOffset(drawerWidth(), true)

/** 收起（带动效）；调用方负责在动画结束后卸载 */
export const closeDrawerOffset = () => setDrawerOffset(0, true)

/** 无动画归零，用于组件卸载后清理 */
export const resetDrawerOffset = () => setDrawerOffset(0, false)

/**
 * 阻尼曲线：手指移动越远，抽屉跟进越慢，接近全开时需要更长距离。
 * 返回 0~1 的打开进度（指数缓入，dx 等于抽屉宽度时约 0.79）。
 */
export const rubberProgress = (distance: number, width = drawerWidth()): number => {
  if (width <= 0 || distance <= 0) {
    return 0
  }
  const x = distance / (width * 0.62)
  return Math.min(1, 1 - Math.exp(-x))
}

/** 手势吸附判定的进度阈值：过半才判定为"打开"，否则回弹 */
export const OPEN_THRESHOLD = 0.5
