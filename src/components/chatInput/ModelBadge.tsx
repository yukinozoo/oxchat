import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadChannelModels, loadModels } from '../../services/models.js'
import { channelById, listChannels } from '../../services/channels.js'
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
export const ModelBadge = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const selected = useSettings((state) => state.model)
  const activeChannel = useSettings((state) => state.activeChannel)
  const channel = channelById(activeChannel)
  const [open, setOpen] = useState(false)

  // 官方列表只跟官方 Key 走；自定义渠道单独拉自己的（互不串数据）
  useEffect(() => {
    if (apiKey) {
      void loadModels(apiKey)
    }
  }, [apiKey])

  useEffect(() => {
    if (activeChannel !== 'deepseek') {
      void loadChannelModels(activeChannel)
    }
  }, [activeChannel])

  // 只在「填了官方 Key」或「建过自定义渠道」时出现；都没有就没得选
  if (!apiKey && listChannels().length <= 1) {
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
        <span className={styles.label}>
          {activeChannel === 'deepseek' ? prettyModelName(selected) : channel.name}
        </span>
        <IconChevronDownOutline14 />
      </button>
      {open ? <ModelPicker onClose={() => setOpen(false)} /> : null}
    </>
  )
}
