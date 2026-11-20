import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { IconArrowDownOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { AssistantMessage } from './AssistantMessage.js'
import { onJumpToFirst, ScrollToBottomContext } from './scrollContext.js'
import { onJumpTarget, takeJumpTarget, windowAround } from './jumpTarget.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/**
 * 首屏挂载与每次续载的消息条数。超长会话（几千条）全量挂载时，
 * 光 Markdown/代码高亮/公式的初次渲染就能把中端机卡住几秒。
 */
const WINDOW_PAGE = 60
/** 滚动触发续载的步长：比首屏小，单次补进来的渲染成本更低，滑动不容易顿一下 */
const LOAD_CHUNK = 20
/** 同时挂载的消息上限：超出就把离视口远的那一头回收，1500 轮也不会越滚越卡 */
const WINDOW_MAX = WINDOW_PAGE + 2 * LOAD_CHUNK * 3

/** 当前窗口：null 表示「默认窗口」= 最后一页 */
type WindowRange = { sessionId: string; start: number | null; end: number | null }

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const t = useTranslate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  /** 是否停靠在底部；离开底部时显示「滑到底部」按钮 */
  const [atBottom, setAtBottom] = useState(true)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const total = messages.length
  /**
   * 渲染窗口：默认只挂最后一页，向上/向下按页扩展；
   * 双击顶栏跳第 1 条时把窗口挪到开头（而不是把全文都挂上）。
   */
  const [range, setRange] = useState<WindowRange>({
    sessionId: session.id,
    start: null,
    end: null,
  })
  if (range.sessionId !== session.id) {
    // 切会话：窗口回到最后一页，避免拿上一个会话的偏移去切新数组
    setRange({ sessionId: session.id, start: null, end: null })
  }
  const startIndex = Math.max(
    0,
    Math.min(range.start ?? Math.max(0, total - WINDOW_PAGE), Math.max(0, total - 1))
  )
  const endIndex = Math.min(total, range.end ?? total)
  const hasEarlier = startIndex > 0
  const hasLater = endIndex < total
  /** 续载更早消息时的滚动锚点：记下滚动高度，插完按差值补回位置 */
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  /** 双击顶栏后需要滚到第一条 */
  const jumpTopRef = useRef(false)
  /** 从搜索结果跳过来时，渲染完要滚到并把这条消息高亮一下 */
  const pendingHitRef = useRef<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    // 新消息进列表：窗口回到最后一页，否则会看不到正在生成的回答
    setRange((previous) =>
      previous.start === null && previous.end === null
        ? previous
        : { sessionId: session.id, start: null, end: null }
    )
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  // 续载更早的消息后按高度差补回滚动位置，视觉上停在原处
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const scroll = scrollRef.current
    if (!anchor || !scroll) {
      return
    }
    anchorRef.current = null
    scroll.scrollTop = anchor.top + (scroll.scrollHeight - anchor.height)
    scrollTopRef.current = scroll.scrollTop
  }, [range])

  // 双击顶栏跳到第 1 条：窗口挪到开头再滚到顶
  useEffect(
    () =>
      onJumpToFirst(() => {
        const scroll = scrollRef.current
        if (!scroll) {
          return
        }
        stickyRef.current = false
        anchorRef.current = null
        jumpTopRef.current = true
        setRange((previous) =>
          previous.start === 0 && previous.end === WINDOW_PAGE
            ? previous
            : { sessionId: session.id, start: 0, end: Math.min(WINDOW_PAGE, total) }
        )
      }),
    [session.id, total]
  )

  useLayoutEffect(() => {
    if (!jumpTopRef.current) {
      return
    }
    jumpTopRef.current = false
    const scroll = scrollRef.current
    if (scroll) {
      scroll.scrollTop = 0
      scrollTopRef.current = 0
    }
  }, [range])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      setAtBottom(nearBottom)
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    stickyRef.current = true
    // 窗口不在尾部时先扩到尾部，再滚下去
    setRange((previous) =>
      previous.end === null ? previous : { sessionId: session.id, start: null, end: null }
    )
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [session.id])

  /**
   * 向上续载更早的消息，并按滚动高度差把位置补回原处。
   * 窗口超过上限时把尾部（离视口远、用户已经看过的那头）回收掉，
   * 这样 3000 条的长会话来回滚也不会累积成几千个 DOM 节点。
   */
  const loadEarlier = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
    }
    stickyRef.current = false
    setRange({
      sessionId: session.id,
      start: Math.max(0, startIndex - LOAD_CHUNK),
      end: Math.min(endIndex, Math.max(0, startIndex - LOAD_CHUNK) + WINDOW_MAX),
    })
  }, [session.id, startIndex, endIndex])

  /** 向下续载更晚的消息：窗口超限时回收头部，锚点补偿把视野钉在原处 */
  const loadLater = useCallback(() => {
    const el = scrollRef.current
    const nextEnd = Math.min(total, endIndex + LOAD_CHUNK)
    const nextStart = Math.max(startIndex, nextEnd - WINDOW_MAX)
    if (nextStart > startIndex && el) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
    }
    stickyRef.current = false
    setRange({ sessionId: session.id, start: nextStart, end: nextEnd })
  }, [session.id, startIndex, endIndex, total])

  /** 把窗口摆到目标消息附近，渲染后滚到它并短暂高亮 */
  const jumpToMessage = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((message) => message.id === messageId)
      if (index < 0) {
        return
      }
      stickyRef.current = false
      anchorRef.current = null
      pendingHitRef.current = messageId
      setRange({
        sessionId: session.id,
        ...windowAround(index, total, WINDOW_PAGE, WINDOW_MAX),
      })
    },
    [messages, session.id, total]
  )

  // 挂载/切会话时先消费待办：搜索面板可能比列表先动作
  useEffect(() => {
    const target = takeJumpTarget(session.id)
    if (target) {
      jumpToMessage(target)
    }
    // 只处理当前会话的一次性跳转
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, total])

  useEffect(
    () =>
      onJumpTarget((target) => {
        if (target.sessionId === session.id) {
          jumpToMessage(target.messageId)
        }
      }),
    [session.id, jumpToMessage]
  )

  // 渲染完成后再滚到目标消息；dom 里靠 data-message-id 定位
  useLayoutEffect(() => {
    const messageId = pendingHitRef.current
    if (!messageId) {
      return
    }
    const node = contentRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    )
    if (!node) {
      return
    }
    pendingHitRef.current = null
    // 部分内嵌 WebView 没有 scrollIntoView，降级为直接改滚动位置
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center' })
    }
    setHighlightId(messageId)
  }, [range])

  // 高亮 2.2 秒后自动消失
  useEffect(() => {
    if (!highlightId) {
      return
    }
    const timer = setTimeout(() => setHighlightId(null), 2200)
    return () => clearTimeout(timer)
  }, [highlightId])

  /** 滚动回调里读最新窗口状态，避免每次窗口变化都重挂监听 */
  const windowRef = useRef({ start: startIndex, end: endIndex, total })
  windowRef.current = { start: startIndex, end: endIndex, total }
  const loadEarlierRef = useRef(loadEarlier)
  loadEarlierRef.current = loadEarlier
  const lastAutoLoadRef = useRef(0)

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    const maybeLoadEarlier = () => {
      const state = windowRef.current
      if (state.start <= 0) {
        return
      }
      // 离顶部还剩一屏多时就先补，补进来的内容在视口上方，用户看不到跳变
      const nearTop = (el?.scrollTop ?? 0) < (el?.clientHeight ?? 0) * 1.5
      if (!nearTop) {
        return
      }
      const now = performance.now()
      // 补进来的高度会让 scrollTop 变化，节流避免一次滚动连开好几页
      if (now - lastAutoLoadRef.current < 120) {
        return
      }
      lastAutoLoadRef.current = now
      loadEarlierRef.current()
    }
    el?.addEventListener('scroll', maybeLoadEarlier, { passive: true })
    return () => el?.removeEventListener('scroll', maybeLoadEarlier)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastIndex = total - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {hasEarlier ? (
              <div className={styles.windowBar}>
                <button type="button" className={styles.windowButton} onClick={loadEarlier}>
                  {t('loadEarlierMessages', { count: startIndex })}
                </button>
              </div>
            ) : null}
            {messages.slice(startIndex, endIndex).map((message, offset) => {
              const index = startIndex + offset
              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={
                    highlightId === message.id ? `${styles.item} ${styles.hitFlash}` : styles.item
                  }
                >
                  {message.role === 'user' ? (
                    <UserMessage
                      key={message.id}
                      sessionId={session.id}
                      message={message}
                      retryUploadId={uploadRetryId}
                      isFirst={index === 0}
                      isLast={index === lastIndex || index === lastIndex - 1}
                      busy={streaming}
                      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                      onSelectVersion={selectVersion}
                    />
                  ) : (
                    <AssistantMessage
                      sessionId={session.id}
                      message={message}
                      isLast={index === lastIndex}
                      streaming={streaming && index === lastIndex}
                      busy={streaming}
                      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                      onSelectVersion={selectVersion}
                    />
                  )}
                </div>
              )
            })}
            {hasLater ? (
              <div className={styles.windowBar}>
                <button type="button" className={styles.windowButton} onClick={loadLater}>
                  {t('loadLaterMessages', { count: total - endIndex })}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {atBottom ? null : (
          <div className={styles.toBottomWrap}>
            <button
              type="button"
              className={styles.toBottom}
              aria-label={t('scrollToBottom')}
              onClick={jumpToBottom}
            >
              <IconArrowDownOutline20 />
            </button>
          </div>
        )}
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
