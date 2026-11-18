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

  // 没有任何回答（或没有 usage 数据）时不显示
  if (!usage) {
    return null
  }

  // 50% 起转琥珀色，80% 起转红色
  const tone =
    usage.contextPercent >= 80 ? styles.danger : usage.contextPercent >= 50 ? styles.warn : ''
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
