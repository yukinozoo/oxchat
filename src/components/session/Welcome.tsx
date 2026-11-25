import { useIsMobile } from '../../app/viewport.js'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { characterById, defaultCharacterId } from '../../services/chat/characters.js'
import { useHasUsableChannel } from '../../services/channels.js'
import { readGreetingDraft, writeGreetingDraft } from '../../services/chat/greetingDraft.js'
import { useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { newChat } from '../../services/chat/store.js'
import { MobileHeader } from './MobileHeader.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { CharacterButton } from './CharacterPicker.js'
import styles from './Welcome.module.css'
import whaleUrl from '../../assets/whale-alpha.png'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const [greetingIndex, setGreetingIndex] = useState(0)
  // 新对话用哪张卡：顶栏胶囊改了默认角色后，这里的预览也跟着变
  const character = characterById(defaultCharacterId())
  const greetings = character?.greetings ?? []
  const total = greetings.length
  const active = total > 0 ? greetingIndex % total : 0
  const greetingText = total > 0 ? (greetings[active] ?? '').trim() : ''
  const isMobile = useIsMobile()
  // 未填写 API Key 时在输入框上方给出明确的登录入口
  // 有官方 Key 或有可用的自定义渠道，都算「能开聊」，不再催填 Key
  const apiKeyValue = useSettings((state) => state.apiKey)
  // 填完 Key / 建好渠道回到对话页时，这个按钮要立刻消失（hook 内部订阅了渠道变化）
  const needsApiKey = !useHasUsableChannel(apiKeyValue)
  const characterId = character?.id
  useEffect(() => {
    if (characterId) {
      setGreetingIndex(readGreetingDraft(characterId))
    }
  }, [characterId])
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
          <CharacterButton sessionId={null} />
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
        {greetingText ? (
          <div className={styles.greetingCard}>
            <div className={styles.greetingMeta}>
              <span>
                {t('welcomeGreetingLabel', { index: active + 1, total })}
              </span>
              {total > 1 ? (
                <button
                  type="button"
                  className={styles.greetingNext}
                  onClick={() => {
                    const next = (active + 1) % total
                    setGreetingIndex(next)
                    if (character) {
                      writeGreetingDraft(character.id, next)
                    }
                  }}
                >
                  {t('welcomeGreetingNext')}
                </button>
              ) : null}
            </div>
            <p className={styles.greetingText}>{greetingText}</p>
          </div>
        ) : null}
        {needsApiKey ? (
          <button
            type="button"
            className={styles.signIn}
            onClick={() => openSettings('api', { closeOnBack: true })}
          >
            {t('welcomeSignInCta')}
          </button>
        ) : null}
        <ChatInput sessionId={null} />
        {/* 首页不再显示「内容由 AI 生成」：留一个同高占位，输入框到底部的间距保持不变 */}
        {isMobile ? <div className={styles.caveatSpacer} aria-hidden /> : null}
      </div>
    </div>
  )
}
