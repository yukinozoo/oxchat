import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { canCompact } from '../../services/chat/compact.js'
import { useChatStore } from '../../services/chat/store.js'
import { useModels } from '../../services/models.js'
import {
  setModel,
  setSearch,
  setThinkingEffort,
  useSettings,
  type ThinkingDepth,
} from '../../services/settings.js'
import { IconCheckOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { CompactDialog } from './CompactDialog.js'
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

/**
 * 选择模型：底部面板直接列出全部模型，选中即生效。
 * 右上角的「压缩」对当前对话做摘要压缩，没有打开对话时不显示。
 */
export const ModelPicker = ({
  sessionId,
  onClose,
}: {
  sessionId: string | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const selected = useSettings((state) => state.model)
  const depth = useSettings((state) => state.thinkingDepth)
  const search = useSettings((state) => state.search)
  const models = useModels((state) => state.models)
  const options = models.length > 0 ? models : [selected]
  const session = useChatStore((state) =>
    sessionId !== null && Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : undefined
  )
  const [compacting, setCompacting] = useState(false)
  useAndroidBackHandler(true, onClose)

  const openCompact = () => {
    if (sessionId === null) {
      return
    }
    if (!session || !canCompact(session)) {
      showToast(t('compactShort'))
      return
    }
    setCompacting(true)
  }

  return createPortal(
    <>
      <div className={styles.overlay} role="presentation" onClick={onClose}>
        <div
          className={styles.sheet}
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.grabber} />
          <div className={styles.titleRow}>
            <div className={styles.title}>{t('modelPickerTitle')}</div>
            {sessionId !== null ? (
              <button
                type="button"
                className={styles.compactAction}
                aria-label={t('compactTitle')}
                onClick={openCompact}
              >
                {t('compactEntry')}
              </button>
            ) : null}
          </div>
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
                className={clsx(
                  styles.depthOption,
                  depth === item.value && styles.depthOptionActive
                )}
                onClick={() => setThinkingEffort(item.value)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>

          {/* 智能搜索：从输入框上方的按钮挪到这里，跟模型 / 思考强度放一起 */}
          <div className={styles.optionRow}>
            <span className={styles.optionLabel}>{t('search')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={search}
              aria-label={t('search')}
              className={clsx(styles.switch, search && styles.switchOn)}
              onClick={() => setSearch(!search)}
            >
              <span className={styles.switchKnob} />
            </button>
          </div>
        </div>
      </div>
      {/* 确认弹窗放在面板外层，避免点击冒泡到面板的遮罩 */}
      {compacting && sessionId !== null ? (
        <CompactDialog sessionId={sessionId} onClose={() => setCompacting(false)} />
      ) : null}
    </>,
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
