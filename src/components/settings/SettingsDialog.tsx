import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChatOutline20,
  IconCloudOutline20,
  IconCostOutline16,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFontSizeOutline16,
  IconLightOutline16,
  IconGlobeLanguageOutline14,
  IconInfoOutline16,
  IconBrowseOutline16,
  IconLogoutOutline16,
  IconPersonalizeOutline16,
  IconPersonOutline20,
  IconVolumeOutline16,
  IconUploadOutline14,
  IconRefreshOutline16,
  IconNoteOutline16,
  IconChannelOutline16,
} from '../base/icons.js'
import { BackupError, backupFileName, clearHistory } from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { usableCustomChannel } from '../../services/channels.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import {
  maskApiKey,
  clearAccount,
  formatBalance,
  loadBalance,
  useAccount,
} from '../../services/account.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  formatContextWindow,
  setLocale,
  setTtsVoice,
  setApiKey,
  setAutoCollapseThinking,
  setReplyLength,
  setSendClockTime,
  setResumeLastSession,
  setShowMessageUsage,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { ModelManager } from './ModelManager.js'
import { WebsiteImportEntry } from './WebsiteImportEntry.js'
/** 官网登录导入暂时下线：入口隐藏，组件与解析代码保留，需要时把开关改回 true */
const WEBSITE_IMPORT_ENABLED = false

