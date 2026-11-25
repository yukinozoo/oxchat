import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { translate, useTranslate } from '../../i18n/index.js'
import {
  importSelectedSessions,
  readArchiveIndex,
  requestImportCancel,
  type ArchiveIndexItem,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { BackupError } from '../../services/chat/history/errors.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './WebsiteImport.module.css'

type Stage = 'loading' | 'list' | 'importing'

/**
 * 把 `Invalid or unsupported history archive (stage)` 翻成人话。
 * 真机上用户看到纯英文只会以为是 App 坏了，其实大多是「文件没传完整」。
 */
const describeArchiveError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  if (!text.startsWith('Invalid or unsupported history archive')) {
    return text
  }
  if (/empty|too-small|eocd/.test(text)) {
    return `${text} · ${translate('archiveBrokenTruncated')}`
  }
  if (/method|flags|zip64|entry/.test(text)) {
    return `${text} · ${translate('archiveBrokenUnsupported')}`
  }
  return `${text} · ${translate('archiveBrokenGeneric')}`
}

/** ISO 时间 → 2026-11-15；解析不了就原样截前 10 位 */
const dateOf = (iso: string): string => {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 10)
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 本地备份包导入：先解析压缩包里的对话索引，由用户勾选要导入的对话，
 * 只提取选中的会话写入本地；已存在的会话默认不勾选。
 *
 * 列表按参考稿排布：搜索（标题或日期）→ 全选/全不选 + 总数 → 卡片列表
 * （每条带「N 条消息 · 日期」）→ 底部左侧已选计数与两个省空间开关、右侧按钮。
 */
