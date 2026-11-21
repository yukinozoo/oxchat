import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { useChatStore } from '../../services/chat/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import { useTitleJump } from './titleJump.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 标题以会话摘要为准（侧边栏同源）：重命名后顶栏立即跟着变，
  // 不依赖详情缓存是否已刷新。
  const summaryTitle = useChatStore(
    (state) => state.sessions.find((item) => item.id === session.id)?.title
  )
  const title = summaryTitle || session.title || t('untitledChat')
  const onTitleClick = useTitleJump()
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div
            className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}
            title={t('jumpToFirstHint')}
            onClick={onTitleClick}
          >
            {title}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            {/* 不再显示「内容由 AI 生成」：留同高占位，输入框到底部的间距不变 */}
            <div className={styles.caveatSpacer} aria-hidden />
          </div>
        }
      />
    </div>
  )
}
