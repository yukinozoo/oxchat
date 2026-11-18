import { useEffect } from 'react'
import { OPEN_THRESHOLD, drawerWidth, rubberProgress, setDrawerOffset } from './drawerGesture.js'
import {
  closeMobileSider,
  openMobileSider,
  setSiderDragging,
  useMobileSider,
} from './mobileSiderState.js'

/** 从左边缘多少宽度内起手算打开手势 */
const EDGE_WIDTH = 32
/* 吸附判定改用 drawerGesture 的 OPEN_THRESHOLD */

/** 全屏页面（设置、搜索）打开时不响应边缘手势 */
const hasFullscreenOverlay = () => document.querySelector('[data-fullscreen-overlay]') !== null

/**
 * 移动端「从左边缘右滑打开侧边栏」，跟手位移：
 * 按下时把抽屉挂载出来（位移 0），拖动实时改位移，松手按比例吸附。
 */
export const useEdgeSwipe = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    let startX = 0
    let startY = 0
    let tracking = false
    let offset = 0

    const onStart = (event: TouchEvent) => {
      // 抽屉已打开时不再接管手势；状态在回调里现查，避免把 effect 绑到 open 上
      if (useMobileSider.getState().open) {
        tracking = false
        return
      }
      if (event.touches.length !== 1 || hasFullscreenOverlay()) {
        tracking = false
        return
      }
      const touch = event.touches[0]
      if (touch.clientX > EDGE_WIDTH) {
        tracking = false
        return
      }
      tracking = true
      startX = touch.clientX
      startY = touch.clientY
      offset = 0
      // 手势打开：先挂载抽屉（位移 0），并标记 dragging 让它不要自动滑到全开
      setDrawerOffset(0, false)
      openMobileSider(true)
    }

    const onMove = (event: TouchEvent) => {
      if (!tracking) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = Math.abs(touch.clientY - startY)
      // 纵向为主：交还给列表滚动，抽屉退回关闭
      if (dy > 36 && dy > Math.abs(dx)) {
        tracking = false
        setDrawerOffset(0, false)
        return
      }
      // 阻尼：手指走得多，抽屉才走得多，接近全开越来越费劲
      offset = Math.min(1, rubberProgress(dx))
      setDrawerOffset(offset * drawerWidth(), false)
      event.preventDefault()
    }

    const finish = () => {
      if (!tracking) {
        return
      }
      tracking = false
      setSiderDragging(false)
      // 过半才打开，否则回弹并卸载抽屉（否则 open 一直是 true，边缘手势会失效）
      if (offset >= OPEN_THRESHOLD) {
        setDrawerOffset(drawerWidth(), true)
      } else {
        closeMobileSider()
      }
    }

    // 捕获阶段：先于聊天列表的滚动容器拿到事件，避免横滑被滚动吞掉
    document.addEventListener('touchstart', onStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onMove, { passive: false, capture: true })
    document.addEventListener('touchend', finish, { passive: true, capture: true })
    document.addEventListener('touchcancel', finish, { passive: true, capture: true })
    return () => {
      document.removeEventListener('touchstart', onStart, { capture: true })
      document.removeEventListener('touchmove', onMove, { capture: true })
      document.removeEventListener('touchend', finish, { capture: true })
      document.removeEventListener('touchcancel', finish, { capture: true })
    }
  }, [enabled])
}
