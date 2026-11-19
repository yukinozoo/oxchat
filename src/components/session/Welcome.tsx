import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { newChat } from '../../services/chat/store.js'
import { MobileHeader } from './MobileHeader.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import styles from './Welcome.module.css'
import whaleUrl from '../../assets/whale-alpha.png'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 未填写 API Key 时在输入框上方给出明确的登录入口
  const needsApiKey = !useSettings((state) => state.apiKey)
  return (
    <div className={styles.container}>
      {isMobile ? (
        <MobileHeader />
      ) : (
        /* 桌面布局也可能没有可见侧栏（例如侧栏被收起），这里留住入口 */
        <div className={styles.topBar}>
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconMenuOutline20 />}
            aria-label={t('expandSiderbarButton')}
            onClick={() => setSiderCollapsed(false)}
          />
          <div className={styles.appTitle}>{t('appName')}</div>
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={() => {
              newChat()
              requestAnimationFrame(() => {
                const el = document.getElementById('chat-composer') as HTMLTextAreaElement | null
                el?.focus({ preventScroll: true })
              })
            }}
          />
        </div>
      )}
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <span
            className={styles.logo}
            aria-hidden="true"
            style={{ maskImage: `url(${whaleUrl})`, WebkitMaskImage: `url(${whaleUrl})` }}
          />
          <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        </div>
        {needsApiKey ? (
          <button
            type="button"
            className={styles.signIn}
            onClick={() => openSettings('api')}
          >
            {t('welcomeSignInCta')}
          </button>
        ) : null}
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
