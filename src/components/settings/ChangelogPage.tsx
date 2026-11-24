import { useTranslate } from '../../i18n/index.js'
import { CHANGELOG } from '../../services/changelog.js'
import styles from './Changelog.module.css'

/**
 * 更新日志页：列出每个版本的更新条目（新版本在上）。
 * 数据在 `services/changelog.ts`，与「首次升级弹窗」共用同一份，口径不会分叉。
 */
export const ChangelogPage = () => {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('changelogPageLead')}</p>
      {CHANGELOG.map((entry) => (
        <section key={entry.versionCode} className={styles.entry}>
          <div className={styles.entryHead}>
            <span className={styles.version}>{entry.versionName}</span>
            <span className={styles.date}>{entry.date}</span>
          </div>
          <ul className={styles.list}>
            {entry.items.map((item) => (
              <li key={item} className={styles.item}>
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
