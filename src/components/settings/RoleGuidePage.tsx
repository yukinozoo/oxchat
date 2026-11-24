import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import styles from './RoleGuidePage.module.css'

/**
 * 角色字段说明页（角色管理顶栏右侧「教程」→ 整页）。
 *
 * 只讲「这个字段是干什么的、写了会怎样、进不进上下文」，
 * 不复述界面位置 —— 位置就在旁边的编辑页里。
 */
const SECTIONS: { title: TranslationKey; items: { name: TranslationKey; desc: TranslationKey }[] }[] = [
  {
    title: 'roleSectionBasic',
    items: [
      { name: 'roleAvatarLabel', desc: 'roleGuideAvatar' },
      { name: 'roleNameLabel', desc: 'roleGuideName' },
      { name: 'roleNicknameLabel', desc: 'roleGuideNickname' },
      { name: 'roleTagsLabel', desc: 'roleGuideTags' },
    ],
  },
  {
    title: 'roleSectionProfile',
    items: [
      { name: 'roleDescriptionLabel', desc: 'roleGuideDescription' },
      { name: 'rolePersonalityLabel', desc: 'roleGuidePersonality' },
      { name: 'roleScenarioLabel', desc: 'roleGuideScenario' },
    ],
  },
  {
    title: 'roleSectionGreeting',
    items: [{ name: 'roleGreetingLabel', desc: 'roleGuideGreetings' }],
  },
  {
    title: 'roleMoreFields',
    items: [
      { name: 'roleStyleLabel', desc: 'roleGuideStyle' },
      { name: 'roleRulesLabel', desc: 'roleGuideRules' },
      { name: 'roleMesExampleLabel', desc: 'roleGuideMesExample' },
      { name: 'roleSystemPromptLabel', desc: 'roleGuideSystemPrompt' },
      { name: 'rolePostHistoryLabel', desc: 'roleGuidePostHistory' },
    ],
  },
]

export const RoleGuidePage = () => {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('roleGuideLead')}</p>
      {SECTIONS.map((section) => (
        <section key={section.title} className={styles.section}>
          <div className={styles.sectionTitle}>{t(section.title)}</div>
          {section.items.map((item) => (
            <div key={item.name} className={styles.item}>
              <div className={styles.name}>
                {item.name === 'roleGreetingLabel' ? t('roleGuideGreetingName') : t(item.name)}
              </div>
              <p className={styles.desc}>{t(item.desc)}</p>
            </div>
          ))}
        </section>
      ))}
      <div className={styles.note}>{t('roleGuideTiming')}</div>
    </div>
  )
}
