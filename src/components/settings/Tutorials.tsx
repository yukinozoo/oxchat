import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import flowUrl from '../../assets/tutorial-memory-flow.png'
import styles from './Tutorials.module.css'

/** 演示对话：一段真实写法的三轮对话，用来标出四个名词各自起作用的位置 */
const DEMO: {
  round: TranslationKey
  user: TranslationKey
  ai: TranslationKey
  note: TranslationKey
}[] = [
  { round: 'tutorialDemoRound1', user: 'tutorialDemoUser1', ai: 'tutorialDemoAi1', note: 'tutorialDemoNote1' },
  { round: 'tutorialDemoRound2', user: 'tutorialDemoUser2', ai: 'tutorialDemoAi2', note: 'tutorialDemoNote2' },
  { round: 'tutorialDemoRound3', user: 'tutorialDemoUser3', ai: 'tutorialDemoAi3', note: 'tutorialDemoNote3' },
]

/**
 * 使用教程：只讲「在哪、怎么用、出问题先看什么」。
 * 备份那套 5 步流程已经在 BackupGuide 里，这里只给一句指路，不重复写一遍。
 */
/** 术语表：给第一次用 AI 聊天的人看的说法，尽量不用行话 */
const GLOSSARY: { term: TranslationKey; desc: TranslationKey }[] = [
  { term: 'termContext', desc: 'termContextDesc' },
  { term: 'termWindow', desc: 'termWindowDesc' },
  { term: 'termToken', desc: 'termTokenDesc' },
  { term: 'termSystem', desc: 'termSystemDesc' },
  { term: 'termMemory', desc: 'termMemoryDesc' },
  { term: 'termFold', desc: 'termFoldDesc' },
  { term: 'termManualCompact', desc: 'termManualCompactDesc' },
  { term: 'termAutoCompact', desc: 'termAutoCompactDesc' },
  { term: 'termCache', desc: 'termCacheDesc' },
  { term: 'termThinking', desc: 'termThinkingDesc' },
  { term: 'termSearch', desc: 'termSearchDesc' },
  { term: 'termModel', desc: 'termModelDesc' },
  { term: 'termBranch', desc: 'termBranchDesc' },
  { term: 'termBackup', desc: 'termBackupDesc' },
]

export const Tutorials = () => {
  const t = useTranslate()
  const sections: { title: string; items: string[] }[] = [
    {
      title: t('tutorialModelTitle'),
      items: [t('tutorialModel1'), t('tutorialModel2'), t('tutorialModel3')],
    },
    {
      title: t('tutorialImportTitle'),
      items: [t('tutorialImport1'), t('tutorialImport2'), t('tutorialImport3')],
    },
    {
      title: t('tutorialMemoryTitle'),
      items: [t('tutorialMemory1'), t('tutorialMemory2'), t('tutorialMemory3')],
    },
    {
      title: t('tutorialFaqTitle'),
      items: [t('tutorialFaq1'), t('tutorialFaq2'), t('tutorialFaq3'), t('tutorialFaq4')],
    },
  ]
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('tutorialLead')}</p>

      <section className={styles.section}>
        <h3 className={styles.title}>{t('tutorialFlowTitle')}</h3>
        <figure className={styles.figure}>
          <img className={styles.figureImage} src={flowUrl} alt={t('tutorialFlowCaption')} />
          <figcaption className={styles.figureCaption}>{t('tutorialFlowCaption')}</figcaption>
        </figure>
        <ul className={styles.list}>
          <li className={styles.item}>{t('tutorialFlowPoint1')}</li>
          <li className={styles.item}>{t('tutorialFlowPoint2')}</li>
          <li className={styles.item}>{t('tutorialFlowPoint3')}</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>{t('tutorialDemoTitle')}</h3>
        <p className={styles.lead}>{t('tutorialDemoLead')}</p>
        <div className={styles.demo}>
          {DEMO.map((item) => (
            <div key={item.round} className={styles.demoRound}>
              <div className={styles.demoRoundLabel}>{t(item.round)}</div>
              <div className={styles.bubbleUser}>
                <span className={styles.bubbleTag}>{t('tutorialDemoUserTag')}</span>
                <p className={styles.bubbleText}>{t(item.user)}</p>
              </div>
              <div className={styles.bubbleAi}>
                <span className={styles.bubbleTag}>{t('tutorialDemoAiTag')}</span>
                <p className={styles.bubbleText}>{t(item.ai)}</p>
              </div>
              <p className={styles.demoNote}>{t(item.note)}</p>
            </div>
          ))}
        </div>
        <p className={styles.demoAfter}>{t('tutorialDemoAfter')}</p>
      </section>
      {sections.map((section) => (
        <section key={section.title} className={styles.section}>
          <h3 className={styles.title}>{section.title}</h3>
          <ul className={styles.list}>
            {section.items.map((item) => (
              <li key={item} className={styles.item}>
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className={styles.section}>
        <h3 className={styles.title}>{t('tutorialGlossaryTitle')}</h3>
        <p className={styles.lead}>{t('tutorialGlossaryLead')}</p>
        <dl className={styles.glossary}>
          {GLOSSARY.map(({ term, desc }) => (
            <div key={term} className={styles.glossaryRow}>
              <dt className={styles.term}>{t(term)}</dt>
              <dd className={styles.explain}>{t(desc)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className={styles.note}>{t('tutorialBackupNote')}</p>
    </div>
  )
}
