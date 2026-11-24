import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { useChangelog } from './changelogState.js'
import styles from './Changelog.module.css'

/** 「本版更新了什么」：展示当前版本的更新条目，点按钮关闭并记住已读 */
export const ChangelogDialog = () => {
  const t = useTranslate()
  const entry = useChangelog((state) => state.entry)
  const close = useChangelog((state) => state.close)
  if (!entry) {
    return null
  }
  return (
    <Modal
      overlayClassName={styles.overlay}
      title={t('changelogTitle', { version: entry.versionName })}
      closable
      onClose={close}
      footer={
        <Button variant="primary" size="m" onClick={close}>
          {t('changelogGotIt')}
        </Button>
      }
    >
      <div className={styles.meta}>{entry.date}</div>
      <ul className={styles.list}>
        {entry.items.map((item) => (
          <li key={item} className={styles.item}>
            {item}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
