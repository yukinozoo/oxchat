import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import styles from './MemoryGuidePage.module.css'

/**
 * 记忆教程页（记忆管理顶栏「教程」→ 整页）。
 * 只讲「记忆是什么、自动/手写各管什么、怎么操作」，不复述按钮位置。
 */
const SECTIONS: { title: TranslationKey; items: TranslationKey[] }[] = [
  { title: 'memoryGuideSecWhat', items: ['memoryGuideWhat1', 'memoryGuideWhat2'] },
  { title: 'memoryGuideSecAuto', items: ['memoryGuideAuto1', 'memoryGuideAuto2', 'memoryGuideAuto3'] },
  {
    title: 'memoryGuideSecManual',
    items: [
      'memoryGuideManual1',
      'memoryGuideManual2',
      'memoryGuideManual3',
      'memoryGuideManual4',
    ],
  },
  {
    title: 'memoryGuideSecOps',
    items: ['memoryGuideOps1', 'memoryGuideOps2', 'memoryGuideOps3', 'memoryGuideOps4'],
  },
]

export const MemoryGuidePage = () => {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('memoryGuideLead')}</p>
      {SECTIONS.map((section) => (
        <section key={section.title} className={styles.section}>
          <h3 className={styles.title}>{t(section.title)}</h3>
          <ul className={styles.list}>
            {section.items.map((item) => (
              <li key={item} className={styles.item}>
                {t(item)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
