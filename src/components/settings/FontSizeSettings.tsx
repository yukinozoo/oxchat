import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  setFontSize,
  setFontSizeFollowSystem,
  useSettings,
} from '../../services/settings.js'
import styles from './Appearance.module.css'

/** 字号档位对应的显示文案：跟随系统 / 标准 / 百分比 */
export const fontSizeLabel = (scale: number, followSystem: boolean, translate: (key: 'fontSizeFollowSystem' | 'fontSizeStandard') => string): string => {
  if (followSystem) {
    return translate('fontSizeFollowSystem')
  }
  return Math.abs(scale - 1) < 0.01 ? translate('fontSizeStandard') : `${Math.round(scale * 100)}%`
}

/** 字体大小页：预览正文随滑杆实时变化，可跟随系统 */
export const FontSizeSettings = () => {
  const t = useTranslate()
  const fontSize = useSettings((state) => state.fontSize)
  const followSystem = useSettings((state) => state.fontSizeFollowSystem)
  const fill = ((fontSize - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN)) * 100
  const label = fontSizeLabel(fontSize, followSystem, t)

  return (
    <div className={clsx(styles.page, styles.fontPage)}>
      <div className={styles.preview}>
        <div className={styles.previewBubble}>{t('fontSizePreviewBubble')}</div>
        <p className={styles.previewText}>{t('fontSizeDesc1')}</p>
        <p className={styles.previewText}>{t('fontSizeDesc2')}</p>
      </div>

      <div className={styles.fontPanel}>
        <div className={styles.row}>
          <span className={styles.label}>{t('fontSizeFollowSystem')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={followSystem}
            aria-label={t('fontSizeFollowSystem')}
            className={clsx(styles.switch, followSystem && styles.switchOn)}
            onClick={() => setFontSizeFollowSystem(!followSystem)}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>

        <div className={styles.fontScaleRow}>
          <span className={clsx(styles.fontScaleMark, styles.fontScaleMarkSmall)}>A</span>
          <div className={styles.fontSlider}>
            <span className={styles.fontScaleValue}>{label}</span>
            <input
              type="range"
              className={styles.range}
              style={{ '--fill': `${fill}%` } as CSSProperties}
              aria-label={t('settingsFontSize')}
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={0.05}
              value={fontSize}
              disabled={followSystem}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
          <span className={clsx(styles.fontScaleMark, styles.fontScaleMarkLarge)}>A</span>
        </div>
      </div>
    </div>
  )
}
