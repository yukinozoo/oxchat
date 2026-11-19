import clsx from 'clsx'
import { useRef, useState, type PointerEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { hexToHsv, hsvToHex, normalizeHex, hsvFromPoint, type Hsv } from '../../utils/color.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './Appearance.module.css'

/** 常用色：点一下即可选中，懒人模式 */
const PALETTE = [
  '#7c5cff',
  '#5b8cff',
  '#2f6bff',
  '#0ea5e9',
  '#0f93b8',
  '#14b8a6',
  '#12a468',
  '#65a30d',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ff2d84',
  '#d946ef',
  '#8b5cf6',
  '#64748b',
  '#0f172a',
]

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** 取色盘：横向饱和度、纵向明度，支持点按与拖动 */
const SaturationValueArea = ({
  hsv,
  onChange,
  ariaLabel,
}: {
  hsv: Hsv
  onChange: (hsv: Hsv) => void
  ariaLabel: string
}) => {
  const areaRef = useRef<HTMLDivElement>(null)
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const area = areaRef.current
    if (!area) {
      return
    }
    const rect = area.getBoundingClientRect()
    onChange(hsvFromPoint(hsv.h, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height))
  }
  return (
    <div
      ref={areaRef}
      className={styles.pickerArea}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuetext={hsvToHex(hsv)}
      style={{
        backgroundImage: `linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          pick(event)
        }
      }}
    >
      <span
        className={styles.pickerKnob}
        style={{ left: `${clamp01(hsv.s) * 100}%`, top: `${(1 - clamp01(hsv.v)) * 100}%` }}
      />
    </div>
  )
}

/** 色相条：0–360 度 */
const HueBar = ({
  hue,
  onChange,
  ariaLabel,
}: {
  hue: number
  onChange: (hue: number) => void
  ariaLabel: string
}) => {
  const barRef = useRef<HTMLDivElement>(null)
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current
    if (!bar) {
      return
    }
    const rect = bar.getBoundingClientRect()
    onChange(Math.round(clamp01((event.clientX - rect.left) / rect.width) * 360) % 360)
  }
  return (
    <div
      ref={barRef}
      className={styles.hueBar}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={hue}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          pick(event)
        }
      }}
    >
      <span className={styles.hueKnob} style={{ left: `${(hue / 360) * 100}%` }} />
    </div>
  )
}

/** 自定义颜色：取色盘 + 色值输入 + 常用色 */
export const ColorPickerDialog = ({
  value,
  initial,
  onClose,
  onPick,
}: {
  /** 当前正在使用的颜色，用于标出选中项 */
  value: string
  /** 打开时默认显示的颜色 */
  initial: string
  onClose: () => void
  onPick: (color: string) => void
}) => {
  const t = useTranslate()
  const start = normalizeHex(initial) || normalizeHex(value) || '#7c5cff'
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(start))
  const [text, setText] = useState(start)
  const [invalid, setInvalid] = useState(false)
  const hex = hsvToHex(hsv)

  const apply = (next: Hsv) => {
    setHsv(next)
    setText(hsvToHex(next))
    setInvalid(false)
  }

  const typeHex = (raw: string) => {
    setText(raw)
    const normalized = normalizeHex(raw)
    if (normalized) {
      setHsv(hexToHsv(normalized))
      setInvalid(false)
    }
  }

  const confirm = () => {
    const color = normalizeHex(text)
    if (!color) {
      setInvalid(true)
      return
    }
    onPick(color)
    onClose()
  }

  return (
    <Modal
      title={t('colorPickerTitle')}
      overlayClassName={styles.dialogOverlay}
      onClose={onClose}
      footer={
        <>
          <Button variant="outlined" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={confirm}>{t('confirm')}</Button>
        </>
      }
    >
      <div className={styles.pickerPreview} style={{ backgroundColor: hex }} />
      <SaturationValueArea
        hsv={hsv}
        ariaLabel={t('colorPickerTitle')}
        onChange={(next) => apply({ ...next, h: hsv.h })}
      />
      <HueBar hue={hsv.h} ariaLabel={t('colorPickerHue')} onChange={(h) => apply({ ...hsv, h })} />
      <div className={styles.hexRow}>
        <span className={styles.hexLabel}>{t('colorPickerHex')}</span>
        <input
          className={styles.hexInput}
          value={text}
          aria-label={t('colorPickerHex')}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => typeHex(event.target.value)}
        />
        <span className={styles.hexChip} style={{ backgroundColor: normalizeHex(text) || hex }} />
      </div>
      {invalid ? <div className={styles.pickerError}>{t('colorPickerInvalid')}</div> : null}
      <div className={styles.palette}>
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className={clsx(styles.paletteItem, hex === color && styles.paletteSelected)}
            style={{ backgroundColor: color }}
            aria-label={color}
            onClick={() => apply(hexToHsv(color))}
          />
        ))}
      </div>
    </Modal>
  )
}
