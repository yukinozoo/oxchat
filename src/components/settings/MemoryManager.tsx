import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import * as db from '../../services/chat/db.js'
import { noteSource, SUMMARY_SECTION_CAP } from '../../services/chat/memory.js'
import {
  ensureSession,
  saveMemoryNotes,
  selectSession,
  useChatStore,
} from '../../services/chat/store.js'
import { Modal } from '../base/Modal.js'
import { MemoryDialog } from '../chatInput/MemoryDialog.js'
import styles from './MemoryManager.module.css'
import { closeSettings } from './settingsDialogState.js'

/**
 * 记忆管理：把所有会话里压缩出来的笔记汇总到一处。
 *
 * 数据来源是「会话 → memory」；会话列表本身只有摘要，所以要按需读一遍详情。
 * 一次最多扫 400 条（超出部分先不统计），并显示进度，避免几千条时界面像卡住。
 *
 * 这里的「笔记」按钮会先把会话载入缓存，再打开 `MemoryDialog` —— 那是全应用
 * 唯一能改笔记的地方（压缩面板里按用户要求已经不再挂它）。
 */
const SCAN_LIMIT = 400

type Row = {
  id: string
  title: string
  updatedAt: number
  manual: number
  summary: number
  foldedRounds: number
  /** 这条会话还没有记忆（没压过）：也能点进去加第一条手写笔记 */
  hasMemory: boolean
  /** 独立资料记忆条数：只有资料记忆、没有笔记时也能说清状态 */
  attachments: number
  /** 笔记总字数（注入时按 24,000 字封顶，这里给个直观数字） */
  chars: number
  /** 标题 + 全部笔记正文，供搜索用 */
  haystack: string
}

