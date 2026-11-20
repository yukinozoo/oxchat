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
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionSearch.module.css'

const DEBOUNCE_MS = 200

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
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SessionSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  /** 命中上限被截断时的提示条数；null 表示没有截断 */
  const [truncated, setTruncated] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

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
    setHits([])
    setSearching(true)
    setTruncated(null)
    /** 本轮是否已被新查询取代：被取代后不再追加命中、不改搜索结果状态 */
    let stale = false
    // 输入停顿后再扫库，避免每敲一个字都全量读一遍
    const timer = setTimeout(() => {
      const round = searchSessions(trimmed, (hit) => {
        if (!stale) {
          setHits((previous) => [...previous, hit])
        }
      })
      cancelRef.current = round.cancel
      void round.done
        .then((result) => {
          if (!stale) {
            setTruncated(result.truncated ? result.hits : null)
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
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [query])

  const open = (sessionId: string) => {
    selectSession(sessionId)
    closeMobileSider()
    onBack()
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

      <div className={styles.results}>
        {hits.map((hit, index) => (
          <button
            type="button"
            // 同一会话可能有多条命中，键里带上序号
            key={`${hit.sessionId}-${index}`}
            className={styles.result}
            onClick={() => open(hit.sessionId)}
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
        {truncated !== null ? (
          <div className={styles.hint}>{t('searchSessionsTruncated', { count: truncated })}</div>
        ) : null}
        {!query.trim() ? null : searching ? (
          <div className={styles.hint}>{t('searchSessionsSearching')}</div>
        ) : hits.length === 0 ? (
          <div className={styles.hint}>{t('searchSessionsEmpty')}</div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
