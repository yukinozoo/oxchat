import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { searchSessions, type SessionSearchHit } from '../../services/chat/localSearch.js'
import { selectSession } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import {
  IconArrowLeftOutline20,
  IconChatOutline20,
  IconCloseOutline16,
  IconPersonOutline20,
  IconSearchOutline16,
} from '../base/icons.js'
import { requestJumpToMessage } from '../messages/jumpTarget.js'
import { closeMobileSider } from './mobileSiderState.js'
import {
  setSearchResults,
  setSessionSearchQuery,
  useSessionSearch,
} from './sessionSearchState.js'
import styles from './SessionSearch.module.css'

const DEBOUNCE_MS = 200
/** 命中是流式来的：攒一小批再刷，避免每命中一条就整表重渲染 */
const FLUSH_MS = 80
/** 结果列表首屏条数与每次续载条数（结果多时只渲染视口附近，不铺几千行） */
const RESULT_PAGE = 100
const RESULT_STEP = 100

/** 搜索结果行的日期：中文用「9月22日」，其它语言用短日期 */
const shortDate = (time: number, locale: string) => {
  const date = new Date(time)
  return locale === 'zh-CN'
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** 侧边栏里的对话搜索：标题与消息内容都搜，命中给出来源与上下文片段 */
export const SessionSearch = ({ onBack }: { onBack: () => void }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  // 关键词存在全局：从对话右滑回侧栏时还是原来那批结果
  const query = useSessionSearch((state) => state.query)
  const setQuery = setSessionSearchQuery
  const [hits, setHits] = useState<SessionSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  /** 命中上限被截断时的提示条数；null 表示没有截断 */
  const [truncated, setTruncated] = useState<number | null>(null)
  /** 已渲染的结果条数：滚动到底部再续一批 */
  const [limit, setLimit] = useState(RESULT_PAGE)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  /** 命中缓冲：定时整批刷进 state */
  const bufferRef = useRef<SessionSearchHit[]>([])
  const flushTimerRef = useRef<number | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const flushHits = () => {
    if (bufferRef.current.length === 0) {
      return
    }
    const batch = bufferRef.current
    bufferRef.current = []
    setHits((previous) => {
      const next = [...previous, ...batch]
      // 边搜边存：搜索中途离开也不会丢这批结果
      setSearchResults({
        query: useSessionSearch.getState().query.trim(),
        hits: next,
        truncated: useSessionSearch.getState().results?.truncated ?? null,
      })
      return next
    })
  }
  const scheduleFlush = () => {
    if (flushTimerRef.current !== null) {
      return
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      flushHits()
    }, FLUSH_MS)
  }
  /** 立刻把缓冲刷出去（搜索结束时用，别丢最后一批命中） */
  const flushNow = () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    flushHits()
  }
  const clearFlush = () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    bufferRef.current = []
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    cancelRef.current?.()
    if (!trimmed) {
      setHits([])
      setSearching(false)
      setTruncated(null)
      return
    }
    // 同一关键词已有结果：直接铺上次那批，不重跑、不闪空态
    const cached = useSessionSearch.getState().results
    if (cached && cached.query === trimmed && cached.hits.length > 0) {
      setHits(cached.hits)
      setTruncated(cached.truncated)
      setSearching(false)
      setLimit(RESULT_PAGE)
      return () => {
        // 卸载不需要做任何清理：这批结果留在全局状态里
      }
    }
    clearFlush()
    setHits([])
    setLimit(RESULT_PAGE)
    setSearching(true)
    setTruncated(null)
    /** 本轮是否已被新查询取代：被取代后不再追加命中、不改搜索结果状态 */
    let stale = false
    // 输入停顿后再扫库，避免每敲一个字都全量读一遍
    const timer = setTimeout(() => {
      const round = searchSessions(trimmed, (hit) => {
        if (stale) {
          return
        }
        bufferRef.current.push(hit)
        scheduleFlush()
      })
      cancelRef.current = round.cancel
      void round.done
        .then((result) => {
          if (!stale) {
            // 收尾时把缓冲区里剩下的命中一次性刷出来
            flushNow()
            setTruncated(result.truncated ? result.hits : null)
            // 存一份给「下次打开搜索」直接复用
            const state = useSessionSearch.getState()
            setSearchResults({
              query: trimmed,
              hits: state.results?.query === trimmed ? state.results.hits : [],
              truncated: result.truncated ? result.hits : null,
            })
          }
        })
        .finally(() => {
          if (!stale) {
            setSearching(false)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
      clearFlush()
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [query])

  /**
   * 打开会话并滚到命中的那条消息；标题命中（messageId 为空）只打开会话。
   * 注意这里**不退出搜索界面**：右滑回侧栏时用户要能接着看这批结果。
   */
  const open = (hit: SessionSearchHit) => {
    selectSession(hit.sessionId)
    if (hit.messageId) {
      requestJumpToMessage(hit.sessionId, hit.messageId)
    }
    closeMobileSider()
  }

  // 挂到 body：抽屉可能带 transform/overflow，会把 fixed 层限制在抽屉内部
  return createPortal(
    <div className={styles.view} data-fullscreen-overlay>
      <div className={styles.topBar}>
        <button type="button" className={styles.back} aria-label={t('back')} onClick={onBack}>
          <IconArrowLeftOutline20 />
        </button>
        <div className={styles.field}>
          <span className={styles.fieldIcon}>
            <IconSearchOutline16 />
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder={t('searchSessionsPlaceholder')}
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onBack()
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className={styles.clear}
              aria-label={t('clear')}
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <IconCloseOutline16 />
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={resultsRef}
        className={styles.results}
        onScroll={(event) => {
          const element = event.currentTarget
          if (
            hits.length > limit &&
            element.scrollHeight - element.scrollTop - element.clientHeight < 320
          ) {
            setLimit((current) => current + RESULT_STEP)
          }
        }}
      >
        {hits.slice(0, limit).map((hit, index) => (
          <button
            type="button"
            // 同一会话可能有多条命中，键里带上序号
            key={`${hit.sessionId}-${index}`}
            className={styles.result}
            onClick={() => open(hit)}
          >
            <span className={clsx(styles.avatar, hit.source === 'user' && styles.avatarUser)}>
              {hit.source === 'user' ? <IconPersonOutline20 /> : <IconChatOutline20 />}
            </span>
            <span className={styles.body}>
              <span className={styles.line}>
                <span className={styles.title}>{hit.title || t('untitledChat')}</span>
                <span className={styles.date}>{shortDate(hit.updatedAt, locale)}</span>
              </span>
              {hit.snippet ? <span className={styles.snippet}>{hit.snippet}</span> : null}
            </span>
          </button>
        ))}
        {hits.length > limit ? (
          <button
            type="button"
            className={styles.hint}
            onClick={() => setLimit((current) => current + RESULT_STEP)}
          >
            {t('searchLoadMore', { count: hits.length - limit })}
          </button>
        ) : null}
        {truncated !== null ? (
          <div className={styles.hint}>{t('searchSessionsTruncated', { count: truncated })}</div>
        ) : null}
        {!query.trim() ? null : searching ? (
          <div className={styles.hint}>{t('searchSessionsSearching')}</div>
        ) : hits.length === 0 ? (
          <div className={styles.hint}>
            {t('searchSessionsEmptyKeyword', { query: query.trim() })}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
