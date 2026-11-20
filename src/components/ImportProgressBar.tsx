import { useTranslate } from '../i18n/index.js'
import { requestImportCancel } from '../services/chat/backup.js'
import { useImportJob } from '../services/chat/importProgress.js'
import styles from './ImportProgressBar.module.css'

/**
 * 导入进度条：贴在页面最顶部，对话框关掉也继续显示。
 * 大包（几千个会话）导入是分钟级操作，进度必须脱离弹窗存在，
 * 否则用户以为卡死了。
 */
export const ImportProgressBar = () => {
  const t = useTranslate()
  const job = useImportJob()
  if (!job.active) {
    return null
  }
  const percent = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.track}>
        <div
          className={percent === null ? `${styles.fill} ${styles.pulse}` : styles.fill}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>
          {percent === null
            ? t('importProgressCounting', { done: job.done })
            : t('importProgressLabel', { done: job.done, total: job.total })}
        </span>
        <button type="button" className={styles.stop} onClick={requestImportCancel}>
          {t('historyImportStop')}
        </button>
      </div>
    </div>
  )
}
