import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { modelCaps } from '../../services/modelCaps.js'
import { loadChannelModels, useModels } from '../../services/models.js'
import {
  setActiveChannel,
  setModel,
  setSearch,
  setThinkingEffort,
  useSettings,
  type ThinkingDepth,
} from '../../services/settings.js'
import { listChannels } from '../../services/channels.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from '../base/icons.js'
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
 * 「整理对话」在用量面板里（那里能看到上下文水位），不再重复放在这里。
 */
export const ModelPicker = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const selected = useSettings((state) => state.model)
  const depth = useSettings((state) => state.thinkingDepth)
  const search = useSettings((state) => state.search)
  const models = useModels((state) => state.models)
  const activeChannel = useSettings((state) => state.activeChannel)
  /** 自定义渠道：和官方模型分组显示，选中即切换渠道 */
  const channels = listChannels()
  const channelModels = useModels((state) => state.channelModels)
  const channelLoading = useModels((state) => state.channelLoading)
  /** 手风琴：默认只展开当前渠道 */
  const [expanded, setExpanded] = useState<string[]>([activeChannel])
  /** v4-pro 之类不支持服务端工具：开关留着只会让人以为开了就有用，直接不显示 */
  const canSearch = modelCaps(selected).serverTools
  useAndroidBackHandler(true, onClose)

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
          </div>
          <div className={styles.channelList}>
            {channels.map((channel) => {
              const open = expanded.includes(channel.id)
              // 官方列表与渠道缓存严格分开，避免把某个渠道的模型算到官方头上
              const list =
                channel.id === 'deepseek'
                  ? models.length > 0
                    ? models
                    : activeChannel === 'deepseek'
                      ? [selected]
                      : []
                  : (channelModels[channel.id] ?? [])
              const count = list.length
              return (
                <div key={channel.id} className={styles.channelBlock}>
                  <button
                    type="button"
                    className={clsx(styles.channelHead, open && styles.channelHeadOpen)}
                    aria-expanded={open}
                    onClick={() => {
                      setExpanded((current) =>
                        current.includes(channel.id)
                          ? current.filter((id) => id !== channel.id)
                          : [...current, channel.id]
                      )
                      if (channel.id !== 'deepseek') {
                        void loadChannelModels(channel.id)
                      }
                    }}
                  >
                    <span className={styles.channelName}>{channel.name}</span>
                    <span className={styles.channelCount}>
                      {channelLoading[channel.id] ? t('modelChannelLoading') : t('modelChannelCount', { count })}
                    </span>
                    <span className={clsx(styles.channelChevron, open && styles.channelChevronOpen)}>
                      <IconChevronDownOutline14 />
                    </span>
                  </button>
                  {open ? (
                    <div className={styles.channelModels}>
                      {count === 0 ? (
                        <p className={styles.channelEmpty}>{t('modelChannelNoModels')}</p>
                      ) : null}
                      {list.map((id) => {
                        const active = activeChannel === channel.id && id === selected
                        return (
                          <button
                            key={`${channel.id}-${id}`}
                            type="button"
                            className={clsx(styles.channelModelRow, active && styles.channelModelRowActive)}
                            onClick={() => {
                              setActiveChannel(channel.id)
                              setModel(id)
                              if (channel.id !== 'deepseek') {
                                setThinkingEffort(channel.thinking ? 'high' : 'off')
                              }
                              onClose()
                            }}
                          >
                            <span>{channel.id === 'deepseek' ? prettyModelName(id) : id}</span>
                            {active ? (
                              <span className={styles.check}>
                                <IconCheckOutline16 />
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
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
          {canSearch ? (
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
          ) : null}
        </div>
      </div>
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
