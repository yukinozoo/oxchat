import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

/**
 * 断点与 CSS 保持一致（CSS 里是 `@media not all and (min-width: 768px)`）：
 * 小于 768px 走手机布局（抽屉侧栏、吸底输入框），以上走桌面布局（常驻侧栏、居中内容列）。
 */
const MOBILE_QUERY = '(max-width: 767.98px)'

const mobileQuery = typeof window === 'undefined' ? null : window.matchMedia(MOBILE_QUERY)

const subscribeMobile = (listener: () => void) => {
  mobileQuery?.addEventListener('change', listener)
  return () => mobileQuery?.removeEventListener('change', listener)
}

/**
 * 手机上把浏览器切到「桌面版网站」时，布局视口会变成 980px 左右，
 * 只按宽度判断会误判成桌面布局——于是顶栏的侧边栏按钮和新建对话按钮都不见了。
 * 这里再补一层设备判断：手机 UA 仍然走手机布局。
 */
const PHONE_UA = /iPhone|iPod|Android.*Mobile|HarmonyOS|MiuiBrowser|MicroMessenger/i

const isPhoneUserAgent = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }
  const agent = navigator.userAgent
  return PHONE_UA.test(agent) && !/iPad|Tablet/i.test(agent)
}

/**
 * 触屏设备 + 视口不宽，也按手机布局处理：WebView 在个别情况下会先按桌面宽度布局
 * （980px 左右），此时单看媒体查询会落到桌面分支，顶栏的侧栏与新建按钮就消失了。
 */
const isTouchNarrow = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  const touch = (navigator.maxTouchPoints ?? 0) > 0
  return touch && window.innerWidth < 1024
}

const getIsMobile = () =>
  (mobileQuery?.matches ?? false) || isPhoneUserAgent() || isTouchNarrow()

/** 响应式断点：窗口宽度变化时重新渲染，桌面/手机布局都可用 */
export const useIsMobile = () => useSyncExternalStore(subscribeMobile, getIsMobile, () => false)

const preventPageScroll = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    return
  }
  for (
    let element = event.target instanceof Element ? event.target : null;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element)
    const scrollsY =
      /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth
    if (scrollsY || scrollsX) {
      return
    }
  }
  event.preventDefault()
}

/** 阻止移动端整页滚动，保留内部可滚动区域的滚动和双指缩放。 */
export const usePreventPageScroll = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    document.addEventListener('touchmove', preventPageScroll, { passive: false })
    return () => document.removeEventListener('touchmove', preventPageScroll)
  }, [enabled])
}

/** 移动端页面跟随视觉视口，键盘弹出后顶栏和输入框仍留在可见区域。 */
export const useMobileViewport = (enabled: boolean) => {
  const frameRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      return
    }
    const viewport = window.visualViewport
    const inputSelector = 'textarea, input:not([type="file"])'
    let animationFrame = 0
    const reset = () => {
      frame.style.removeProperty('--app-viewport-height')
      frame.style.removeProperty('--app-viewport-top')
    }
    const update = () => {
      // 双指缩放由浏览器处理，保持当前布局尺寸。
      if (viewport && viewport.scale !== 1) {
        return
      }
      // 失焦后直接恢复 CSS 的全高布局，不等 Safari 收键盘后的 resize。
      if (!document.activeElement?.matches(inputSelector)) {
        reset()
        return
      }
      frame.style.setProperty(
        '--app-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`
      )
      frame.style.setProperty('--app-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    const scheduleFrame = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(update)
    }
    const schedule = () => {
      // 先同步跟上键盘动画，下一帧再校准 Safari 延迟更新的视口读数。
      update()
      scheduleFrame()
    }
    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    // 等点击和焦点切换完成，避免按钮移动、或切换输入框时短暂恢复全高。
    document.addEventListener('focusout', scheduleFrame)
    return () => {
      cancelAnimationFrame(animationFrame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', scheduleFrame)
      reset()
    }
  }, [enabled])

  return frameRef
}
