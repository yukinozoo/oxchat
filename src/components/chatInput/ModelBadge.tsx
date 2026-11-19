import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadModels } from '../../services/models.js'
import { useSettings } from '../../services/settings.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { ModelPicker, prettyModelName } from './ModelPicker.js'
import styles from './ModelBadge.module.css'

/**
 * 输入框左下角的模型胶囊：
 * - 没接入 API（没有 Key）时不显示
 * - 列表来自 GET /models，显示下一次请求将使用的模型
 * - 点开是底部面板，直接列出全部模型（不带「管理模型」入口）
 */
export const ModelBadge = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const selected = useSettings((state) => state.model)
  const [open, setOpen] = useState(false)

  // 拿到 Key 后按需拉取服务端可用模型
  useEffect(() => {
    if (apiKey) {
      void loadModels(apiKey)
    }
  }, [apiKey])

  if (!apiKey) {
    return null
  }

  return (
    <>
      <button
        type="button"
        className={clsx(styles.badge, open && styles.open)}
        aria-label={t('modelSwitch')}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className={styles.label}>{prettyModelName(selected)}</span>
        <IconChevronDownOutline14 />
      </button>
      {open ? <ModelPicker sessionId={sessionId} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
