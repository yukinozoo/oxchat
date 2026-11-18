import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { useModels } from '../../services/models.js'
import {
  setModel,
  setThinkingEffort,
  useSettings,
  type ThinkingDepth,
} from '../../services/settings.js'
import { IconCheckOutline16 } from '../base/icons.js'
import styles from './composerSheet.module.css'

/** 模型名转显示名：deepseek-v4.1-flash → DeepSeek V4.1 Flash */
export const prettyModelName = (id: string): string =>
  id
    .replace(/^deepseek/i, 'DeepSeek')
    .split('-')
    .map((part) =>
      /^v?\d/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(' ')

/** 选择模型：底部面板直接列出全部模型，选中即生效 */
export const ModelPicker = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const selected = useSettings((state) => state.model)
  const depth = useSettings((state) => state.thinkingDepth)
  const models = useModels((state) => state.models)
  const options = models.length > 0 ? models : [selected]
  useAndroidBackHandler(true, onClose)

  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grabber} />
        <div className={styles.title}>{t('modelPickerTitle')}</div>
        <div className={styles.modelList}>
          {options.map((id) => (
            <button
              key={id}
              type="button"
              className={clsx(styles.modelRow, id === selected && styles.modelRowActive)}
              onClick={() => {
                setModel(id)
                onClose()
              }}
            >
              <span>{prettyModelName(id)}</span>
              {id === selected ? (
                <span className={styles.check}>
                  <IconCheckOutline16 />
                </span>
              ) : (
                <span className={styles.checkEmpty} />
              )}
            </button>
          ))}
        </div>

        <div className={styles.depthTitle}>{t('thinkingDepthTitle')}</div>
        <div className={styles.depthTrack} role="radiogroup" aria-label={t('thinkingDepthTitle')}>
          {DEPTHS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={depth === item.value}
              className={clsx(styles.depthOption, depth === item.value && styles.depthOptionActive)}
              onClick={() => setThinkingEffort(item.value)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** 四档思考深度：不思考 / 低 / 中 / 高 */
const DEPTHS: {
  value: ThinkingDepth
  label: 'thinkingDepthOff' | 'thinkingDepthLow' | 'thinkingDepthMid' | 'thinkingDepthHigh'
}[] = [
  { value: 'off', label: 'thinkingDepthOff' },
  { value: 'low', label: 'thinkingDepthLow' },
  { value: 'mid', label: 'thinkingDepthMid' },
  { value: 'high', label: 'thinkingDepthHigh' },
]
