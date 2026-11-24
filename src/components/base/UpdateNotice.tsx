import { useTranslate } from '../../i18n/index.js'
import { useWebUpdate } from '../../services/webUpdate.js'
import { IconCloseOutline16 } from './icons.js'
import { IconButton } from './IconButton.js'
import styles from './UpdateNotice.module.css'

/**
 * 网页版的「有新版本」提示条：贴在顶部（让开安全区），点「刷新」才真正重载。
 * 原生壳里不会出现（那条链路走 AppUpdate 弹窗）。
 */
export const UpdateNotice = () => {
  const t = useTranslate()
  const notice = useWebUpdate((state) => state.notice)
  const reload = useWebUpdate((state) => state.reload)
  const dismiss = useWebUpdate((state) => state.dismiss)
  if (!notice) {
    return null
  }
  return (
    <div className={styles.bar} role="status">
      <span className={styles.text}>{t('webUpdateAvailable', { version: notice.versionName })}</span>
      <button type="button" className={styles.action} onClick={reload}>
        {t('webUpdateRefresh')}
      </button>
      <IconButton
        className={styles.close}
        tone="tertiary"
        icon={<IconCloseOutline16 />}
        aria-label={t('close')}
        onClick={dismiss}
      />
    </div>
  )
}
