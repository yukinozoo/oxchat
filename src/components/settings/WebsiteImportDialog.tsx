import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { importSessions, readArchiveIndex, readArchiveSessions } from '../../services/chat/backup.js'
import { fromBase64 } from '../../utils/base64.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  cancelWebsiteImport,
  downloadExportArchive,
  fetchExportLink,
  triggerExportAll,
  isWebsiteLoggedIn,
  loginWebsite,
  resetWebsiteCancel,
  type WebsiteSession,
} from '../../services/chat/websiteImport.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './WebsiteImport.module.css'

type Stage = 'login' | 'loading' | 'list' | 'importing'

/**
 * 从 DeepSeek 官网导入：App 内嵌登录后读取官网对话列表，
 * 勾选需要的对话导入本地；已存在的会话自动跳过，本地续聊内容保留。
 */
export const WebsiteImportDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const localIds = useChatStore((state) => state.sessions.map((session) => session.id).join(','))
  const [stage, setStage] = useState<Stage>('loading')
  const [sessions, setSessions] = useState<WebsiteSession[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  /** 已下载的整包：选择导入时从这里按 id 取会话 */
  const [archive, setArchive] = useState<File | null>(null)

  const existing = useMemo(() => new Set(localIds ? localIds.split(',') : []), [localIds])
  const localIdOf = (id: string) => `website-${id}`
  const isExisting = (id: string) => existing.has(localIdOf(id))

  /** 把下载到应用缓存的整包读成 File，供解析索引与提取会话 */
  const readArchiveFile = async (path: string): Promise<File> => {
    const filesystem = (
      window as {
        Capacitor?: {
          Plugins?: {
            Filesystem?: {
              readFile: (o: { path: string; directory: string }) => Promise<{ data: string }>
            }
          }
        }
      }
    ).Capacitor?.Plugins?.Filesystem
    if (!filesystem) {
      throw new Error(t('websiteNoFilesystem'))
    }
    const name = path.split('/').pop() ?? 'website-export.zip'
    const { data } = await filesystem.readFile({ path: name, directory: 'CACHE' })
    const bytes = fromBase64(data)
    return new File([bytes as unknown as BlobPart], 'website-export.zip', {
      type: 'application/zip',
    })
  }

  /** 登录后自动调用官方导出接口，拿到下载链接再解析对话列表 */
  const loadList = async () => {
    setStage('loading')
    setError(null)
    try {
      // 1. 触发导出（服务端异步生成）
      await triggerExportAll()
      // 2. 轮询状态，最多等 60 秒
      let link: string | null = null
      for (let attempt = 0; attempt < 20 && !link; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        try {
          link = await fetchExportLink()
        } catch {
          // 导出未就绪时接口可能报错，继续等
        }
      }
      if (!link) {
        throw new Error(t('websiteExportTimeout'))
      }
      // 3. 下载整包并解析索引
      const { path } = await downloadExportArchive(link)
      const file = await readArchiveFile(path)
      setArchive(file)
      const index = await readArchiveIndex(file)
      const list: WebsiteSession[] = index.map((entry) => ({
        id: entry.id,
        title: entry.title || '未命名对话',
        updatedAt: 0,
      }))
      setSessions(list)
      setSelected(new Set(list.filter((item) => !existing.has(localIdOf(item.id))).map((item) => item.id)))
      setStage('list')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('login')
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        if (await isWebsiteLoggedIn()) {
          await loadList()
          return
        }
      } catch {
        // 未登录或插件不可用
      }
      setStage('login')
    })()
    // 只在首次打开时判断登录态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = async () => {
    setError(null)
    setStage('loading')
    try {
      await loginWebsite()
      await loadList()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // 用户主动取消登录时安静回到登录页
      setError(/cancel|取消/i.test(message) ? null : message)
      setStage('login')
    }
  }

  const MAX_RENDER = 300
  const filtered = sessions.filter(
    (item) => !keyword.trim() || item.title.toLowerCase().includes(keyword.trim().toLowerCase())
  )
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
    const ids0 = preset ?? selected
    const targets = sessions.filter((item) => ids0.has(item.id))
    if (targets.length === 0 || !archive) {
      return
    }
    setStage('importing')
    setError(null)
    setProgress({ done: 0, total: targets.length })
    resetWebsiteCancel()
    try {
      const ids = new Set(targets.map((item) => item.id))
      const converted = await readArchiveSessions(archive, ids, (done, total) =>
        setProgress({ done, total })
      )
      const count = await importSessions(converted)
      showToast(
        count > 0
          ? { key: 'websiteImported', params: { count } }
          : { key: 'websiteImportedNothing' }
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('list')
    } finally {
      setProgress(null)
    }
  }

  const addable = sessions.filter((item) => !isExisting(item.id)).length
  const selectedCount = sessions.filter((item) => selected.has(item.id)).length

  return (
    <Modal
      title={t('websiteImportTitle')}
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
            <Button variant="dangerOutlined" size="m" onClick={cancelWebsiteImport}>
              {t('historyImportStop')}
            </Button>
          ) : stage === 'login' ? (
            <Button size="m" onClick={() => void signIn()}>
              {t('websiteLogin')}
            </Button>
          ) : (
            <Button
              size="m"
              disabled={stage !== 'list' || selectedCount === 0}
              onClick={() => void runImport()}
            >
              {t('websiteImportAll', { count: selectedCount })}
            </Button>
          )}
        </div>
      }
    >
      <p className={styles.lead}>{t('websiteImportLead')}</p>

      {stage === 'login' || stage === 'loading' ? (
        <div className={styles.loginBox}>
          {stage === 'loading' ? (
            <div className={styles.spinner}>{t('websiteConnecting')}</div>
          ) : (
            <div className={styles.hint}>{t('websiteLoginHint')}</div>
          )}
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>
      ) : null}

      {stage === 'list' || stage === 'importing' ? (
        <>
          <p className={styles.count}>
            {stage === 'importing' && progress
              ? t('historyImportCount', progress)
              : t('websiteCount', {
                  total: sessions.length,
                  addable,
                  existing: sessions.length - addable,
                })}
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
                <label
                  key={item.id}
                  className={clsx(styles.item, done && styles.itemDone)}
                  aria-disabled={done}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={done || stage === 'importing'}
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
            {visible.length === 0 ? (
              <div className={styles.empty}>{t('websiteEmpty')}</div>
            ) : null}
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}

        </>
      ) : null}
    </Modal>
  )
}
