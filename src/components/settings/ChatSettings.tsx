import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Select } from '../base/Select.js'
import {
  CONTEXT_WINDOWS,
  formatContextWindow,
  setCompactBackup,
  setCompactKeepRounds,
  setCompactThreshold,
  setContextWindow,
  setTemperature,
  useSettings,
} from '../../services/settings.js'
import styles from './ChatSettings.module.css'

/** 触发阈值与保留比例的可用区间：保留段必须比阈值更小，否则压缩没有意义 */
const THRESHOLD_MIN = 20
const THRESHOLD_MAX = 90

const percentText = (value: number) => `${Math.round(value)}%`

/**
 * 对话设置：上下文窗口、自动压缩（含触发阈值与保留比例）、温度。
 * 原来的「全局提示词」已移除 —— system 由角色卡（设置 → 用户 → 角色管理）负责。
 * 设置即时保存并立即作用于下一次请求。
 */
export const ChatSettings = () => {
  const t = useTranslate()
  const contextWindow = useSettings((state) => state.contextWindow)
  const compactThreshold = useSettings((state) => state.compactThreshold)
  const compactBackup = useSettings((state) => state.compactBackup)
  const compactKeepRounds = useSettings((state) => state.compactKeepRounds)
  const temperature = useSettings((state) => state.temperature)

  const windowOptions = CONTEXT_WINDOWS.map((value) => ({
    value: String(value),
    label: value === 0 ? t('chatWindowUnlimited') : formatContextWindow(value),
  }))
  const switchOptions = [
    { value: 'on', label: t('chatOn') },
    { value: 'off', label: t('chatOff') },
  ]
  /** 窗口选「不限」时没有阈值可言，下面两项一起禁用 */
  const compactDisabled = contextWindow === 0

  const changeThreshold = (value: number) => {
    setCompactThreshold(value)
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
        <div className={styles.note}>{t('chatCompactPerSessionNote')}</div>
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
        <SettingRow
          label={t('compactBackup')}
          desc={t('compactBackupDesc')}
          action={
            <Select
              value={compactBackup ? 'on' : 'off'}
              options={switchOptions}
              ariaLabel={t('compactBackup')}
              onChange={(value) => setCompactBackup(value === 'on')}
            />
          }
        />
        <RangeRow
          label={t('chatCompactKeep')}
          valueText={t('chatCompactKeepRoundsValue', { rounds: compactKeepRounds })}
          min={1}
          max={20}
          step={1}
          value={compactKeepRounds}
          disabled={compactDisabled}
          onChange={setCompactKeepRounds}
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
