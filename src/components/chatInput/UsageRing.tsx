import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { summarizeUsage } from '../../services/chat/usage.js'
import styles from './UsageRing.module.css'

/** 圆形进度环 + 百分比：显示当前对话的上下文占用，之前也作为用量面板入口 */
export const UsageRing = ({ sessionId, onClick }: { sessionId: string; onClick: () => void }) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    Object.hasOwn(state.sessionCache, sessionId) ? state.sessionCache[sessionId] : undefined
  )
  const usage = summarizeUsage(session)

  // 只要会话里有消息就显示（导入的会话没有 usage，但上下文占用照样要看）
  if (!usage || usage.contextTokens === 0) {
    return null
  }

  // 四档：40% 起提醒、70% 起警告（此时该整理了）
  const tone =
    usage.contextPercent >= 70
      ? styles.danger
      : usage.contextPercent >= 40
        ? styles.warn
        : usage.contextPercent >= 20
          ? styles.notice
          : ''
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - usage.contextPercent / 100)

  return (
    <button
      type="button"
      className={clsx(styles.ring, tone)}
      aria-label={t('usageTitle')}
      aria-valuenow={usage.contextPercent}
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
      <span className={clsx(styles.percent)}>{usage.contextPercent}%</span>
    </button>
  )
}
