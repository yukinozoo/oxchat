import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  importSelectedSessions,
  readArchiveIndex,
  requestImportCancel,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { BackupError } from '../../services/chat/history/errors.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './WebsiteImport.module.css'

type Stage = 'loading' | 'list' | 'importing'

/**
 * 本地备份包导入：先解析压缩包里的对话索引，由用户勾选要导入的对话，
 * 只提取选中的会话写入本地；已存在的会话默认不勾选。
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
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 默认跳过图片附件：几百兆的整包里图片通常占绝大部分 */
  const [skipFiles, setSkipFiles] = useState(true)
  /** 默认开启：失效的图片引用直接清理并补占位，避免整条会话失败 */
  const [cleanMissing, setCleanMissing] = useState(true)

  const localIdOf = (id: string) => `website-${id}`
  const existing = new Set(localIds ? localIds.split(',') : [])
  /** 本地是否已有该会话：备份包里的会话 id 与本地一致时视为已存在 */
  const isExisting = (id: string) => existing.has(id) || existing.has(localIdOf(id))

  useEffect(() => {
    void (async () => {
      try {
        const index = await readArchiveIndex(file)
        setSessions(index.map((entry) => ({ id: entry.id, title: entry.title || '未命名对话' })))
        setSelected(new Set(index.filter((entry) => !isExisting(entry.id)).map((entry) => entry.id)))
        setStage('list')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStage('list')
      }
    })()
    // 同一个文件只解析一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const filtered = sessions.filter(
    (item) => !keyword.trim() || item.title.toLowerCase().includes(keyword.trim().toLowerCase())
  )
  const MAX_RENDER = 300
  const visible = filtered.slice(0, MAX_RENDER)
  /** 全选以筛选结果为准：列表只渲染前 300 条，但全选要覆盖全部匹配项 */
  const allChecked = filtered.length > 0 && filtered.every((item) => selected.has(item.id))

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

  const runImport = async (preset?: Set<string>) => {
    const ids = preset ?? selected
    if (ids.size === 0) {
      return
    }
    setStage('importing')
    setProgress({ done: 0, total: ids.size })
    setError(null)
    try {
      // 走与本地文件导入同一条流式链路：暂存区写入、100ms 节流进度、可取消
      const result = await importSelectedSessions(file, ids, {
        onProgress: (done, total) => setProgress({ done, total }),
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
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setProgress(null)
    }
  }

  const addable = sessions.filter((item) => !isExisting(item.id)).length

  return (
    <Modal
      title={t('archiveImportTitle')}
      className={styles.dialog}
      overlayClassName={styles.overlay}
      mainClassName={styles.body}
      closable
      onClose={stage === 'importing' ? () => undefined : onClose}
      footer={
        <div className={styles.actions}>
          <Button variant="outlined" size="m" disabled={stage === 'importing'} onClick={onClose}>
            {t('websiteLater')}
          </Button>
          {stage === 'importing' ? (
            <>
              <Button size="m" disabled>
                {progress ? t('historyImportCount', progress) : t('historyImport')}
              </Button>
              <Button variant="dangerOutlined" size="m" onClick={requestImportCancel}>
                {t('historyImportStop')}
              </Button>
            </>
          ) : (
            <Button size="m" disabled={stage !== 'list' || selected.size === 0} onClick={() => void runImport()}>
              {t('websiteImportAll', { count: selected.size })}
            </Button>
          )}
        </div>
      }
    >
      <p className={styles.lead}>{t('archiveImportLead')}</p>
      {stage === 'loading' ? <div className={styles.spinner}>{t('archiveParsing')}</div> : null}
      {stage !== 'loading' ? (
        <>
          <p className={styles.count}>
            {t('archiveCount', { total: sessions.length, addable })}
          </p>
          <div className={styles.row}>
            <button type="button" className={styles.checkAll} onClick={toggleAll}>
              {allChecked ? t('unselectAll') : t('selectAll')}
            </button>
            <button
              type="button"
              className={styles.checkAll}
              disabled={stage === 'importing' || sessions.length === 0}
              onClick={() => {
                const all = new Set(sessions.map((item) => item.id))
                setSelected(all)
                void runImport(all)
              }}
            >
              {t('importAllLabel', { count: sessions.length })}
            </button>
            <input
              className={styles.search}
              value={keyword}
              placeholder={t('websiteSearch')}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <div className={styles.list}>
            {visible.map((item) => {
              const done = isExisting(item.id)
              return (
                <label key={item.id} className={done ? `${styles.item} ${styles.itemDone}` : styles.item}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={stage === 'importing'}
                    onChange={() => toggle(item.id)}
                  />
                  <span className={styles.itemTitle}>{item.title}</span>
                  {done ? <span className={styles.badge}>{t('websiteExisting')}</span> : null}
                </label>
              )
            })}
            {filtered.length > visible.length ? (
              <div className={styles.empty}>
                {t('websiteTooMany', { shown: visible.length, total: filtered.length })}
              </div>
            ) : null}
            {visible.length === 0 ? <div className={styles.empty}>{t('websiteEmpty')}</div> : null}
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
          <label className={styles.skip}>
            <input
              type="checkbox"
              className={styles.skipCheck}
              checked={skipFiles}
              disabled={stage === 'importing'}
              onChange={() => setSkipFiles((value) => !value)}
            />
            <span className={styles.skipText}>
              <span className={styles.skipTitle}>{t('importSkipFiles')}</span>
              <span className={styles.skipDesc}>{t('importSkipFilesDesc')}</span>
            </span>
          </label>
          <label className={styles.skip}>
            <input
              type="checkbox"
              className={styles.skipCheck}
              checked={cleanMissing}
              disabled={stage === 'importing'}
              onChange={() => setCleanMissing((value) => !value)}
            />
            <span className={styles.skipText}>
              <span className={styles.skipTitle}>{t('importCleanMissing')}</span>
              <span className={styles.skipDesc}>{t('importCleanMissingDesc')}</span>
            </span>
          </label>
        </>
      ) : null}
    </Modal>
  )
}
