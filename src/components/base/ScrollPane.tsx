import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './ScrollPane.module.css'

/**
 * 带自绘滚动条的滚动容器。
 *
 * 为什么不用原生滚动条：安卓 WebView 上原生 overlay 滚动条**不可拖动**、平时也不显示，
 * 长列表（设置页 1800px、记忆笔记、搜索结果）里用户完全看不出自己在哪。
 * 这里用一层 overlay thumb 顶上：位置比例可见、可以按住拖动、空闲 900ms 自动淡出。
 *
 * 不替换聊天消息列表（MessageList）：那里有窗口化渲染和"粘底"逻辑，
 * 换容器风险远大于收益，原生滚动在消息区反而更跟手。
 */
export type ScrollPaneProps = {
  className?: string
  /** 内层内容容器的 class（原来的 padding / flex 放这里） */
  contentClassName?: string
  children: React.ReactNode
  onScroll?: (element: HTMLDivElement) => void
  /** 语义角色（例如 tabpanel），透传给内部滚动容器 */
  role?: string
  ariaLabel?: string
  /** 外部需要量高度/判断是否到底时，把滚动容器 ref 交出去 */
  scrollerRef?: { current: HTMLDivElement | null }
}

/** thumb 的最小高度：内容再长也留一个能抓住的块 */
const MIN_THUMB = 28
/** 空闲多久淡出 */
const IDLE_MS = 900

/** 滚动位置 → thumb 尺寸与偏移（纯函数，方便冒烟验比例） */
export const thumbMetrics = (
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number
): { height: number; top: number } => {
  if (scrollHeight <= clientHeight + 1) {
    return { height: 0, top: 0 }
  }
  const height = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * clientHeight)
  const maxTop = clientHeight - height
  const ratio = Math.min(1, Math.max(0, scrollTop / (scrollHeight - clientHeight)))
  return { height, top: maxTop * ratio }
}

/** 拖动 thumb 的像素位移 → 应该滚到哪（纯函数） */
export const scrollTopForDrag = (
  scrollHeight: number,
  clientHeight: number,
  startTop: number,
  deltaY: number
): number => {
  const thumbHeight = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * clientHeight)
  const usable = clientHeight - thumbHeight
  if (usable <= 0) {
    return startTop
  }
  const ratio = (scrollHeight - clientHeight) / usable
  const next = startTop + deltaY * ratio
  return Math.min(scrollHeight - clientHeight, Math.max(0, next))
}

export const ScrollPane = ({
  className,
  contentClassName,
  children,
  onScroll,
  role,
  ariaLabel,
  scrollerRef,
}: ScrollPaneProps) => {
  const scrollerRefLocal = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState({ height: 0, top: 0, visible: false })
  const idleTimer = useRef<number | null>(null)
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null)

  const measure = useCallback(() => {
    const element = scrollerRefLocal.current
    if (!element) {
      return
    }
    const { scrollHeight, clientHeight, scrollTop } = element
    if (scrollHeight <= clientHeight + 1) {
      setMetrics({ height: 0, top: 0, visible: false })
      return
    }
    const { height, top } = thumbMetrics(scrollHeight, clientHeight, scrollTop)
    setMetrics({ height, top, visible: true })
  }, [])

  const scheduleHide = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current)
    }
    idleTimer.current = window.setTimeout(() => {
      setMetrics((current) => ({ ...current, visible: false }))
      idleTimer.current = null
    }, IDLE_MS)
  }, [])

  const handleScroll = () => {
    measure()
    scheduleHide()
    if (scrollerRefLocal.current) {
      onScroll?.(scrollerRefLocal.current)
    }
  }

  useEffect(() => {
    measure()
    const element = scrollerRefLocal.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => measure())
    observer.observe(element)
    if (contentRef.current) {
      observer.observe(contentRef.current)
    }
    return () => observer.disconnect()
  }, [measure])

  useEffect(
    () => () => {
      if (idleTimer.current !== null) {
        window.clearTimeout(idleTimer.current)
      }
    },
    []
  )

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const element = scrollerRefLocal.current
    if (!element) {
      return
    }
    dragRef.current = { startY: event.clientY, startTop: element.scrollTop }
    event.currentTarget.setPointerCapture(event.pointerId)
    setMetrics((current) => ({ ...current, visible: true }))
  }

  const onDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const element = scrollerRefLocal.current
    if (!drag || !element) {
      return
    }
    element.scrollTop = scrollTopForDrag(
      element.scrollHeight,
      element.clientHeight,
      drag.startTop,
      event.clientY - drag.startY
    )
  }

  const endDrag = () => {
    dragRef.current = null
    scheduleHide()
  }

  return (
    <div className={clsx(styles.wrap, className)}>
      <div
        ref={(element) => {
          if (scrollerRef) {
            scrollerRef.current = element
          }
          scrollerRefLocal.current = element
        }}
        className={styles.scroller}
        role={role}
        aria-label={ariaLabel}
        onScroll={handleScroll}
      >
        <div ref={contentRef} className={contentClassName}>
          {children}
        </div>
      </div>
      {metrics.height > 0 ? (
        <div className={styles.track} aria-hidden="true">
          <div
            className={clsx(styles.thumb, metrics.visible && styles.thumbVisible)}
            style={{ height: `${metrics.height}px`, transform: `translateY(${metrics.top}px)` }}
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      ) : null}
    </div>
  )
}
