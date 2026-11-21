import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { formatBalance, loadBalance, useAccount } from '../../services/account.js'
import { useChatStore } from '../../services/chat/store.js'
import { summarizeUsage, formatTokens } from '../../services/chat/usage.js'
import { canCompact } from '../../services/chat/compact.js'
import { compactSession } from '../../services/chat/store.js'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { MemoryDialog } from './MemoryDialog.js'
import { CompactDialog } from './CompactDialog.js'
import { formatMoney } from '../../services/chat/pricing.js'
import { useSettings } from '../../services/settings.js'
import { useEffect, useState } from 'react'
import styles from './composerSheet.module.css'

/** 用量面板：上下文估算、本对话累计、账户余额 */
export const UsageSheet = ({ sessionId, onClose }: { sessionId: string; onClose: () => void }) => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const balance = useAccount((state) => state.balance)
  const session = useChatStore((state) =>
    Object.hasOwn(state.sessionCache, sessionId) ? state.sessionCache[sessionId] : undefined
  )
  const usage = summarizeUsage(session)
  const balanceLabel = formatBalance(balance)
  const [compacting, setCompacting] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [compactOpen, setCompactOpen] = useState(false)
  useAndroidBackHandler(Boolean(usage), onClose)

  useEffect(() => {
    if (apiKey) {
      void loadBalance(apiKey)
    }
  }, [apiKey])

  if (!usage) {
    return null
  }

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

        <div className={styles.groupTitle}>{t('usageContext')}</div>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.label}>{t('usageEstimatedNext')}</span>
            <span className={styles.muted}>
              {formatTokens(usage.contextTokens)} / {formatTokens(usage.contextLimit)}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.big}>{usage.contextPercent}%</span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${usage.contextPercent}%` }} />
          </div>
          <div className={styles.note}>{t('usageContextNote')}</div>
          <div className={styles.row} style={{ marginTop: 10, gap: 10 }}>
            <span className={styles.muted}>{t('usageCompactHint')}</span>
            <Button variant="outlined" size="s" onClick={() => setMemoryOpen(true)}>
              {t('memoryEntry')}
            </Button>
            <Button
              variant="outlined"
              size="s"
              disabled={compacting || !session || !canCompact(session)}
              onClick={async () => {
                if (!session) {
                  return
                }
                setCompacting(true)
                const controller = new AbortController()
                const result = await compactSession(sessionId, controller.signal)
                setCompacting(false)
                if (result.status === 'confirm') {
                  // 历史太长：交给整理弹窗去说明分段开销并二次确认
                  setCompactOpen(true)
                  return
                }
                if (result.status === 'done') {
                  showToast({ key: 'compactDone', params: { count: result.messages } })
                  onClose()
                } else if (result.status === 'short') {
                  showToast({ key: 'compactShort' })
                } else if (result.status === 'error') {
                  showToast(t('compactFailed', { message: result.message }))
                }
              }}
            >
              {compacting ? t('compactRunning') : t('usageCompactNow')}
            </Button>
          </div>
        </div>

        {memoryOpen ? (
          <MemoryDialog sessionId={sessionId} onClose={() => setMemoryOpen(false)} />
        ) : null}
        {compactOpen ? (
          <CompactDialog sessionId={sessionId} onClose={() => setCompactOpen(false)} />
        ) : null}
        <div className={styles.groupTitle}>{t('usageSession')}</div>
        <div className={styles.card}>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatTokens(usage.input)}</span>
              <span className={styles.statLabel}>{t('usageInput')}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatTokens(usage.output)}</span>
              <span className={styles.statLabel}>{t('usageOutput')}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{usage.cacheHitRate}%</span>
              <span className={styles.statLabel}>{t('usageCacheHit')}</span>
            </div>
          </div>
          <div className={styles.row} style={{ marginTop: 12 }}>
            <span className={styles.label}>{t('usageCost')}</span>
            <span className={styles.big}>
              {usage.cost === null ? '—' : formatMoney(usage.cost)}
            </span>
          </div>
          <div className={styles.note}>
            {t('usageCostNote', { period: t(usage.peak ? 'usagePeak' : 'usageOffPeak') })}
          </div>
          <div className={styles.note}>{t('usageRounds', { count: usage.rounds })}</div>
        </div>

        <div className={styles.groupTitle}>{t('usageBalance')}</div>
        <div className={styles.card}>
          <div className={styles.balanceRow}>
            <span className={styles.balanceAmount}>{balanceLabel ?? '—'}</span>
            <a
              className={styles.link}
              href="https://platform.deepseek.com/top_up"
              target="_blank"
              rel="noreferrer"
            >
              {t('usageTopUp')}
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