export const ArchiveImportDialog = ({
  file,
  onClose,
  onDone,
}: {
  file: File
  onClose: () => void
  onDone?: (result: { imported: number; skipped: number }) => void
}) => {
  const t = useTranslate()
  const localIds = useChatStore((state) => state.sessions.map((session) => session.id).join(','))
  const [stage, setStage] = useState<Stage>('loading')
  const [sessions, setSessions] = useState<ArchiveIndexItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  /** 只看还没导入过的（已存在的默认跳过） */
  const [onlyNew, setOnlyNew] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 默认跳过图片附件：几百兆的整包里图片通常占绝大部分 */
  const [skipFiles, setSkipFiles] = useState(true)
  /** 默认开启：失效的图片引用直接清理并补占位，避免整条会话失败 */
  const [cleanMissing, setCleanMissing] = useState(true)

  const localIdOf = (id: string) => `website-${id}`
  const existing = new Set(localIds ? localIds.split(',') : [])
  const isExisting = (id: string) => existing.has(id) || existing.has(localIdOf(id))

  useEffect(() => {
    void (async () => {
      try {
        const index = await readArchiveIndex(file)
        setSessions(
          index.map((entry) => ({ ...entry, title: entry.title || t('untitledChat') }))
        )
        setSelected(new Set(index.filter((entry) => !isExisting(entry.id)).map((entry) => entry.id)))
        setStage('list')
      } catch (e) {
        setError(describeArchiveError(e))
        setStage('list')
      }
    })()
    // 同一个文件只解析一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const haystack = (item: ArchiveIndexItem) =>
    `${item.title} ${dateOf(item.updatedAt)}`.toLowerCase()
  const filtered = sessions.filter((item) => {
    if (onlyNew && isExisting(item.id)) {
      return false
    }
    const text = keyword.trim().toLowerCase()
    return !text || haystack(item).includes(text)
  })
  const MAX_RENDER = 300
  const visible = filtered.slice(0, MAX_RENDER)
  /** 全选以筛选结果为准：列表只渲染前 300 条，但全选要覆盖全部匹配项 */
  const allChecked = filtered.length > 0 && filtered.every((item) => selected.has(item.id))
  /** 底部「已选 x / N」按整包算 */
  const total = sessions.length
  const addable = sessions.filter((item) => !isExisting(item.id)).length

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (allChecked) {
        for (const item of filtered) {
          next.delete(item.id)
        }
      } else {
        for (const item of filtered) {
          next.add(item.id)
        }
      }
      return next
    })
  }

  const runImport = async () => {
    if (selected.size === 0) {
      return
    }
    setStage('importing')
    setProgress({ done: 0, total: selected.size })
    setError(null)
    try {
      // 走与本地文件导入同一条流式链路：暂存区写入、100ms 节流进度、可取消
      const result = await importSelectedSessions(file, selected, {
        onProgress: (done, count) => setProgress({ done, total: count }),
        skipFiles,
        cleanMissing,
      })
      showToast(
        result.imported > 0
          ? { key: 'historyImported', params: { count: result.imported } }
          : { key: 'websiteImportedNothing' }
      )
      onDone?.({ imported: result.imported, skipped: result.skipped })
      onClose()
    } catch (e) {
      setStage('list')
      // 用户主动停止：保留列表与勾选，允许重新导入
      if (e instanceof BackupError && e.key === 'historyImportCancelled') {
        setError(null)
        showToast({ key: 'historyImportCancelled' })
      } else {
        setError(describeArchiveError(e))
      }
    } finally {
      setProgress(null)
    }
  }

  return (
    <Modal
      title={t('archiveImportTitle')}
      className={clsx(styles.dialog, styles.dialogFill)}
      overlayClassName={styles.overlay}
      mainClassName={clsx(styles.body, styles.bodyFill)}
      closable
      // 导入改到后台：关掉对话框不中断任务，顶部进度条继续显示，可随时取消
      onClose={onClose}
      footer={
        <div className={styles.footerGrid}>
          <div className={styles.footerInfo}>
            <label className={styles.inlineCheck}>
              <input
                type="checkbox"
                checked={skipFiles}
                disabled={stage === 'importing'}
                onChange={() => setSkipFiles((value) => !value)}
              />
              <span>{t('importSkipFilesShort')}</span>
            </label>
            <label className={styles.inlineCheck}>
              <input
                type="checkbox"
                checked={cleanMissing}
                disabled={stage === 'importing'}
                onChange={() => setCleanMissing((value) => !value)}
              />
              <span>{t('importCleanMissingShort')}</span>
            </label>
          </div>
          <div className={styles.footerButtons}>
            <Button variant="outlined" size="m" onClick={onClose}>
              {t('cancel')}
            </Button>
            {stage === 'importing' ? (
              <Button variant="dangerOutlined" size="m" onClick={requestImportCancel}>
                {progress ? t('historyImportCount', progress) : t('historyImportStop')}
              </Button>
            ) : (
              <Button
                size="m"
                disabled={stage !== 'list' || selected.size === 0}
                onClick={() => void runImport()}
              >
                {t('archiveImportSelectedCount', { count: selected.size })}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <p className={styles.lead}>{t('archiveImportLead')}</p>
      {stage === 'loading' ? <div className={styles.spinner}>{t('archiveParsing')}</div> : null}
      {stage !== 'loading' ? (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.search}
              value={keyword}
              placeholder={t('archiveSearchPlaceholder')}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <label className={styles.inlineCheck}>
              <input
                type="checkbox"
                checked={onlyNew}
                onChange={() => setOnlyNew((value) => !value)}
              />
              <span>{t('archiveOnlyNew')}</span>
            </label>
          </div>
          <div className={styles.bulkRow}>
            <button type="button" className={styles.checkAll} onClick={toggleAll}>
              {allChecked ? t('unselectAll') : t('selectAll')}
            </button>
            <span className={styles.countBox}>
              <span className={styles.totalCount}>{t('archiveCountTotal', { count: total })}</span>
              <span className={styles.addableCount}>
                {t('archiveAddableShort', { addable })}
              </span>
            </span>
          </div>
          <div className={styles.listCard}>
            {visible.map((item) => {
              const done = isExisting(item.id)
              return (
                <label
                  key={item.id}
                  className={done ? `${styles.listItem} ${styles.listItemDone}` : styles.listItem}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={stage === 'importing'}
                    onChange={() => toggle(item.id)}
                  />
                  <span className={styles.listMain}>
                    <span className={styles.listTitle}>{item.title}</span>
                    <span className={styles.listMeta}>
                      {t('archiveItemMeta', {
                        count: item.messageCount,
                        date: dateOf(item.updatedAt),
                      })}
                    </span>
                  </span>
                  {done ? <span className={styles.badge}>{t('websiteExisting')}</span> : null}
                </label>
              )
            })}
            {filtered.length > visible.length ? (
              <div className={styles.empty}>
                {t('websiteTooMany', { shown: visible.length, total: filtered.length })}
              </div>
            ) : null}
            {visible.length === 0 ? (
              <div className={styles.empty}>
                {keyword.trim() || onlyNew ? t('websiteEmpty') : t('archiveEmpty')}
              </div>
            ) : null}
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
        </>
      ) : null}
    </Modal>
  )
}
