import { useTranslate } from '../../i18n/index.js'
import styles from './BackupSettings.module.css'

/** Gitee 同步的图文教程：从注册账号到建私有仓库、生成私人令牌 */
export const BackupGuide = () => {
  const t = useTranslate()
  const steps: { title: string; body: string; link?: { href: string; label: string } }[] = [
    {
      title: t('guideStep1Title'),
      body: t('guideStep1Body'),
      link: { href: 'https://gitee.com/signup', label: 'gitee.com/signup' },
    },
    {
      title: t('guideStep2Title'),
      body: t('guideStep2Body'),
      link: { href: 'https://gitee.com/projects/new', label: 'gitee.com/projects/new' },
    },
    {
      title: t('guideStep3Title'),
      body: t('guideStep3Body'),
      link: { href: 'https://gitee.com/profile/personal_access_tokens', label: 'gitee.com/profile/personal_access_tokens' },
    },
    {
      title: t('guideStep4Title'),
      body: t('guideStep4Body'),
    },
    {
      title: t('guideStep5Title'),
      body: t('guideStep5Body'),
    },
  ]
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('guideLead')}</p>
      <ol className={styles.guideList}>
        {steps.map((step) => (
          <li key={step.title} className={styles.guideItem}>
            <div className={styles.guideTitle}>{step.title}</div>
            <p className={styles.guideBody}>{step.body}</p>
            {step.link ? (
              <a className={styles.guideLink} href={step.link.href} target="_blank" rel="noreferrer">
                {step.link.label}
              </a>
            ) : null}
          </li>
        ))}
      </ol>
      <p className={styles.risk}>{t('guideNote')}</p>
    </div>
  )
}
