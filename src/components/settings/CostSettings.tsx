import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { collectCosts, type CostSummary } from '../../services/chat/costs.js'
import { formatMoney } from '../../services/chat/pricing.js'
import { formatTokens } from '../../services/chat/usage.js'
import styles from './Cost.module.css'

/** Token 构成里各段颜色 */
const TOKEN_COLORS = {
  cacheHit: 'var(--dsw-alias-brand-text)',
  cacheWrite: 'var(--dsw-static-blue-300)',
  miss: 'var(--dsw-static-amber-400)',
  output: 'var(--dsw-static-green-500)',
} as const

const share = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)

/** 费用明细：总览、近 14 天趋势、按模型拆分、Token 构成与最贵的对话 */
export const CostSettings = () => {
  const t = useTranslate()
  const [summary, setSummary] = useState<CostSummary | null>(null)

  useEffect(() => {
    let alive = true
    void collectCosts()
      .then((result) => {
        if (alive) {
          setSummary(result)
        }
      })
      .catch(() => {
        if (alive) {
          setSummary(null)
        }
      })
    return () => {
      alive = false
    }
  }, [])

  if (!summary) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.empty}>{t('costLoading')}</div>
        </div>
      </div>
    )
  }

  if (summary.rounds === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.empty}>{t('costEmpty')}</div>
        </div>
      </div>
    )
  }

  const tokenTotal =
    summary.cacheHit + summary.cacheWrite + summary.cacheMiss + summary.output || 1
  const peakShare = share(summary.peakCost, summary.total)
  const dayMax = Math.max(...summary.days.map((day) => day.cost), 0.000001)
  const modelMax = Math.max(...summary.models.map((item) => item.cost), 0.000001)
  const sessionMax = Math.max(...summary.sessions.map((item) => item.cost), 0.000001)

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.totalLabel}>{t('costTotal')}</div>
        <div className={styles.totalValue}>{formatMoney(summary.total)}</div>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <div className={styles.metricValue}>{formatMoney(summary.today)}</div>
            <div className={styles.metricLabel}>{t('costToday')}</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricValue}>{formatMoney(summary.week)}</div>
            <div className={styles.metricLabel}>{t('costWeek')}</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricValue}>{summary.rounds}</div>
            <div className={styles.metricLabel}>{t('costRounds')}</div>
          </div>
        </div>
        <div className={styles.split}>
          <span>
            {t('costPeak')} {formatMoney(summary.peakCost)} · {Math.round(peakShare)}%
          </span>
          <span>
            {t('costOffPeak')} {formatMoney(summary.offPeakCost)} ·{' '}
            {Math.round(100 - peakShare)}%
          </span>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>{t('costTrend')}</div>
        <div className={styles.chart}>
          {summary.days.map((day, index) => {
            const height = day.cost > 0 ? Math.max(4, (day.cost / dayMax) * 100) : 2
            const showLabel = index === 0 || index === summary.days.length - 1 || index % 4 === 0
            return (
              <div key={day.at} className={styles.barSlot} title={`${day.day} · ${formatMoney(day.cost)}`}>
                <div
                  className={`${styles.bar}${day.cost > 0 ? '' : ` ${styles.barEmpty}`}`}
                  style={{ height: `${height}%` }}
                />
                <div className={styles.barLabel}>{showLabel ? day.day : ''}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>{t('costByModel')}</div>
        <div className={styles.rows}>
          {summary.models.map((item) => (
            <div key={item.model}>
              <div className={styles.rowHead}>
                <span className={styles.rowName}>{item.model}</span>
                <span className={styles.rowValue}>
                  {formatMoney(item.cost)} · {t('costRoundsUnit', { count: item.rounds })}
                </span>
              </div>
              <div className={styles.track}>
                <div
                  className={styles.fill}
                  style={{ width: `${share(item.cost, modelMax)}%` } as CSSProperties}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>{t('costTokens')}</div>
        <div className={styles.stack}>
          {(
            [
              ['cacheHit', summary.cacheHit],
              ['cacheWrite', summary.cacheWrite],
              ['miss', summary.cacheMiss],
              ['output', summary.output],
            ] as const
          ).map(([key, value]) => (
            <div
              key={key}
              className={styles.stackPart}
              style={{ width: `${share(value, tokenTotal)}%`, backgroundColor: TOKEN_COLORS[key] }}
            />
          ))}
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ backgroundColor: TOKEN_COLORS.cacheHit }} />
            {t('costCacheHit')} {formatTokens(summary.cacheHit)}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ backgroundColor: TOKEN_COLORS.miss }} />
            {t('costInput')} {formatTokens(summary.cacheMiss + summary.cacheWrite)}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ backgroundColor: TOKEN_COLORS.output }} />
            {t('costOutput')} {formatTokens(summary.output)}
          </span>
        </div>
      </div>

      {summary.sessions.length > 0 ? (
        <div className={styles.card}>
          <div className={styles.cardTitle}>{t('costTopSessions')}</div>
          <div className={styles.rows}>
            {summary.sessions.map((item) => (
              <div key={item.id}>
                <div className={styles.rowHead}>
                  <span className={styles.rowName}>{item.title}</span>
                  <span className={styles.rowValue}>
                    {formatMoney(item.cost)} · {t('costRoundsUnit', { count: item.rounds })}
                  </span>
                </div>
                <div className={styles.track}>
                  <div
                    className={styles.fill}
                    style={{ width: `${share(item.cost, sessionMax)}%` } as CSSProperties}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.note}>
        {summary.unknownRounds > 0
          ? `${t('costUnknown', { count: summary.unknownRounds })} · ${t('costNote')}`
          : t('costNote')}
      </div>
    </div>
  )
}
