import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { setSessionAutoCompact, useChatStore } from '../../services/chat/store.js'
import {
  CONTEXT_LIMIT,
  formatCharCount,
  formatTokens,
  summarizeUsage,
} from '../../services/chat/usage.js'
import { useSettings } from '../../services/settings.js'
import {
  IconChevronRightOutline14,
  IconLayersOutline16,
  IconSparkleOutline16,
} from '../base/icons.js'
import { CompactContextDialog } from './CompactContextDialog.js'
import styles from './composerSheet.module.css'

/**
 * 用量面板：只留三块，从上往下读一遍就知道该不该压缩。
 *
 * ① 上下文信息：窗口、当前估算、占比条与「消息历史 / 剩余空间」两项明细；
 * ② 自动压缩开关：直接改全局设置（与「设置 → 对话」里的同一个键）；
 * ③ 压缩上下文：点开弹窗看会话统计、写压缩要求、真正执行压缩。
 * 累计输入输出、缓存、费用与余额都收进了第 ③ 块的弹窗，面板本身不再铺一屏数字。
 */
export const UsageSheet = ({
  sessionId,
  onClose,
}: {
  /** 还没开始对话时为 null：面板照样能开，只是没有可压缩的内容 */
  sessionId: string | null
  onClose: () => void
}) => {
  const t = useTranslate()
  /** 全局默认只作兜底：本会话设过就按会话走 */
  const globalAutoCompact = useSettings((state) => state.autoCompact)
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const contextWindow = useSettings((state) => state.contextWindow)
  const session = useChatStore((state) =>
    sessionId !== null && Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : undefined
  )
  const usage = summarizeUsage(session)
  const autoCompact = session?.autoCompact ?? globalAutoCompact
  const [statsOpen, setStatsOpen] = useState(false)
  useAndroidBackHandler(true, onClose)

  // 新对话还没有会话对象：按设置里的窗口显示 0%，压缩入口暂时不可用
  const contextTokens = usage?.contextTokens ?? 0
  const contextLimit = usage?.contextLimit ?? (contextWindow > 0 ? contextWindow : CONTEXT_LIMIT)
  const contextPercent = usage?.contextPercent ?? 0
  const compactReady = sessionId !== null && session !== undefined
  const free = Math.max(0, contextLimit - contextTokens)
  const autoCompactDesc =
    contextWindow > 0
      ? t('usageAutoCompactDesc', { percent: compactThreshold })
      : t('usageAutoCompactNoWindow')

  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grabber} />
        <div className={styles.title}>{t('usageTitle')}</div>

        {/* ① 上下文信息 */}
        <div className={styles.card}>
          <div className={styles.contextHead}>
            <span className={styles.contextTitle}>{t('usageContextWindow')}</span>
            <span className={styles.contextValue}>
              {formatTokens(contextTokens)} / {formatTokens(contextLimit)}
              <span className={styles.contextPercent}>{contextPercent}%</span>
              <span className={styles.contextEstimate}>{t('usageEstimateLabel')}</span>
            </span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${contextPercent}%` }} />
          </div>
          <div className={styles.breakRow}>
            <span className={styles.breakDot} />
            <span className={styles.breakLabel}>{t('usageBreakdownMessages')}</span>
            <span className={styles.breakValue}>{formatTokens(contextTokens)}</span>
          </div>
          <div className={styles.breakRow}>
            <span className={clsx(styles.breakDot, styles.breakDotFree)} />
            <span className={styles.breakLabel}>{t('usageBreakdownFree')}</span>
            <span className={styles.breakValue}>{formatTokens(free)}</span>
          </div>
          <div className={styles.note}>
            {t('usageCharsHint', {
              used: formatCharCount(contextTokens),
              left: formatCharCount(free),
            })}
          </div>
          <div className={styles.note}>{t('usageContextNote')}</div>
        </div>

        {/* ② 自动压缩开关 + ③ 压缩上下文入口 */}
        <div className={clsx(styles.card, styles.actionCard)}>
          <div className={styles.actionRow}>
            <span className={styles.actionIcon}>
              <IconSparkleOutline16 />
            </span>
            <span className={styles.actionMain}>
              <span className={styles.actionLabel}>{t('usageAutoCompact')}</span>
              <span className={styles.actionDesc}>{autoCompactDesc}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoCompact}
              aria-label={t('usageAutoCompact')}
              disabled={sessionId === null}
              className={clsx(
                styles.switch,
                autoCompact && styles.switchOn,
                sessionId === null && styles.switchDisabled
              )}
              onClick={() => {
                if (sessionId !== null) {
                  setSessionAutoCompact(sessionId, !autoCompact)
                }
              }}
            >
              <span className={styles.switchKnob} />
            </button>
          </div>
          <div className={styles.actionDivider} />
          <button
            type="button"
            className={clsx(
              styles.actionRow,
              styles.actionRowButton,
              !compactReady && styles.actionRowDisabled
            )}
            disabled={!compactReady}
            onClick={() => setStatsOpen(true)}
          >
            <span className={styles.actionIcon}>
              <IconLayersOutline16 />
            </span>
            <span className={styles.actionMain}>
              <span className={styles.actionLabel}>{t('usageCompactContext')}</span>
              <span className={styles.actionDesc}>{t('usageCompactHint')}</span>
            </span>
            <span className={styles.actionChevron}>
              <IconChevronRightOutline14 />
            </span>
          </button>
        </div>

        {statsOpen && sessionId !== null ? (
          <CompactContextDialog sessionId={sessionId} onClose={() => setStatsOpen(false)} />
        ) : null}
      </div>
    </div>,
    document.body
  )
}
