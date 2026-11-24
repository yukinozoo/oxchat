import { useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  createChannel,
  listChannels,
  removeChannel,
  type ChannelProtocol,
} from '../../services/channels.js'
import { setActiveChannel, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './ModelManager.module.css'

/**
 * 模型管理：顶部两个 tab。
 *
 * - 「DeepSeek」：原来的 API Key 页面（账号 / 余额 / Key 输入 / 教程），由调用方整块传进来；
 * - 「自定义」：用户自建渠道（名称 / 兼容协议 / Base URL / API Key），保存后出现在对话页的模型选择里。
 *
 * 自定义渠道的请求路由还没接（下一批做协议适配），选中后发送会明确提示。
 */
const PROTOCOLS: { value: ChannelProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'responses', label: 'Responses' },
]

export const ModelManager = ({ deepseek }: { deepseek: ReactNode }) => {
  const t = useTranslate()
  const activeChannel = useSettings((state) => state.activeChannel)
  const [tab, setTab] = useState<'deepseek' | 'custom'>('deepseek')
  const [version, setVersion] = useState(0)
  void version
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<ChannelProtocol>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [open, setOpen] = useState(false)

  const channels = listChannels().filter((channel) => channel.id !== 'deepseek')

  const save = () => {
    if (!name.trim() || !baseUrl.trim()) {
      showToast(t('modelChannelRequired'))
      return
    }
    const id = createChannel({ name, protocol, baseUrl, apiKey })
    setVersion((value) => value + 1)
    setActiveChannel(id)
    setName('')
    setBaseUrl('')
    setApiKey('')
    setProtocol('openai')
    setOpen(false)
    showToast(t('modelChannelSaved'))
  }

  return (
    <div className={styles.page}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'deepseek'}
          className={tab === 'deepseek' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setTab('deepseek')}
        >
          DeepSeek
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'custom'}
          className={tab === 'custom' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setTab('custom')}
        >
          {t('modelChannelCustom')}
        </button>
      </div>

      {tab === 'deepseek' ? (
        deepseek
      ) : (
        <>
          {channels.length === 0 && !open ? (
            <p className={styles.lead}>{t('modelChannelEmpty')}</p>
          ) : null}
          {channels.map((channel) => (
            <div key={channel.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>{channel.name}</span>
                <span className={styles.rowMeta}>
                  {channel.protocol} · {channel.baseUrl}
                </span>
              </div>
              {channel.id === activeChannel ? (
                <span className={styles.badge}>{t('modelChannelActive')}</span>
              ) : null}
              <button
                type="button"
                className={styles.danger}
                onClick={() => {
                  removeChannel(channel.id)
                  if (activeChannel === channel.id) {
                    setActiveChannel('deepseek')
                  }
                  setVersion((value) => value + 1)
                }}
              >
                {t('delete')}
              </button>
            </div>
          ))}

          {open ? (
            <>
              <div className={styles.card}>
                <label className={styles.field}>
                  <span className={styles.label}>{t('modelChannelName')}</span>
                  <input
                    className={styles.input}
                    value={name}
                    placeholder={t('modelChannelNamePlaceholder')}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <div className={styles.field}>
                  <span className={styles.label}>{t('modelChannelProtocol')}</span>
                  <div className={styles.segments} role="group">
                    {PROTOCOLS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={protocol === item.value}
                        className={
                          protocol === item.value
                            ? `${styles.segment} ${styles.segmentActive}`
                            : styles.segment
                        }
                        onClick={() => setProtocol(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.card}>
                <label className={styles.field}>
                  <span className={styles.label}>Base URL</span>
                  <input
                    className={styles.input}
                    value={baseUrl}
                    placeholder="https://api.example.com/v1"
                    inputMode="url"
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>API Key</span>
                  <input
                    className={styles.input}
                    value={apiKey}
                    placeholder="sk-…"
                    autoComplete="off"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
              </div>

              <p className={styles.note}>{t('modelChannelRouteNote')}</p>
            </>
          ) : (
            <button type="button" className={styles.add} onClick={() => setOpen(true)}>
              ＋ {t('modelChannelAdd')}
            </button>
          )}

          {open ? (
            <div className={styles.actions}>
              <Button variant="outlined" size="m" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button size="m" onClick={save}>
                {t('modelChannelSave')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
