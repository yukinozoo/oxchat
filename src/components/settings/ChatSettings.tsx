import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Select } from '../base/Select.js'
import {
  CONTEXT_WINDOWS,
  DEFAULT_GLOBAL_PROMPT,
  formatContextWindow,
  setAutoCompact,
  setCompactKeep,
  setCompactThreshold,
  setContextWindow,
  setGlobalPrompt,
  setTemperature,
  useSettings,
} from '../../services/settings.js'
import styles from './ChatSettings.module.css'

/** 触发阈值与保留比例的可用区间：保留段必须比阈值更小，否则压缩没有意义 */
const THRESHOLD_MIN = 20
const THRESHOLD_MAX = 90
const KEEP_MIN = 5
const KEEP_MAX = 50
const KEEP_GAP = 10

const percentText = (value: number) => `${Math.round(value)}%`

/**
 * 对话设置：上下文窗口、自动压缩（含触发阈值与保留比例）、温度、全局提示词。
 * 设置即时保存并立即作用于下一次请求。
 */
export const ChatSettings = () => {
  const t = useTranslate()
  const contextWindow = useSettings((state) => state.contextWindow)
  const autoCompact = useSettings((state) => state.autoCompact)
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const compactKeep = useSettings((state) => state.compactKeep)
  const temperature = useSettings((state) => state.temperature)
  const globalPrompt = useSettings((state) => state.globalPrompt)

  const windowOptions = CONTEXT_WINDOWS.map((value) => ({
    value: String(value),
    label: value === 0 ? t('chatWindowUnlimited') : formatContextWindow(value),
  }))
  const switchOptions = [
    { value: 'on', label: t('chatOn') },
    { value: 'off', label: t('chatOff') },
  ]
  const compactDisabled = contextWindow === 0 || !autoCompact

  const changeThreshold = (value: number) => {
    setCompactThreshold(value)
    if (compactKeep > value - KEEP_GAP) {
      setCompactKeep(Math.max(KEEP_MIN, value - KEEP_GAP))
    }
  }
  const changeKeep = (value: number) => {
    setCompactKeep(Math.min(value, Math.max(KEEP_MIN, compactThreshold - KEEP_GAP)))
  }

  return (
    <div className={styles.page}>
      <Section>
        <SettingRow
          label={t('chatContextWindow')}
          desc={t('chatContextWindowDesc')}
          action={
            <Select
              value={String(contextWindow)}
              options={windowOptions}
              ariaLabel={t('chatContextWindow')}
              onChange={(value) => setContextWindow(Number(value))}
            />
          }
        />
      </Section>

      <Section>
        <SettingRow
          label={t('chatAutoCompact')}
          desc={t('chatAutoCompactDesc')}
          action={
            <Select
              value={autoCompact ? 'on' : 'off'}
              options={switchOptions}
              ariaLabel={t('chatAutoCompact')}
              onChange={(value) => setAutoCompact(value === 'on')}
            />
          }
        />
        <RangeRow
          label={t('chatCompactThreshold')}
          valueText={percentText(compactThreshold)}
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          step={5}
          value={compactThreshold}
          disabled={compactDisabled}
          onChange={changeThreshold}
        />
        <RangeRow
          label={t('chatCompactKeep')}
          valueText={percentText(compactKeep)}
          min={KEEP_MIN}
          max={KEEP_MAX}
          step={5}
          value={compactKeep}
          disabled={compactDisabled}
          onChange={changeKeep}
        />
        <div className={styles.note}>
          {contextWindow === 0 ? t('chatCompactWindowOff') : t('chatCompactKeepDesc')}
        </div>
      </Section>

      <Section>
        <RangeRow
          label={t('chatTemperature')}
          valueText={temperature.toFixed(1)}
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={setTemperature}
          scale={
            <>
              <span>0.0</span>
              <span>1.0</span>
              <span>2.0</span>
            </>
          }
        />
        <div className={styles.note}>
          {t('chatTemperatureDefault')} 1.0（{t('chatTemperatureOfficial')}）·{' '}
          {t('chatTemperatureDesc')}
        </div>
      </Section>

      <Section>
        <div className={styles.setting}>
          <div className={styles.head}>
            <span className={styles.label}>{t('chatGlobalPrompt')}</span>
            <button
              type="button"
              className={styles.reset}
              disabled={globalPrompt === DEFAULT_GLOBAL_PROMPT}
              onClick={() => setGlobalPrompt(DEFAULT_GLOBAL_PROMPT)}
            >
              {t('chatGlobalPromptReset')}
            </button>
          </div>
          <textarea
            className={styles.textarea}
            aria-label={t('chatGlobalPrompt')}
            rows={5}
            value={globalPrompt}
            placeholder={DEFAULT_GLOBAL_PROMPT}
            onChange={(event) => setGlobalPrompt(event.target.value)}
          />
          <div className={styles.note}>{t('chatGlobalPromptDesc')}</div>
        </div>
      </Section>
    </div>
  )
}

/** 一张设置卡：卡片内的条目用细分割线隔开 */
const Section = ({ children }: { children: ReactNode }) => (
  <div className={styles.card}>{children}</div>
)

/** 标题 + 说明 + 右侧控件 */
const SettingRow = ({
  label,
  desc,
  action,
}: {
  label: string
  desc?: string
  action: ReactNode
}) => (
  <div className={clsx(styles.setting, styles.row)}>
    <div className={styles.text}>
      <span className={styles.label}>{label}</span>
      {desc ? <span className={styles.desc}>{desc}</span> : null}
    </div>
    {action}
  </div>
)

/** 滑杆行：标题 + 当前值 + 进度条，可按需附加刻度 */
const RangeRow = ({
  label,
  valueText,
  min,
  max,
  step,
  value,
  disabled = false,
  onChange,
  scale,
}: {
  label: string
  valueText: string
  min: number
  max: number
  step: number
  value: number
  disabled?: boolean
  onChange: (value: number) => void
  scale?: ReactNode
}) => {
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <div className={clsx(styles.setting, disabled && styles.disabled)}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{valueText}</span>
      </div>
      <input
        type="range"
        className={styles.range}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {scale ? <div className={styles.scale}>{scale}</div> : null}
    </div>
  )
}
