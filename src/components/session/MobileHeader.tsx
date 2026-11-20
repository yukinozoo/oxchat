import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { closeMobileSider, openMobileSider } from '../sider/mobileSiderState.js'
import { useTitleJump } from './titleJump.js'
import styles from './MobileHeader.module.css'

/** 点「新建对话」后把焦点交给输入框，首页点也能立刻开打 */
const focusComposer = () => {
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-composer') as HTMLTextAreaElement | null
    el?.focus({ preventScroll: true })
  })
}

/** 移动端顶栏：左侧菜单打开侧边栏；标题与「新建对话」按钮在会话页和首页都显示 */
export const MobileHeader = ({
  title,
  hideNewChat = false,
}: {
  title?: string
  hideNewChat?: boolean
}) => {
  const t = useTranslate()
  const onTitleClick = useTitleJump()
  const startNewChat = () => {
    newChat()
    closeMobileSider()
    focusComposer()
  }
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={() => openMobileSider()}
      />
      <div
        className={styles.title}
        title={t('jumpToFirstHint')}
        onClick={onTitleClick}
      >
        {title ?? ''}
      </div>
      {hideNewChat ? null : (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={startNewChat}
        />
      )}
    </div>
  )
}
