import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconGlobeLanguageOutline14,
  IconInfoOutline16,
  IconLogoutOutline16,
  IconPersonalizeOutline16,
  IconPersonOutline20,
  IconVolumeOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  backupFileName,
  clearHistory,
  exportHistory,
  exportHistoryStream,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { maskApiKey, clearAccount, formatBalance, loadBalance, useAccount } from '../../services/account.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setLocale,
  setThemePreference,
  setTtsVoice,
  setApiKey,
  setAutoCollapseThinking,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { WebsiteImportEntry } from './WebsiteImportEntry.js'
import { ArchiveImportDialog } from './ArchiveImportDialog.js'
import { ExportSelectDialog } from './ExportSelectDialog.js'
import { toBase64 } from '../../utils/base64.js'
import { logoutWebsite } from '../../services/chat/websiteImport.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的页面开始，之后在设置内部跳转
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const apiKey = useSettings((state) => state.apiKey)
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const autoCollapseThinking = useSettings((state) => state.autoCollapseThinking)
  const sessionCount = useChatStore((state) => state.sessions.length)
  const [version, setVersion] = useState('—')
  /** 语言与朗读音色用对话框选择，不再跳子页 */
  const [dialog, setDialog] = useState<'locale' | 'voice' | null>(null)

  // 原生壳里取 App 版本，网页端退回构建期注入的版本号
  useEffect(() => {
    const cap = (window as unknown as UnknownCapacitor).Capacitor
    const plugin = cap?.Plugins?.App
    if (plugin?.getInfo) {
      plugin
        .getInfo()
        .then((info) => setVersion(info.version ?? '—'))
        .catch(() => setVersion('—'))
      return
    }
    const meta = document.querySelector('meta[name="application-version"]')?.getAttribute('content')
    setVersion(meta ?? '—')
  }, [])

  const historyBusy = historyDelete.busy || replacingHistory
  const titles: Record<SettingsSection, TranslationKey> = {
    general: 'settings',
    api: 'settingsApiManage',
    data: 'settingsDataManage',
    theme: 'avatarMenuSettingsDialogThemeItemLabel',
    locale: 'settingsLocalePreference',
    voice: 'settingsTtsVoice',
    personalize: 'settingsPersonalize',
  }

  const themeLabels: Record<ThemePreference, TranslationKey> = {
    system: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    light: 'avatarMenuSettingsDialogThemeSelectLightOption',
    dark: 'avatarMenuSettingsDialogThemeSelectDarkOption',
  }

  const goBack = () => {
    if (section !== 'general') {
      setSection('general')
    } else if (!historyDelete.busy) {
      closeSettings()
    }
  }
  useAndroidBackHandler(true, goBack)

  return (
    <>
      <div className={styles.page} data-fullscreen-overlay>
        <div className={styles.pageHead}>
          <button type="button" className={styles.pageBack} aria-label={t('back')} onClick={goBack}>
            <span className={styles.backChevron}>
              <IconChevronRightOutline14 />
            </span>
          </button>
          <div className={styles.pageTitle}>{t(titles[section])}</div>
        </div>
        <div role="tabpanel" className={styles.pageBody}>
          {section === 'general' ? (
            <>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupAccount')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconPersonOutline20 />}
                    label={t('settingsApiManage')}
                    value={apiKey ? maskApiKey(apiKey) : t('settingsNoAccount')}
                    onClick={() => setSection('api')}
                  />
                  <NavRow
                    icon={<IconDataOutline16 />}
                    label={t('settingsDataManage')}
                    value={t('settingsDataCount', { count: sessionCount })}
                    onClick={() => setSection('data')}
                  />
                </div>
              </div>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupApp')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconGlobeLanguageOutline14 />}
                    label={t('settingsLocalePreference')}
                    value={t(
                      locale === 'zh-CN' ? 'settingsLocaleZhCNValue' : 'settingsLocaleEnUSValue'
                    )}
                    onClick={() => setDialog('locale')}
                  />
                  <NavRow
                    icon={<IconLightOutline16 />}
                    label={t('avatarMenuSettingsDialogThemeItemLabel')}
                    value={t(themeLabels[themePreference])}
                    onClick={() => setSection('theme')}
                  />
                  <NavRow
                    icon={<IconPersonalizeOutline16 />}
                    label={t('settingsPersonalize')}
                    onClick={() => setSection('personalize')}
                  />
                </div>
              </div>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupVoice')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconVolumeOutline16 />}
                    label={t('settingsTtsVoice')}
                    value={t(
                      ttsVoice === 'tide' ? 'settingsTtsVoiceTide' : 'settingsTtsVoiceStella'
                    )}
                    onClick={() => setDialog('voice')}
                  />
                </div>
              </div>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupAbout')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconInfoOutline16 />}
                    label={t('settingsVersion')}
                    value={version}
                  />
                </div>
              </div>
              {apiKey ? (
                <div className={styles.card}>
                  <button
                    type="button"
                    className={clsx(styles.cell, styles.row, styles.navRow, styles.signOut)}
                    onClick={() => {
                      // 退出登录：清本地 API Key、余额缓存与官网登录凭据，三处一起清干净
                      setApiKey(null)
                      clearAccount()
                      void logoutWebsite()
                        .then(() => showToast({ key: 'settingsSignOutDone' }))
                        .catch(() => showToast({ key: 'settingsSignOutFailed', type: 'error' }))
                      closeSettings()
                    }}
                  >
                    <span className={styles.rowIcon}>
                      <IconLogoutOutline16 />
                    </span>
                    <span className={styles.label}>{t('settingsSignOut')}</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : section === 'api' ? (
            <>
              <AccountCard apiKey={apiKey} />
              <ApiKeyTutorial />
              <ApiKeyField editor={apiKeyEditor} />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          ) : section === 'data' ? (
            <>
              <WebsiteImportEntry disabled={historyBusy} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
            </>
          ) : section === 'theme' ? (
            <div className={styles.card}>
              {themeOptions.map((option) => (
                <OptionRow
                  key={option.value}
                  label={t(option.label)}
                  icon={option.icon}
                  selected={themePreference === option.value}
                  onSelect={() => setThemePreference(option.value)}
                />
              ))}
            </div>
          ) : section === 'personalize' ? (
            <>
              <div className={styles.card}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCollapseThinking}
                  className={clsx(styles.cell, styles.row, styles.navRow)}
                  onClick={() => setAutoCollapseThinking(!autoCollapseThinking)}
                >
                  <span className={clsx(styles.label, styles.labelGrow)}>
                    {t('personalizeAutoCollapseThinking')}
                  </span>
                  <span
                    className={clsx(styles.switch, autoCollapseThinking && styles.switchOn)}
                    aria-hidden="true"
                  >
                    <span className={styles.switchKnob} />
                  </span>
                </button>
              </div>
              <div className={styles.settingDesc}>{t('personalizeAutoCollapseThinkingDesc')}</div>
            </>
          ) : null}
        </div>
      </div>
      {dialog === 'locale' ? (
        <Modal
          title={t('settingsLocalePreference')}
          overlayClassName={styles.dialogOverlay}
          onClose={() => setDialog(null)}
        >
          <div className={styles.card}>
            <OptionRow
              label={t('settingsLocaleZhCNValue')}
              icon={<IconGlobeLanguageOutline14 />}
              selected={locale === 'zh-CN'}
              onSelect={() => {
                setLocale('zh-CN')
                setDialog(null)
              }}
            />
            <OptionRow
              label={t('settingsLocaleEnUSValue')}
              icon={<IconGlobeLanguageOutline14 />}
              selected={locale === 'en-US'}
              onSelect={() => {
                setLocale('en-US')
                setDialog(null)
              }}
            />
          </div>
        </Modal>
      ) : null}
      {dialog === 'voice' ? (
        <Modal
          title={t('settingsTtsVoice')}
          overlayClassName={styles.dialogOverlay}
          onClose={() => setDialog(null)}
        >
          <div className={styles.card}>
            <OptionRow
              label={t('settingsTtsVoiceStella')}
              icon={<IconVolumeOutline16 />}
              selected={ttsVoice !== 'tide'}
              onSelect={() => {
                setTtsVoice('stella')
                setDialog(null)
              }}
            />
            <OptionRow
              label={t('settingsTtsVoiceTide')}
              icon={<IconVolumeOutline16 />}
              selected={ttsVoice === 'tide'}
              onSelect={() => {
                setTtsVoice('tide')
                setDialog(null)
              }}
            />
          </div>
        </Modal>
      ) : null}
      {historyImport.file ? (
        <ArchiveImportDialog
          file={historyImport.file}
          onClose={historyImport.cancel}
          onDone={({ imported, skipped }) =>
            historyImport.setStatus(
              skipped > 0
                ? { key: 'historyImportedSkipped', params: { imported, skipped } }
                : {
                    key: imported === 1 ? 'historyImportedOne' : 'historyImported',
                    params: { count: imported },
                  }
            )
          }
        />
      ) : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 账号卡：登录状态、打码后的 API Key 与余额，让「账号 / API 管理」页一眼看清当前身份 */
const AccountCard = ({ apiKey }: { apiKey: string | null }) => {
  const t = useTranslate()
  const balance = useAccount((state) => state.balance)
  const balanceLabel = formatBalance(balance)

  useEffect(() => {
    if (apiKey) {
      void loadBalance(apiKey)
    }
  }, [apiKey])

  return (
    <div className={styles.accountCard}>
      <span className={styles.accountAvatar}>
        <IconPersonOutline20 />
      </span>
      <div className={styles.accountInfo}>
        <div className={styles.accountName}>
          {apiKey ? maskApiKey(apiKey) : t('settingsNoAccount')}
        </div>
        <div className={styles.accountMeta}>
          {apiKey
            ? balanceLabel
              ? t('settingsAccountBalance', { balance: balanceLabel })
              : t('settingsAccountActive')
            : t('settingsNoAccountHint')}
        </div>
      </div>
    </div>
  )
}

/** API 管理页的详细教程：三步说明 + 跳转官方开放平台的蓝色按钮 */
const ApiKeyTutorial = () => {
  const t = useTranslate()
  return (
    <div className={styles.tutorial}>
      <div className={styles.tutorialTitle}>{t('apiKeyTutorialTitle')}</div>
      <p className={styles.tutorialStep}>{t('apiKeyTutorialStep1')}</p>
      <p className={styles.tutorialUrl}>platform.deepseek.com/api_keys</p>
      <p className={styles.tutorialStep}>{t('apiKeyTutorialStep2')}</p>
      <p className={styles.tutorialStep}>{t('apiKeyTutorialStep3')}</p>
      <a
        className={styles.tutorialButton}
        href="https://platform.deepseek.com/api_keys"
        target="_blank"
        rel="noreferrer"
      >
        {t('apiKeyTutorialOpen')}
      </a>
    </div>
  )
}

/** 子页里的单选项：图标 + 文案 + 勾选 */
const OptionRow = ({
  label,
  icon,
  selected,
  onSelect,
}: {
  label: string
  icon: ReactNode
  selected: boolean
  onSelect: () => void
}) => (
  <button
    type="button"
    className={clsx(styles.cell, styles.row, styles.navRow)}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <span className={styles.rowIcon}>{icon}</span>
    <span className={styles.label}>{label}</span>
    {selected ? (
      <span className={styles.chevron}>
        <IconCheckOutline16 />
      </span>
    ) : null}
  </button>
)

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      overlayClassName={styles.dialogOverlay}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}


type UnknownCapacitor = {
  Capacitor?: { Plugins?: { App?: { getInfo?: () => Promise<{ version?: string }> } } }
}

/** 设置行右侧的提示：正常文案或错误（可带原因键） */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/** 设置里的跳转行：图标 + 标签 + 右侧取值 + 箭头 */
const NavRow = ({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode
  label: string
  value?: string
  onClick?: () => void
}) => (
  <button
    type="button"
    className={clsx(styles.cell, styles.row, styles.navRow)}
    onClick={onClick}
    disabled={!onClick}
  >
    <span className={styles.rowIcon}>{icon}</span>
    <span className={clsx(styles.label, !value && styles.labelGrow)}>{label}</span>
    {value ? <span className={styles.rowValue}>{value}</span> : null}
    {onClick ? (
      <span className={styles.chevron}>
        <IconChevronRightOutline14 />
      </span>
    ) : null}
  </button>
)

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后交给选择对话框：先解析备份里的对话，由用户勾选再导入。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>(null)

  return {
    file,
    status,
    /** 选好文件后由选择对话框接手 */
    select: (next: File) => {
      setStatus(null)
      setFile(next)
    },
    /** 取消或导入完成后关闭 */
    cancel: () => setFile(null),
    setStatus,
  }
}

/** 导入备份文件：选好 ZIP 后由选择对话框列出对话，用户勾选再导入。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const picked = event.target.files?.[0]
              event.target.value = ''
              if (picked) {
                historyImport.select(picked)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 导入进度对话框：N / M 个对话 + 进度条，可后台继续或停止。 */

/** 原生端导出用到的插件子集：文件系统分片写入 + 系统分享 */type NativeBackupFilesystem = {
  deleteFile: (options: { path: string; directory: string }) => Promise<unknown>
  writeFile: (options: {
    path: string
    data: string
    directory: string
    recursive?: boolean
  }) => Promise<unknown>
  appendFile: (options: { path: string; data: string; directory: string }) => Promise<unknown>
  getUri: (options: { path: string; directory: string }) => Promise<{ uri: string }>
}
type NativeBackup = {
  filesystem: NativeBackupFilesystem
  share: {
    share: (options: { title: string; url: string; dialogTitle: string }) => Promise<unknown>
  }
}

const nativeBackupPlugins = (): NativeBackup | null => {
  const plugins = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    ?.Plugins
  const filesystem = plugins?.Filesystem as NativeBackupFilesystem | undefined
  const share = plugins?.Share as NativeBackup['share'] | undefined
  return filesystem && share ? { filesystem, share } : null
}

/** 导出历史：先选对话，原生端分片写缓存后分享，网页端整包下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [written, setWritten] = useState(0)
  /** 打开选择对话框，确认后带着选中的 id 开始导出 */
  const [selecting, setSelecting] = useState(false)
  const writtenRef = useRef(0)

  const onExport = async (only?: Set<string>) => {
    const native = nativeBackupPlugins()
    setBusy(true)
    setStatus(null)
    setWritten(0)
    writtenRef.current = 0
    try {
      if (native) {
        await exportNative(native, only)
      } else {
        const { name, blob } = await exportHistory(only)
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 用户在分享面板取消不算失败
      if (!/cancel/i.test(message)) {
        setStatus(errorStatus('historyExportFailed', error))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * 分片写入应用缓存：先把小分片攒到 512KB 再写一次。
   * 每次写入都要跨进程转 base64，攒批能把文件接口调用次数降到 1/8。
   */
  const exportNative = async (native: NativeBackup, only?: Set<string>) => {
    const FLUSH_BYTES = 512 * 1024
    let pending: Uint8Array[] = []
    let pendingBytes = 0
    const name = backupFileName(new Date())
    try {
      await native.filesystem.deleteFile({ path: name, directory: 'CACHE' })
    } catch {
      // 首次导出没有旧文件
    }
    let first = true
    let lastReport = 0
    /** 把攒下的分片拼成一块写盘 */
    const flush = async () => {
      if (pendingBytes === 0) {
        return
      }
      const merged = new Uint8Array(pendingBytes)
      let offset = 0
      for (const piece of pending) {
        merged.set(piece, offset)
        offset += piece.byteLength
      }
      pending = []
      pendingBytes = 0
      const data = toBase64(merged)
      if (first) {
        first = false
        await native.filesystem.writeFile({
          path: name,
          data,
          directory: 'CACHE',
          recursive: true,
        })
      } else {
        await native.filesystem.appendFile({ path: name, data, directory: 'CACHE' })
      }
    }
    const { bytes } = await exportHistoryStream(only, async (chunk) => {
      writtenRef.current += chunk.byteLength
      if (writtenRef.current - lastReport >= 1_048_576) {
        lastReport = writtenRef.current
        setWritten(writtenRef.current)
      }
      pending.push(chunk)
      pendingBytes += chunk.byteLength
      if (pendingBytes >= FLUSH_BYTES) {
        await flush()
      }
    })
    await flush()
    setWritten(bytes)
    const { uri } = await native.filesystem.getUri({ path: name, directory: 'CACHE' })
    await native.share.share({ title: name, url: uri, dialogTitle: t('exportShareTitle') })
  }

  return (
    <>
      {selecting ? (
        <ExportSelectDialog
          onClose={() => setSelecting(false)}
          onConfirm={(ids) => {
            setSelecting(false)
            void onExport(ids)
          }}
        />
      ) : null}
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => setSelecting(true)}
        >
          <IconDownloadOutline16 />
          {busy && written > 0
            ? t('historyExportProgress', { size: `${(written / 1048576).toFixed(1)}MB` })
            : t('exportAllDownload')}
        </Button>
      }
    />
    </>
  )
}
