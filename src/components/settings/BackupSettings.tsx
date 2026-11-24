import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { readArchiveIndex, syncImportSessions } from '../../services/chat/backup.js'
import {
  clearGiteeLog,
  loadGiteeLog,
  pushGiteeLog,
  type GiteeLogEntry,
} from '../../services/chat/giteeLog.js'
import {
  GiteeSyncError,
  isGiteeConfigured,
  pullBackup,
  pushBackup,
} from '../../services/chat/giteeSync.js'
import {
  markGiteeSynced,
  setGiteeAutoPull,
  setGiteeAutoSync,
  setGiteeRepoConfig,
  setGiteeToken,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { nativeFileStat, nativeFilesAvailable } from '../../services/chat/nativeFiles.js'
import { setFileStore } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import styles from './BackupSettings.module.css'

/** 字节数 → 易读字符串 */
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`

const errorKey = (error: unknown) => {
  if (error instanceof GiteeSyncError) {
    switch (error.reason) {
      case 'not-configured':
        return 'backupNeedConfig'
      case 'unauthorized':
        return 'backupUnauthorized'
      case 'not-found':
        return 'backupNotFound'
      case 'rate-limited':
        return 'backupRateLimited'
      case 'empty':
        return 'backupEmpty'
      default:
        return 'backupFailed'
    }
  }
  return 'backupFailed'
}

/** 备份管理：把自己的对话同步到「自己的」Gitee 私有仓库（BYO，不经任何中转服务器） */
export const BackupSettings = () => {
  const t = useTranslate()
  const owner = useSettings((state) => state.giteeOwner)
  const repo = useSettings((state) => state.giteeRepo)
  const token = useSettings((state) => state.giteeToken)
  const lastSync = useSettings((state) => state.giteeLastSync)
  const autoSync = useSettings((state) => state.giteeAutoSync)
  const autoPull = useSettings((state) => state.giteeAutoPull)
  const fileStore = useSettings((state) => state.fileStore)
  /** 原生目录里附件占了多少（只在安卓壳里有值） */
  const [nativeStat, setNativeStat] = useState<{ count: number; bytes: number } | null>(null)
  const nativeFiles = nativeFilesAvailable()

  useEffect(() => {
    if (!nativeFiles) {
      return
    }
    void nativeFileStat().then(setNativeStat)
  }, [nativeFiles])
  const [ownerDraft, setOwnerDraft] = useState(owner)
  const [repoDraft, setRepoDraft] = useState(repo)
  const [tokenDraft, setTokenDraft] = useState(token)
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null)
  const [log, setLog] = useState<GiteeLogEntry[]>(() => loadGiteeLog())
  /** 日志筛选：全部 / 只上传 / 只拉取 / 只自动备份 */
  const [logFilter, setLogFilter] = useState<'all' | GiteeLogEntry['action']>('all')
  const visibleLog = logFilter === 'all' ? log : log.filter((entry) => entry.action === logFilter)

  // 加密存储里的令牌是异步补读的：读到之后回填输入框
  useEffect(() => {
    setOwnerDraft(owner)
    setRepoDraft(repo)
    setTokenDraft(token)
  }, [owner, repo, token])

  const save = () => {
    setGiteeRepoConfig(ownerDraft, repoDraft)
    setGiteeToken(tokenDraft)
    showToast({ key: 'backupSaved' })
  }

  const ready = isGiteeConfigured({ owner, repo, token })

  const upload = async () => {
    if (!ready) {
      showToast({ key: 'backupNeedConfig' })
      return
    }
    setBusy('push')
    try {
      const result = await pushBackup()
      markGiteeSynced()
      setLog(pushGiteeLog({ action: 'upload', ok: true, detail: formatSize(result.bytes) }))
      showToast(t('backupUploaded', { size: formatSize(result.bytes) }))
    } catch (error) {
      setLog(pushGiteeLog({ action: 'upload', ok: false, detail: t(errorKey(error)) }))
      showToast({ key: errorKey(error), type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const download = async () => {
    if (!ready) {
      showToast({ key: 'backupNeedConfig' })
      return
    }
    setBusy('pull')
    try {
      const file = await pullBackup()
      const entries = await readArchiveIndex(file)
      const ids = new Set(entries.map((entry) => entry.id))
      if (ids.size === 0) {
        showToast({ key: 'backupEmpty', type: 'error' })
        return
      }
      // 同步用合并导入：同 id 会话按 updatedAt 比较，远端较新才覆盖
      const result = await syncImportSessions(file, ids)
      markGiteeSynced()
      setLog(
        pushGiteeLog({
          action: 'download',
          ok: true,
          detail: `+${result.imported} / ~${result.updated} / =${result.skipped}`,
        })
      )
      showToast(
        t('backupPulled', {
          imported: result.imported,
          updated: result.updated,
          skipped: result.skipped,
          conflicts: result.conflicts,
        })
      )
    } catch (error) {
      setLog(pushGiteeLog({ action: 'download', ok: false, detail: t(errorKey(error)) }))
      showToast({ key: errorKey(error), type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('backupGiteeDesc')}</p>
      <div className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>{t('backupOwner')}</span>
          <input
            className={styles.input}
            value={ownerDraft}
            placeholder="yourname"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setOwnerDraft(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('backupRepo')}</span>
          <input
            className={styles.input}
            value={repoDraft}
            placeholder="oxchat-sync"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setRepoDraft(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('backupToken')}</span>
          <input
            className={styles.input}
            type="password"
            value={tokenDraft}
            placeholder={t('backupTokenPlaceholder')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setTokenDraft(event.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <Button size="m" onClick={save}>
            {t('backupSave')}
          </Button>
          <Button variant="outlined" size="m" disabled={busy !== null} onClick={() => void upload()}>
            {busy === 'push' ? t('backupUploading') : t('backupUpload')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            disabled={busy !== null}
            onClick={() => void download()}
          >
            {busy === 'pull' ? t('backupPulling') : t('backupDownload')}
          </Button>
        </div>
        <label className={styles.switchRow}>
          <span>
            <span className={styles.label}>{t('backupAuto')}</span>
            <span className={styles.hint}>{t('backupAutoDesc')}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoSync}
            aria-label={t('backupAuto')}
            className={autoSync ? `${styles.switch} ${styles.switchOn}` : styles.switch}
            onClick={() => setGiteeAutoSync(!autoSync)}
          >
            <span className={styles.knob} />
          </button>
        </label>
        <label className={styles.switchRow}>
          <span>
            <span className={styles.label}>{t('backupAutoPull')}</span>
            <span className={styles.hint}>{t('backupAutoPullDesc')}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoPull}
            aria-label={t('backupAutoPull')}
            className={autoPull ? `${styles.switch} ${styles.switchOn}` : styles.switch}
            onClick={() => setGiteeAutoPull(!autoPull)}
          >
            <span className={styles.knob} />
          </button>
        </label>
        <p className={styles.status}>
          {lastSync > 0
            ? t('backupLastSync', { time: new Date(lastSync).toLocaleString() })
            : t('backupNever')}
        </p>
      </div>
      <div className={styles.logSection}>
        <div className={styles.logHead}>
          <span className={styles.logTitle}>{t('backupLogTitle')}</span>
          {log.length > 0 ? (
            <button
              type="button"
              className={styles.logClear}
              onClick={() => {
                clearGiteeLog()
                setLog([])
              }}
            >
              {t('backupLogClear')}
            </button>
          ) : null}
        </div>
        <div className={styles.logFilters} role="radiogroup" aria-label={t('backupLogTitle')}>
            {(
              [
                ['all', 'backupLogAll'],
                ['upload', 'backupLogUpload'],
                ['download', 'backupLogDownload'],
                ['auto', 'backupLogAuto'],
              ] as const
            ).map(([value, key]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={logFilter === value}
                disabled={log.length === 0}
                className={logFilter === value ? styles.logFilterActive : styles.logFilter}
                onClick={() => setLogFilter(value)}
              >
                {t(key)}
              </button>
            ))}
        </div>
        {log.length === 0 ? (
          <p className={styles.status}>{t('backupLogEmpty')}</p>
        ) : visibleLog.length === 0 ? (
          <p className={styles.status}>{t('backupLogFilterEmpty')}</p>
        ) : (
          <ul className={styles.logList}>
            {visibleLog.map((entry) => (
              <li key={`${entry.at}-${entry.action}`} className={styles.logItem}>
                <span className={entry.ok ? styles.logOk : styles.logFail}>
                  {t(
                    entry.action === 'upload'
                      ? 'backupLogUpload'
                      : entry.action === 'download'
                        ? 'backupLogDownload'
                        : 'backupLogAuto'
                  )}
                </span>
                <span className={styles.logTime}>
                  {new Date(entry.at).toLocaleString()}
                </span>
                <span className={styles.logDetail}>
                  {entry.detail ?? (entry.ok ? t('backupLogOk') : t('backupLogFail'))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.logSection}>
        <div className={styles.logHead}>
          <span className={styles.logTitle}>{t('fileStoreTitle')}</span>
        </div>
        {nativeFiles ? (
          <>
            <p className={styles.status}>
              {t('fileStoreUsage', {
                count: nativeStat?.count ?? 0,
                size: formatSize(nativeStat?.bytes ?? 0),
              })}
            </p>
            <div className={styles.logFilters}>
              {(
                [
                  ['native', 'fileStoreNative'],
                  ['idb', 'fileStoreIdb'],
                ] as const
              ).map(([value, key]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={fileStore === value}
                  className={fileStore === value ? styles.logFilterActive : styles.logFilter}
                  onClick={() => setFileStore(value)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
            <p className={styles.status}>{t('fileStoreHint')}</p>
          </>
        ) : (
          <p className={styles.status}>{t('fileStoreWebOnly')}</p>
        )}
      </div>
      <p className={styles.risk}>{t('backupTokenRisk')}</p>
    </div>
  )
}