/** 角色管理已放开（顶栏的角色切换也依赖它编辑「自定义」提示词） */
const ROLE_ENABLED = true
/** 记忆管理仍是占位：会话剧情还没做完，先只提示「敬请期待」 */
const MEMORY_MANAGE_ENABLED = true
import { ArchiveImportDialog } from './ArchiveImportDialog.js'
import { ChatSettings } from './ChatSettings.js'
import { LinkImportEntry } from './LinkImportEntry.js'
import { CostSettings } from './CostSettings.js'
import { UpdateDialog } from './UpdateDialog.js'
import { BackupSettings } from './BackupSettings.js'
import { BackupGuide } from './BackupGuide.js'
import { ApkDownloadDialog } from './ApkDownloadDialog.js'
import { DEEPSEEK_TOP_UP_URL } from '../../services/platformLinks.js'
import { exportSessionsToFile } from '../../services/chat/exportSession.js'
import {
  loadSessionsForTxt,
  saveTxt,
  sessionsToTxt,
  txtFileName,
} from '../../services/chat/exportTxt.js'
import {
  BACKUP_REMINDER_DAYS,
  shouldRetryPersist,
  daysSinceBackup,
  formatBytes,
  markBackupDone,
  requestPersistentStorage,
  storageStatus,
  type StorageStatus,
} from '../../services/storage.js'
import { pruneFiles } from '../../services/chat/db.js'
import { isNativePlatform } from '../../utils/platform.js'
import {
  checkForUpdate,
  updateAvailable,
  type CurrentVersion,
  type UpdateManifest,
} from '../../services/update.js'
import { FontSizeSettings, fontSizeLabel } from './FontSizeSettings.js'
import { ThemeSettings } from './ThemeSettings.js'
import { ExportSelectDialog, type ExportChoice } from './ExportSelectDialog.js'
import { ChangelogPage } from './ChangelogPage.js'
import { MemoryManager } from './MemoryManager.js'
import { MemoryGuidePage } from './MemoryGuidePage.js'
import { RoleSettings } from './RoleSettings.js'
import { RoleGuidePage } from './RoleGuidePage.js'
import { Tutorials } from './Tutorials.js'
import { ScrollPane } from '../base/ScrollPane.js'
import { logoutWebsite, websiteImportAvailable } from '../../services/chat/websiteImport.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'
import { HIDDEN_FILE_INPUT_STYLE } from '../../utils/hiddenFileInput.js'

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
  const sendClockTime = useSettings((state) => state.sendClockTime)
  const replyLength = useSettings((state) => state.replyLength)
  const resumeLastSession = useSettings((state) => state.resumeLastSession)
  const showMessageUsage = useSettings((state) => state.showMessageUsage)
  const giteeLastSync = useSettings((state) => state.giteeLastSync)
  const contextWindow = useSettings((state) => state.contextWindow)
  const fontSize = useSettings((state) => state.fontSize)
  const fontSizeFollowSystem = useSettings((state) => state.fontSizeFollowSystem)
  const sessionCount = useChatStore((state) => state.sessions.length)
  const [version, setVersion] = useState('—')
  /** 语言与朗读音色用对话框选择，不再跳子页 */
  const [dialog, setDialog] = useState<'locale' | 'voice' | null>(null)
  /** 在线更新：检查发现的清单，弹窗展示 */
  const [update, setUpdate] = useState<{ manifest: UpdateManifest; current: CurrentVersion } | null>(null)
  const [checking, setChecking] = useState(false)
  /** 网页版的「下载安卓版」：打开弹窗，分片并行下载并显示进度 */
  const [apkDownloadOpen, setApkDownloadOpen] = useState(false)

  const checkUpdate = async () => {
    if (!updateAvailable()) {
      showToast(t('updateUnsupported'))
      return
    }
    setChecking(true)
    try {
      const result = await checkForUpdate()
      if (result.status === 'available') {
        setUpdate({ manifest: result.manifest, current: result.current })
      } else if (result.status === 'latest') {
        showToast(t('updateLatestToast'))
      } else {
        showToast(
          t('updateFailed', {
            message: result.status === 'error' ? result.message : t('updateUnsupported'),
          })
        )
      }
    } finally {
      setChecking(false)
    }
  }

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
    api: 'settingsModelManage',
    data: 'settingsDataManage',
    theme: 'avatarMenuSettingsDialogThemeItemLabel',
    locale: 'settingsLocalePreference',
    voice: 'settingsTtsVoice',
    personalize: 'settingsPersonalize',
    chat: 'settingsChat',
    fontSize: 'settingsFontSize',
    cost: 'settingsCost',
    backup: 'settingsBackup',
    backupGuide: 'backupGuideTitle',
    tutorials: 'tutorialsTitle',
    changelog: 'changelogPageTitle',
    roles: 'roleTitle',
    roleGuide: 'roleGuideTitle',
    memoryManage: 'memoryManageTitle',
    memoryGuide: 'memoryGuideTitle',
  }

  const themeLabels: Record<ThemePreference, TranslationKey> = {
    system: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    light: 'avatarMenuSettingsDialogThemeSelectLightOption',
    dark: 'avatarMenuSettingsDialogThemeSelectDarkOption',
  }

  const goBack = () => {
    if (useSettingsDialog.getState().closeOnBack) {
      // 从聊天页的「选择角色」跳进来：返回要回对话页，不要停在设置首页
      closeSettings()
      return
    }
    if (section === 'roleGuide') {
      setSection('roles')
      return
    }
    if (section === 'memoryGuide') {
      setSection('memoryManage')
      return
    }
    if (section !== 'general') {
      setSection('general')
    } else if (!historyDelete.busy) {
      closeSettings()
    }
  }
  useAndroidBackHandler(true, goBack)

  return (
    <>
      <div
        className={styles.page}
        data-section={section}
        data-fullscreen-overlay
        onMouseDown={(event) => {
          // 桌面端的遮罩点击关闭；移动端整屏铺满，点不到这里
          if (event.target === event.currentTarget) {
            goBack()
          }
        }}
      >
        <div className={styles.pagePanel}>
        <div className={styles.pageHead}>
          <button type="button" className={styles.pageBack} aria-label={t('back')} onClick={goBack}>
            <span className={styles.backChevron}>
              <IconChevronRightOutline14 />
            </span>
          </button>
          <div className={styles.pageTitle}>{t(titles[section])}</div>
          {section === 'memoryManage' ? (
            <button
              type="button"
              className={styles.pageAction}
              onClick={() => setSection('memoryGuide')}
            >
              {t('memoryGuideEntry')}
            </button>
          ) : null}
          {section === 'roles' ? (
            <button
              type="button"
              className={styles.pageAction}
              onClick={() => setSection('roleGuide')}
            >
              {t('roleGuideEntry')}
            </button>
          ) : null}
          {section === 'backup' ? (
            <button
              type="button"
              className={styles.pageAction}
              onClick={() => setSection('backupGuide')}
            >
              {t('backupGuideEntry')}
            </button>
          ) : null}
        </div>
        <ScrollPane contentClassName={styles.pageBody} role="tabpanel">
          {section === 'general' ? (
            <>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupAccount')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconChannelOutline16 />}
                    label={t('settingsModelManage')}
                    value={
                      apiKey
                        ? maskApiKey(apiKey)
                        : (usableCustomChannel()?.name ?? t('settingsNoAccount'))
                    }
                    onClick={() => setSection('api')}
                  />
                  <NavRow
                    icon={<IconPersonOutline20 />}
                    label={t('roleEntry')}
                    value={ROLE_ENABLED ? '' : t('comingSoon')}
                    onClick={() => (ROLE_ENABLED ? setSection('roles') : showToast(t('comingSoon')))}
                  />
                  <NavRow
                    icon={<IconNoteOutline16 />}
                    label={t('memoryManageEntry')}
                    value={MEMORY_MANAGE_ENABLED ? '' : t('comingSoon')}
                    onClick={() =>
                      MEMORY_MANAGE_ENABLED
                        ? setSection('memoryManage')
                        : showToast(t('comingSoon'))
                    }
                  />
                  <NavRow
                    icon={<IconDataOutline16 />}
                    label={t('settingsDataManage')}
                    value={t('settingsDataCount', { count: sessionCount })}
                    onClick={() => setSection('data')}
                  />
                  <NavRow
                    icon={<IconCloudOutline20 />}
                    label={t('settingsBackup')}
                    value={
                      giteeLastSync > 0
                        ? t('backupLastSyncShort', {
                            time: new Date(giteeLastSync).toLocaleDateString(),
                          })
                        : t('backupNeverShort')
                    }
                    onClick={() => setSection('backup')}
                  />
                </div>
              </div>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupApp')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconChatOutline20 />}
                    label={t('settingsChat')}
                    value={
                      contextWindow === 0
                        ? t('chatWindowUnlimited')
                        : formatContextWindow(contextWindow)
                    }
                    onClick={() => setSection('chat')}
                  />
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
                  <NavRow
                    icon={<IconFontSizeOutline16 />}
                    label={t('settingsFontSize')}
                    value={fontSizeLabel(fontSize, fontSizeFollowSystem, t)}
                    onClick={() => setSection('fontSize')}
                  />
                  <NavRow
                    icon={<IconCostOutline16 />}
                    label={t('settingsCost')}
                    onClick={() => setSection('cost')}
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
                <div className={styles.groupTitle}>{t('settingsGroupApp')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconInfoOutline16 />}
                    label={t('settingsVersion')}
                    value={version ? `${version} · ${__BUILD_STAMP__}` : version}
                  />
                  <NavRow
                    icon={<IconRefreshOutline16 />}
                    label={t('changelogEntry')}
                    value=""
                    onClick={() => setSection('changelog')}
                  />
                  {updateAvailable() ? (
                    <NavRow
                      icon={<IconDownloadOutline16 />}
                      label={t('settingsCheckUpdate')}
                      value={
                        checking
                          ? t('updateChecking')
                          : update
                            ? t('updateFound', { version: update.manifest.versionName })
                            : ''
                      }
                      onClick={() => void checkUpdate()}
                    />
                  ) : (
                    // 网页版没有安装包可检查，改成引导去下 Android 版（站点同源地址，取不到时退回 GitHub 直连）
                    <NavRow
                      icon={<IconDownloadOutline16 />}
                      label={t('settingsDownloadAndroid')}
                      value={t('settingsDownloadAndroidValue')}
                      onClick={() => setApkDownloadOpen(true)}
                    />
                  )}
                </div>
              </div>
              <div className={styles.group}>
                <div className={styles.groupTitle}>{t('settingsGroupHelp')}</div>
                <div className={styles.card}>
                  <NavRow
                    icon={<IconBrowseOutline16 />}
                    label={t('tutorialsEntry')}
                    value=""
                    onClick={() => setSection('tutorials')}
                  />
                </div>
                <div className={styles.settingDesc}>{t('settingsUnofficial')}</div>
              </div>
              {apiKey ? (
                <div className={styles.card}>
                  <button
                    type="button"
                    className={clsx(styles.cell, styles.row, styles.navRow, styles.signOut)}
                    onClick={() => {
                      // 删除 API KEY：清本地 API Key、余额缓存与官网登录凭据，三处一起清干净
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
            <ModelManager
              deepseek={
                <>
                  <AccountCard apiKey={apiKey} />
                  <ApiKeyTutorial />
                  <ApiKeyField editor={apiKeyEditor} />
                  {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
                </>
              }
            />
          ) : section === 'data' ? (
            <>
              {isNativePlatform() ? null : <StorageCard />}
              {WEBSITE_IMPORT_ENABLED ? <WebsiteImportEntry disabled={historyBusy} /> : null}
              {/* 网页版拿不到预签名包体（OBS 不给跨域头），链接导入只在原生壳里出现 */}
              {websiteImportAvailable() ? <LinkImportEntry disabled={historyBusy} /> : null}
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
            <ThemeSettings />
          ) : section === 'fontSize' ? (
            <FontSizeSettings />
          ) : section === 'cost' ? (
            <CostSettings />
          ) : section === 'chat' ? (
            <ChatSettings />
          ) : section === 'backup' ? (
            <BackupSettings />
          ) : section === 'tutorials' ? (
            <Tutorials />
          ) : section === 'roles' ? (
            <RoleSettings />
          ) : section === 'roleGuide' ? (
            <RoleGuidePage />
          ) : section === 'memoryManage' ? (
            <MemoryManager />
          ) : section === 'memoryGuide' ? (
            <MemoryGuidePage />
          ) : section === 'changelog' ? (
            <ChangelogPage />
          ) : section === 'backupGuide' ? (
            <BackupGuide />
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
              <div className={styles.card}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={resumeLastSession}
                  className={clsx(styles.cell, styles.row, styles.navRow)}
                  onClick={() => setResumeLastSession(!resumeLastSession)}
                >
                  <span className={clsx(styles.label, styles.labelGrow)}>
                    {t('personalizeResumeLastSession')}
                  </span>
                  <span
                    className={clsx(styles.switch, resumeLastSession && styles.switchOn)}
                    aria-hidden="true"
                  >
                    <span className={styles.switchKnob} />
                  </span>
                </button>
              </div>
              <div className={styles.settingDesc}>{t('personalizeResumeLastSessionDesc')}</div>
              <div className={styles.card}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showMessageUsage}
                  className={clsx(styles.cell, styles.row, styles.navRow)}
                  onClick={() => setShowMessageUsage(!showMessageUsage)}
                >
                  <span className={clsx(styles.label, styles.labelGrow)}>
                    {t('personalizeShowUsage')}
                  </span>
                  <span
                    className={clsx(styles.switch, showMessageUsage && styles.switchOn)}
                    aria-hidden="true"
                  >
                    <span className={styles.switchKnob} />
                  </span>
                </button>
              </div>
              <div className={styles.settingDesc}>{t('personalizeShowUsageDesc')}</div>
              <div className={styles.card}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sendClockTime}
                  className={clsx(styles.cell, styles.row, styles.navRow)}
                  onClick={() => setSendClockTime(!sendClockTime)}
                >
                  <span className={clsx(styles.label, styles.labelGrow)}>
                    {t('personalizeSendClockTime')}
                  </span>
                  <span
                    className={clsx(styles.switch, sendClockTime && styles.switchOn)}
                    aria-hidden="true"
                  >
                    <span className={styles.switchKnob} />
                  </span>
                </button>
              </div>
              <div className={styles.settingDesc}>{t('personalizeSendClockTimeDesc')}</div>
              <div className={styles.card}>
                <div className={styles.cell}>
                  <span className={styles.label}>{t('settingsReplyLength')}</span>
                  <div
                    className={styles.segmented}
                    role="radiogroup"
                    aria-label={t('settingsReplyLength')}
                  >
                    {(
                      [
                        ['default', 'replyLengthDefault'],
                        ['detailed', 'replyLengthDetailed'],
                        ['concise', 'replyLengthConcise'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={replyLength === value}
                        className={
                          replyLength === value
                            ? `${styles.segment} ${styles.segmentActive}`
                            : styles.segment
                        }
                        onClick={() => setReplyLength(value)}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className={styles.settingDesc}>{t('replyLengthHint')}</div>
            </>
          ) : null}
        </ScrollPane>
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
      {update ? (
        <UpdateDialog
          manifest={update.manifest}
          current={update.current}
          onClose={() => setUpdate(null)}
        />
      ) : null}
      {apkDownloadOpen ? (
        <ApkDownloadDialog
          overlayClassName={styles.dialogOverlay}
          onClose={() => setApkDownloadOpen(false)}
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
      {apiKey ? (
        // 余额右边给个出去充值的入口；原生壳里由 bridge 拦成系统浏览器打开
        <a
          className={styles.accountTopUp}
          href={DEEPSEEK_TOP_UP_URL}
          target="_blank"
          rel="noreferrer"
        >
          {t('settingsTopUp')}
        </a>
      ) : null}
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

/** 本地存储健康度：用量、持久化申请、残留附件清理与备份提醒 */
const StorageCard = () => {
  const t = useTranslate()
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [cleanStatus, setCleanStatus] = useState<Status>(null)
  const [denied, setDenied] = useState(false)
  const sessionCount = useChatStore((state) => state.sessions.length)
  const missingDays = daysSinceBackup()

  const refresh = async () => setStatus(await storageStatus())

  useEffect(() => {
    void (async () => {
      const current = await storageStatus()
      setStatus(current)
      // 被拒过就一天后再静默重试一次：添加到主屏幕后 Chrome 往往就授了
      if (current.supported && !current.persisted && shouldRetryPersist()) {
        const granted = await requestPersistentStorage()
        setDenied(!granted)
        await refresh()
      }
    })()
  }, [])

  const persist = async () => {
    setBusy(true)
    try {
      const granted = await requestPersistentStorage()
      setDenied(!granted)
      showToast(t(granted ? 'storagePersistGranted' : 'storagePersistDenied'))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const cleanup = async () => {
    setBusy(true)
    try {
      const result = await pruneFiles()
      setCleanStatus(
        result.removed > 0
          ? {
              key: 'storageCleanupDone',
              params: { count: result.removed, size: formatBytes(result.bytes) },
            }
          : { key: 'storageCleanupNone' }
      )
      await refresh()
    } catch {
      setCleanStatus({ key: 'historyDeleteFailed', error: true })
    } finally {
      setBusy(false)
    }
  }

  const remind =
    sessionCount > 0
      ? missingDays === null
        ? t('backupReminderNever')
        : missingDays >= BACKUP_REMINDER_DAYS
          ? t('backupReminderDays', { days: missingDays })
          : null
      : null

  return (
    <div className={styles.card}>
      <SettingCell
        label={t('storageTitle')}
        description={
          status
            ? t('storageQuota', {
                used: formatBytes(status.usage),
                quota: status.quota > 0 ? formatBytes(status.quota) : '—',
              })
            : undefined
        }
        status={null}
        action={
          status?.supported && !status.persisted ? (
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              disabled={busy}
              onClick={() => void persist()}
            >
              {t('storagePersistAction')}
            </Button>
          ) : null
        }
      />
      <SettingCell
        label={t('storagePersistState')}
        description={
          status?.persisted
            ? t('storagePersisted')
            : status && !status.supported
              ? `${t('storageNotPersisted')} · ${t('storagePersistUnsupported')}`
              : denied
                ? `${t('storageNotPersisted')} · ${t('storagePersistHint')}`
                : t('storageNotPersisted')
        }
        status={null}
        action={null}
      />
      <SettingCell
        label={t('storageCleanup')}
        description={t('storageCleanupDesc')}
        status={cleanStatus}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={busy}
            onClick={() => void cleanup()}
          >
            {t('delete')}
          </Button>
        }
      />
      {remind ? (
        <SettingCell label={t('storageBackup')} description={remind} status={null} action={null} />
      ) : null}
    </div>
  )
}

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
            style={HIDDEN_FILE_INPUT_STYLE}
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

  const onExport = async (
    only?: Set<string>,
    choice: ExportChoice = {
      includeImages: true,
      format: 'zip',
      includeThinking: false,
      includeExtras: true,
    }
  ) => {
    const includeImages = choice.includeImages
    setBusy(true)
    setStatus(null)
    setWritten(0)
    writtenRef.current = 0
    /** 流式写入的分片很密，按 1MB 节流刷新进度 */
    let lastReport = 0
    try {
      if (choice.format === 'txt') {
        // 文本导出：按选中的会话逐条拼成一份可读文本（只导当前分支）
        const ids = only ? [...only] : useChatStore.getState().sessions.map((item) => item.id)
        const selected = await loadSessionsForTxt(ids)
        if (selected.length === 0) {
          return
        }
        const text = sessionsToTxt(selected, {
          includeThinking: choice.includeThinking,
          includeMeta: true,
          includeFiles: true,
        })
        const fileName = txtFileName(selected.length === 1 ? selected[0].title : t('exportFormatTxt'))
        await saveTxt(fileName, text, t('exportShareTitle'))
        showToast({ key: 'exportTxtDone' })
        return
      }
      // 文件名与「导出当前对话」完全一致：deepseek_data-日期.zip
      const outcome = await exportSessionsToFile({
        only,
        includeImages,
        includeExtras: choice.includeExtras,
        fileName: backupFileName(new Date()),
        shareTitle: t('exportShareTitle'),
        onProgress: (bytes) => {
          writtenRef.current = bytes
          if (bytes - lastReport >= 1_048_576) {
            lastReport = bytes
            setWritten(bytes)
          }
        },
      })
      if (outcome === 'saved') {
        markBackupDone()
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

  return (
    <>
      {selecting ? (
        <ExportSelectDialog
          onClose={() => setSelecting(false)}
          onConfirm={(ids, choice) => {
            setSelecting(false)
            void onExport(ids, choice)
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
