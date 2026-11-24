import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { CONTEXT_LIMIT, formatCharCount, summarizeUsage } from '../../services/chat/usage.js'
import { useSettings } from '../../services/settings.js'
import styles from './UsageRing.module.css'

/**
 * 圆形进度环 + 百分比：显示当前对话的上下文占用，同时是用量面板入口。
 *
 * 一直显示（还没开口时是 0%）：窗口大小本身就是信息，也让入口位置固定，
 * 不会出现「聊了一句才冒出来」的跳动。没有会话对象时按设置里的窗口算分母。
 */
export const UsageRing = ({
  sessionId,
  onClick,
}: {
  sessionId: string | null
  onClick: () => void
}) => {
  const t = useTranslate()
  const contextWindow = useSettings((state) => state.contextWindow)
  const session = useChatStore((state) =>
    sessionId !== null && Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : undefined
  )
  const usage = summarizeUsage(session)
  const contextTokens = usage?.contextTokens ?? 0
  const contextLimit =
    usage?.contextLimit ?? (contextWindow > 0 ? contextWindow : CONTEXT_LIMIT)
  const contextPercent = usage?.contextPercent ?? 0

  // 四档：40% 起提醒、70% 起警告（此时该压缩了）
  const tone =
    contextPercent >= 70
      ? styles.danger
      : contextPercent >= 40
        ? styles.warn
        : contextPercent >= 20
          ? styles.notice
          : ''
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - contextPercent / 100)

  return (
    <button
      type="button"
      className={clsx(styles.ring, tone)}
      aria-label={t('usageTitle')}
      title={t('usageCharsHint', {
        used: formatCharCount(contextTokens),
        left: formatCharCount(Math.max(0, contextLimit - contextTokens)),
      })}
      aria-valuenow={contextPercent}
      onClick={onClick}
    >
      <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
        <circle cx={9} cy={9} r={radius} className={styles.track} />
        <circle
          cx={9}
          cy={9}
          r={radius}
          className={styles.value}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 9 9)"
        />
      </svg>
      <span className={clsx(styles.percent)}>{contextPercent}%</span>
    </button>
  )
}
