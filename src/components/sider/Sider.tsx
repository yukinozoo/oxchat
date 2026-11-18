import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconPersonOutline20,
  IconEditOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconTrashOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed, useSettings } from '../../services/settings.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { formatBalance, loadBalance, maskApiKey, useAccount } from '../../services/account.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  newChat,
  pinSession,
  pinSessions,
  removeSession,
  removeSessions,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import {
  OPEN_THRESHOLD,
  drawerWidth,
  openDrawerOffset,
  resetDrawerOffset,
  rubberProgress,
  setDrawerOffset,
} from './drawerGesture.js'
import { SessionItem } from './SessionItem.js'
import { SessionSearch } from './SessionSearch.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [searching, setSearching] = useState(false)
  useAndroidBackHandler(mobile && searching, () => setSearching(false))
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const exitEditing = () => {
    setEditing(false)
    setSelected(new Set())
  }
  useAndroidBackHandler(mobile && editing && !searching, exitEditing)
  const toggleSelected = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  const selectedIds = [...selected]
  /** 全部会话都已选中时，按钮变成「取消全选」 */
  const allSelected = sessions.length > 0 && sessions.every((session) => selected.has(session.id))
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(sessions.map((session) => session.id)))
  /** 选中的全是已置顶时，按钮变成「取消置顶」 */
  const allPinned =
    selectedIds.length > 0 && selectedIds.every((id) => sessions.find((s) => s.id === id)?.pinned)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const apiKey = useSettings((state) => state.apiKey)
  const balance = useAccount((state) => state.balance)
  const balanceLabel = formatBalance(balance)

  // 有 Key 就顺带拉一次余额，失败静默
  useEffect(() => {
    if (apiKey) {
      void loadBalance(apiKey)
    }
  }, [apiKey])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (searching) {
    // 搜索是独立界面：不再渲染侧边栏列表，避免两层内容叠在一起
    return (
      <div className={clsx(styles.sider, mobile && styles.mobile)}>
        <SessionSearch onBack={() => setSearching(false)} />
      </div>
    )
  }

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{editing ? t('selectChats') : t('appName')}</div>
        <div className={styles.topActions}>
          {editing ? (
            <>
              <button
                type="button"
                className={styles.selectAll}
                disabled={sessions.length === 0}
                onClick={toggleSelectAll}
              >
                {allSelected ? t('unselectAll') : t('selectAll')}
              </button>
              <IconButton
                size="m"
                icon={<IconCloseOutline16 />}
                aria-label={t('cancel')}
                onClick={exitEditing}
              />
            </>
          ) : (
            <>
              <IconButton
                size="m"
                icon={<IconEditOutline16 />}
                tooltip={t('selectChats')}
                tooltipPlacement="bottom"
                onClick={() => setEditing(true)}
              />
              <IconButton
                size="m"
                icon={<IconPanelLeftOutline16 />}
                tooltip={t('collapseSiderbarButton')}
                tooltipPlacement="bottom"
                onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
              />
            </>
          )}
        </div>
      </div>
      {editing ? null : (
        <button type="button" className={styles.searchEntry} onClick={() => setSearching(true)}>
          <IconSearchOutline16 />
          <span className={styles.searchEntryLabel}>{t('searchSessionsPlaceholder')}</span>
        </button>
      )}
      {editing ? null : (
        <button
          type="button"
          className={styles.newChat}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
      )}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                  selectable={editing}
                  selected={selected.has(session.id)}
                  onToggleSelect={() => toggleSelected(session.id)}
                  onPin={() => void pinSession(session.id, !session.pinned)}
                  onMultiSelect={() => {
                    setEditing(true)
                    setSelected(new Set([session.id]))
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        {editing ? (
          <div className={styles.actionBar}>
            <button
              type="button"
              className={styles.actionButton}
              disabled={selectedIds.length === 0}
              onClick={async () => {
                await pinSessions(selectedIds, !allPinned)
                exitEditing()
              }}
            >
              <IconPinOutline16 />
              <span>{allPinned ? t('unpin') : t('pin')}</span>
            </button>
            <span className={styles.actionDivider} />
            <button
              type="button"
              className={clsx(styles.actionButton, styles.actionDanger)}
              disabled={selectedIds.length === 0}
              onClick={() => setBulkDeleting(true)}
            >
              <IconTrashOutline16 />
              <span>{t('delete')}</span>
            </button>
          </div>
        ) : (
          <button type="button" className={styles.account} onClick={() => openSettings('general')}>
            <span className={styles.accountAvatar}>
              {apiKey ? <IconPersonOutline20 /> : <IconSettingsOutline16 />}
            </span>
            <span className={styles.accountName}>
              {apiKey ? maskApiKey(apiKey) : t('settings')}
            </span>
            {balanceLabel ? <span className={styles.accountBalance}>{balanceLabel}</span> : null}
          </button>
        )}
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {bulkDeleting ? (
        <Modal
          title={t('deleteSessionsConfirmTitle')}
          onClose={() => {
            if (!deletePending) {
              setBulkDeleting(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={deletePending}
                onClick={() => setBulkDeleting(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    await removeSessions(selectedIds)
                    setBulkDeleting(false)
                    exitEditing()
                  } catch {
                    showToast({ key: 'sessionDeleteFailed', type: 'error' })
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionsConfirmDescription', { count: selectedIds.length })}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：跟手位移，点遮罩或左滑关闭 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const swipe = useRef({ active: false, startX: 0, startY: 0, offset: 0 })
  useAndroidBackHandler(open, closeMobileSider)

  // 挂载后滑入到位；手势打开的场合交给手指控制，不要抢位移。
  // 只在 open 变化时跑一次，dragging 随后变 false 也不会重播。
  useEffect(() => {
    if (!open) {
      return
    }
    if (!useMobileSider.getState().dragging) {
      openDrawerOffset()
    }
    return () => resetDrawerOffset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) {
    return null
  }

  /** 松手或手势被系统打断时的吸附判定 */
  function finishSwipe() {
    if (!swipe.current.active) {
      return
    }
    swipe.current.active = false
    // 收起过半才真的关闭，否则回弹到全开
    if (swipe.current.offset <= drawerWidth() * OPEN_THRESHOLD) {
      closeMobileSider()
    } else {
      openDrawerOffset()
    }
  }

  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div
        className={styles.drawer}
        onTouchStart={(event) => {
          const touch = event.touches[0]
          swipe.current = {
            active: true,
            startX: touch.clientX,
            startY: touch.clientY,
            offset: drawerWidth(),
          }
        }}
        onTouchMove={(event) => {
          if (!swipe.current.active) {
            return
          }
          const touch = event.touches[0]
          const dx = touch.clientX - swipe.current.startX
          const dy = Math.abs(touch.clientY - swipe.current.startY)
          if (dy > 36 && dy > Math.abs(dx)) {
            return
          }
          // 左滑同样带阻尼：拖得越远收敛越慢
          const progress = 1 - rubberProgress(-dx, drawerWidth())
          const offset = progress * drawerWidth()
          swipe.current.offset = offset
          setDrawerOffset(offset, false)
        }}
        onTouchEnd={finishSwipe}
        onTouchCancel={finishSwipe}
      >
        <Sider mobile />
      </div>
    </>
  )
}
