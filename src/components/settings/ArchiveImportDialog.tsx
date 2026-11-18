import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  importSessions,
  readArchiveIndex,
  readArchiveSessions,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
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
      const converted = await readArchiveSessions(file, ids, (done, total) =>
        setProgress({ done, total })
      )
      const count = await importSessions(converted)
      const skipped = sessions.length - count
      showToast(
        count > 0
          ? { key: 'historyImported', params: { count } }
          : { key: 'websiteImportedNothing' }
      )
      onDone?.({ imported: count, skipped: Math.max(0, skipped) })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('list')
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
      closable
      onClose={stage === 'importing' ? () => undefined : onClose}
      footer={
        <div className={styles.actions}>
          <Button variant="outlined" size="m" disabled={stage === 'importing'} onClick={onClose}>
            {t('websiteLater')}
          </Button>
          {stage === 'importing' ? (
            <Button size="m" disabled>
              {progress ? t('historyImportCount', progress) : t('historyImport')}
            </Button>
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
        </>
      ) : null}
    </Modal>
  )
}
