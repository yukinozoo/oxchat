import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { setupAndroidBack } from '../services/androidBack.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { UsageDeclaration } from '../components/session/UsageDeclaration.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { ImportProgressBar } from '../components/ImportProgressBar.js'
import { CompactConfirmDialog } from '../components/chatInput/CompactConfirmDialog.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { useEdgeSwipe } from '../components/sider/useEdgeSwipe.js'
import { UpdateDialog } from '../components/settings/UpdateDialog.js'
import { useSilentUpdateCheck, type CurrentVersion, type UpdateManifest } from '../services/update.js'
import { registerAutoPullMerge, runAutoPull } from '../services/chat/giteeAutoPull.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  /** 启动时静默检查一次更新，发现新版本才弹窗 */
  const [update, setUpdate] = useState<{ manifest: UpdateManifest; current: CurrentVersion } | null>(
    null
  )
  useSilentUpdateCheck((manifest, current) => setUpdate({ manifest, current }))

  usePreventPageScroll(isMobile)
  // 移动端从左边缘右滑打开侧边栏
  useEdgeSwipe(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // Android 系统返回键优先关闭当前弹层或返回上一页
  useEffect(setupAndroidBack, [])
  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  // 原生壳里导出的 ZIP 保存失败时用应用内 toast 提示；用户取消分享不打扰
  useEffect(() => {
    const onSaveError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail
      showToast({ key: 'historyExportFailed', params: { message }, type: 'error' })
    }
    window.addEventListener('oxchat:blob-save-error', onSaveError)
    return () => window.removeEventListener('oxchat:blob-save-error', onSaveError)
  }, [])
  useEffect(bindChatPersistence, [])

  // 自动拉取：进入应用 / 切回前台时静默把云端备份合并进来（近实时多端）
  useEffect(() => {
    void import('../services/chat/backup.js').then(({ readArchiveIndex, syncImportSessions }) =>
      registerAutoPullMerge(async (file) => {
        const entries = await readArchiveIndex(file)
        return syncImportSessions(file, new Set(entries.map((entry) => entry.id)))
      })
    )
  }, [])
  useEffect(() => {
    if (!ready) {
      return
    }
    const run = () =>
      void runAutoPull({
        streaming: () => Object.keys(useChatStore.getState().streaming).length,
        importing: () => useChatStore.getState().importingHistory,
      })
    run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        run()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ready])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
  }, [])

  return (
    <>
      <ImportProgressBar />
      <CompactConfirmDialog />
      <div
        ref={frameRef}
        className={importingHistory ? `${styles.frame} ${styles.frameWithBar}` : styles.frame}
      >
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader hideNewChat /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      {update ? (
        <UpdateDialog
          manifest={update.manifest}
          current={update.current}
          onClose={() => setUpdate(null)}
        />
      ) : null}
      <UsageDeclaration />
      <Toast />
    </>
  )
}