export const MemoryManager = () => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [keyword, setKeyword] = useState('')
  const [dialogId, setDialogId] = useState<string | null>(null)
  /** 「新增记忆」：先选对话，再打开笔记面板 */
  const [picking, setPicking] = useState(false)
  const [pickKeyword, setPickKeyword] = useState('')
  /** 会话筛选：全部 / 只看手写 / 只看压缩 */
  const [kind, setKind] = useState<'all' | 'manual' | 'summary'>('all')
  /** 默认只列「有记忆」的会话；打开后把没有记忆的对话也列出来，方便直接挑一条去写笔记 */
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    const scan = async () => {
      const list = sessions.slice(0, SCAN_LIMIT)
      setProgress({ done: 0, total: list.length })
      const found: Row[] = []
      for (const [index, summary] of list.entries()) {
        if (cancelled) {
          return
        }
        const cache = useChatStore.getState().sessionCache[summary.id]
        const session = cache ?? (await db.loadSession(summary.id).catch(() => undefined))
        if (session) {
          const memory = session.memory
          const manual = memory?.notes.filter((note) => noteSource(note) === 'manual').length ?? 0
          const digest = (memory?.notes.length ?? 0) - manual
          const title = summary.title || t('untitledChat')
          const chars = memory?.notes.reduce((sum, note) => sum + note.text.length, 0) ?? 0
          found.push({
            id: summary.id,
            title,
            updatedAt: memory?.updatedAt || summary.updatedAt,
            manual,
            summary: digest,
            foldedRounds: memory?.foldedRounds ?? 0,
            chars,
            attachments: memory?.attachments?.length ?? 0,
            hasMemory: Boolean(memory),
            haystack: `${title}\n${(memory?.notes ?? []).map((note) => note.text).join('\n')}`,
          })
        }
        if ((index + 1) % 20 === 0) {
          setProgress({ done: index + 1, total: list.length })
          // 让出一帧，长列表扫描时界面不至于完全不动
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      if (cancelled) {
        return
      }
      setProgress({ done: list.length, total: list.length })
      setRows(found.sort((a, b) => b.updatedAt - a.updatedAt))
    }
    void scan()
    return () => {
      cancelled = true
    }
    // 进入页面扫一次：会话更新后重新进来即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          manual: acc.manual + row.manual,
          summary: acc.summary + row.summary,
          folded: acc.folded + row.foldedRounds,
        }),
        { manual: 0, summary: 0, folded: 0 }
      ),
    [rows]
  )

  const withMemory = rows.filter((row) => row.hasMemory)
  const visible = showAll ? rows : withMemory
  const byKind =
    kind === 'all'
      ? visible
      : visible.filter((row) => (kind === 'manual' ? row.manual > 0 : row.summary > 0))
  const filtered = keyword.trim()
    ? byKind.filter((row) => row.haystack.toLowerCase().includes(keyword.trim().toLowerCase()))
    : byKind
  const scanning = progress.total > 0 && progress.done < progress.total

  const open = (id: string) => {
    // 先关设置再切会话：设置层在最上面，不关会挡住
    closeSettings()
    selectSession(id)
  }

  const startForSession = async (id: string) => {
    await ensureSession(id)
    const session = useChatStore.getState().sessionCache[id]
    if (session && !session.memory) {
      saveMemoryNotes(id, [])
    }
    setPicking(false)
    setPickKeyword('')
    setDialogId(id)
  }

  const openNotes = async (id: string) => {
    await ensureSession(id)
    const session = useChatStore.getState().sessionCache[id]
    if (session && !session.memory) {
      // 没压过的会话也能从零开始写笔记：先建一条空记忆
      saveMemoryNotes(id, [])
    }
    setDialogId(id)
  }

  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('memoryManageLead', { cap: SUMMARY_SECTION_CAP })}</p>
      {rows.length > 0 ? (
        <>
          <div className={styles.summaryRow}>
            <p className={styles.summary}>
              {t('memoryManageSummary', {
                sessions: withMemory.length,
                manual: totals.manual,
                summary: totals.summary,
                rounds: totals.folded,
              })}
              {rows.length !== withMemory.length ? (
                <button
                  type="button"
                  className={styles.summaryToggle}
                  aria-pressed={showAll}
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll
                    ? t('memoryManageOnlyWithMemory', { count: withMemory.length })
                    : t('memoryManageShowAll', { count: rows.length })}
                </button>
              ) : null}
            </p>
            <button type="button" className={styles.addEntry} onClick={() => setPicking(true)}>
              ＋ {t('memoryAddEntry')}
            </button>
          </div>
          <div className={styles.filters} role="group">
            {(['all', 'manual', 'summary'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                className={kind === value ? `${styles.filter} ${styles.filterActive}` : styles.filter}
                onClick={() => setKind(value)}
              >
                {t(value === 'all' ? 'memoryFilterAll' : value === 'manual' ? 'memoryFilterManual' : 'memoryFilterSummary')}
              </button>
            ))}
          </div>
          <input
            className={styles.search}
            value={keyword}
            placeholder={t('memoryManageSearchPlaceholder')}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </>
      ) : null}
      {scanning ? (
        <p className={styles.status}>
          {t('memoryManageScanning', { done: progress.done, total: progress.total })}
        </p>
      ) : null}
      {!scanning && withMemory.length === 0 && !showAll ? (
        <p className={styles.status}>{t('memoryManageEmpty')}</p>
      ) : null}
      {!scanning && rows.length > 0 && filtered.length === 0 ? (
        <p className={styles.status}>{t('memoryManageFilterEmpty')}</p>
      ) : null}
      <div className={styles.list}>
        {filtered.map((row) => (
          <div key={row.id} className={styles.row}>
            <button type="button" className={styles.rowMain} onClick={() => open(row.id)}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowMeta}>
                {!row.hasMemory
                  ? t('memoryManageNoMemory')
                  : row.manual + row.summary > 0
                    ? t('memoryManageCount', { manual: row.manual, summary: row.summary })
                    : row.attachments > 0
                      ? t('memoryManageOnlyAttachments', { count: row.attachments })
                      : row.foldedRounds > 0
                        ? t('memoryManageNoNotes')
                        : t('memoryManageEmptyMemory')}
                {row.foldedRounds > 0
                  ? ` · ${t('memoryManageFolded', { rounds: row.foldedRounds })}`
                  : ''}
                {row.chars > 0 ? ` · ${t('memoryManageChars', { chars: row.chars })}` : ''}
              </span>
            </button>
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => {
                void openNotes(row.id)
              }}
            >
              {row.hasMemory ? t('memoryManageNotesEntry') : t('memoryManageAddNote')}
            </button>
          </div>
        ))}
      </div>

      {picking ? (
        <Modal
          title={t('memoryPickTitle')}
          closable
          overlayClassName={styles.overlay}
          mainClassName={styles.pickBody}
          onClose={() => setPicking(false)}
        >
          <p className={styles.lead}>{t('memoryPickLead')}</p>
          <input
            className={styles.search}
            value={pickKeyword}
            placeholder={t('memoryPickSearch')}
            onChange={(event) => setPickKeyword(event.target.value)}
          />
          <div className={styles.pickList}>
            {sessions.length === 0 ? <p className={styles.status}>{t('memoryPickEmpty')}</p> : null}
            {sessions
              .filter((item) =>
                pickKeyword.trim()
                  ? (item.title || '').toLowerCase().includes(pickKeyword.trim().toLowerCase())
                  : true
              )
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.pickRow}
                  onClick={() => {
                    void startForSession(item.id)
                  }}
                >
                  <span className={styles.rowTitle}>{item.title || t('untitledChat')}</span>
                  <span className={styles.rowMeta}>{t('memoryPickHint')}</span>
                </button>
              ))}
          </div>
        </Modal>
      ) : null}
      {dialogId ? (
        <MemoryDialog
          sessionId={dialogId}
          overlayClassName={styles.overlay}
          onClose={() => setDialogId(null)}
        />
      ) : null}
    </div>
  )
}
