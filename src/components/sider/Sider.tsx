import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconPersonOutline20,
  IconEditOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconFolderOutline16,
  IconFolderPlusOutline16,
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
import { Menu } from '../base/Menu.js'
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
import {
  assignSessionFolder,
  createFolder,
  pruneAssignments,
  removeFolder,
  renameFolder,
  toggleFolder,
  useFolders,
  type SessionFolder,
} from '../../services/chat/folders.js'
import { SessionSearch } from './SessionSearch.js'
import { closeSessionSearch, openSessionSearch, useSessionSearch } from './sessionSearchState.js'
import styles from './Sider.module.css'

/** 首屏挂载的会话条数与每次续载条数：几千条会话全量挂载会把低端机拖到个位数帧率 */
const SIDER_PAGE = 60
/** 距列表底部小于该值时续载下一批 */
const SIDER_LOAD_THRESHOLD = 320

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  /** 已发放的渲染配额：置顶 → 分组 → 未分组按顺序消耗，滚到底部再续一页 */
  const [limit, setLimit] = useState(SIDER_PAGE)
  const listRef = useRef<HTMLDivElement>(null)
  /** 滚动回调里读最新配额与「还有没有更多」，避免重复续载 */
  const limitRef = useRef(limit)
  limitRef.current = limit
  /** 分组相关的浮层状态 */
  const folders = useFolders((state) => state.folders)
  const assignments = useFolders((state) => state.assignments)
  const collapsed = useFolders((state) => state.collapsed)
  const [folderMenu, setFolderMenu] = useState<string | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<
    { mode: 'create'; name: string } | { mode: 'rename'; id: string; name: string } | null
  >(null)
  const [folderDelete, setFolderDelete] = useState<SessionFolder | null>(null)
  const [moving, setMoving] = useState<SessionSummary | null>(null)
  /** 未分组会话按时间分组（置顶与已归组的会话不重复出现） */
  const ungrouped = useMemo(
    () => groupSessions(sessions.filter((item) => !item.pinned && !assignments[item.id]), now, t),
    [sessions, now, t, assignments]
  )
  const pinned = useMemo(() => sessions.filter((item) => item.pinned), [sessions])
  const folderSessions = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      const folderId = assignments[session.id]
      if (!folderId || session.pinned) {
        continue
      }
      const list = map.get(folderId) ?? []
      list.push(session)
      map.set(folderId, list)
    }
    return map
  }, [sessions, assignments])

  const chatReady = useChatStore((state) => state.ready)
  const importing = useChatStore((state) => state.importingHistory)
  // 会话被删除后清掉指向它的分组映射；会话还没加载完或正在换历史时一律不动
  useEffect(() => {
    if (!chatReady || importing) {
      return
    }
    pruneAssignments(new Set(sessions.map((session) => session.id)))
  }, [sessions, chatReady, importing])

  /**
   * 按顺序分发渲染配额：置顶 → 各分组（展开的）→ 未分组的时间组。
   * 全选/搜索/分组计数一律用全量 sessions，只有 DOM 节点数受配额限制。
   * 会话总量变少（删除、切库）时把配额收回到当前需要的最小值。
   */
  const views = useMemo(() => {
    let left = limit
    const take = <T,>(list: T[]): T[] => {
      if (left <= 0) {
        return []
      }
      const slice = list.slice(0, left)
      left -= slice.length
      return slice
    }
    const pinnedView = take(pinned)
    const folderViews = folders.map((folder) => {
      const items = folderSessions.get(folder.id) ?? []
      const folded = Boolean(collapsed[folder.id])
      return { folder, items: folded ? [] : take(items), folded, total: items.length }
    })
    const groupViews = ungrouped.map((group) => ({
      key: group.key,
      label: group.label,
      sessions: take(group.sessions),
      total: group.sessions.length,
    }))
    const shown =
      pinnedView.length +
      folderViews.reduce((sum, item) => sum + item.items.length, 0) +
      groupViews.reduce((sum, item) => sum + item.sessions.length, 0)
    const total =
      pinned.length +
      folderViews.reduce((sum, item) => sum + (item.folded ? 0 : item.total), 0) +
      groupViews.reduce((sum, item) => sum + item.total, 0)
    return { pinnedView, folderViews, groupViews, shown, total, hasMore: shown < total }
  }, [limit, pinned, folders, folderSessions, collapsed, ungrouped])
  const hasMoreRef = useRef(views.hasMore)
  hasMoreRef.current = views.hasMore

  /** 滚到底部附近续一页；内容不足一屏时也自动补齐，避免首屏只剩几十条 */
  useEffect(() => {
    const element = listRef.current
    if (!element) {
      return
    }
    const grow = () => {
      if (!hasMoreRef.current) {
        return
      }
      if (element.scrollHeight - element.scrollTop - element.clientHeight < SIDER_LOAD_THRESHOLD) {
        setLimit((current) => current + SIDER_PAGE)
      }
    }
    element.addEventListener('scroll', grow, { passive: true })
    return () => element.removeEventListener('scroll', grow)
  }, [])

  /** 列表首屏铺不满时继续补一页（最多补到内容超过一屏） */
  useEffect(() => {
    if (!views.hasMore) {
      return
    }
    const element = listRef.current
    // clientHeight 为 0（隐藏/动画中）时不判断，等真实布局出来再说
    if (element && element.clientHeight > 0 && element.scrollHeight <= element.clientHeight + 8) {
      setLimit((current) => current + SIDER_PAGE)
    }
  }, [views.hasMore, views.shown, limit])
  // 搜索界面状态放在全局：手机端抽屉关闭会卸载整棵侧栏，回来时要还在搜索结果上
  const searching = useSessionSearch((state) => state.active)
  useAndroidBackHandler(mobile && searching, closeSessionSearch)
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

  /** 分组头长按计时器 */
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
      }
    },
    []
  )

  const renderSession = (session: SessionSummary) => (
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
      onMove={() => setMoving(session)}
    />
  )

  if (searching) {
    // 搜索是独立界面：不再渲染侧边栏列表，避免两层内容叠在一起
    return (
      <div className={clsx(styles.sider, mobile && styles.mobile)}>
        <SessionSearch onBack={closeSessionSearch} />
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
        <button type="button" className={styles.searchEntry} onClick={openSessionSearch}>
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
        <div ref={listRef} className={styles.list}>
          {editing ? null : (
            <button
              type="button"
              className={styles.newFolder}
              onClick={() => setFolderPrompt({ mode: 'create', name: '' })}
            >
              <IconFolderPlusOutline16 />
              <span>{t('folderNew')}</span>
            </button>
          )}
          {views.pinnedView.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>{t('pinnedSessions')}</div>
              {views.pinnedView.map((session) => renderSession(session))}
            </div>
          ) : null}
          {views.folderViews.map(({ folder, items, folded: isCollapsed, total }) => {
            return (
              <div key={folder.id} className={styles.section}>
                <Menu
                  open={folderMenu === folder.id}
                  onOpenChange={(open) => setFolderMenu(open ? folder.id : null)}
                  options={[
                    {
                      key: 'rename',
                      label: t('folderRename'),
                      icon: <IconEditOutline16 />,
                      onSelect: () =>
                        setFolderPrompt({ mode: 'rename', id: folder.id, name: folder.name }),
                    },
                    {
                      key: 'delete',
                      label: t('delete'),
                      icon: <IconTrashOutline16 />,
                      danger: true,
                      onSelect: () => setFolderDelete(folder),
                    },
                  ]}
                >
                  {() => (
                    <div
                      className={styles.folderRow}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleFolder(folder.id)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setFolderMenu(folder.id)
                      }}
                      onTouchStart={() => {
                        const timer = setTimeout(() => setFolderMenu(folder.id), 480)
                        longPressTimer.current = timer
                      }}
                      onTouchEnd={() => {
                        if (longPressTimer.current) {
                          clearTimeout(longPressTimer.current)
                          longPressTimer.current = null
                        }
                      }}
                      onTouchMove={() => {
                        if (longPressTimer.current) {
                          clearTimeout(longPressTimer.current)
                          longPressTimer.current = null
                        }
                      }}
                    >
                      <span className={styles.folderIcon}>
                        <IconFolderOutline16 />
                      </span>
                      <span className={styles.folderName}>{folder.name}</span>
                      <span className={styles.folderCount}>{total}</span>
                      <span
                        className={clsx(styles.folderChevron, isCollapsed && styles.folderChevronFolded)}
                      >
                        <IconChevronDownOutline14 />
                      </span>
                    </div>
                  )}
                </Menu>
                {isCollapsed ? null : items.length > 0 ? (
                  items.map((session) => renderSession(session))
                ) : (
                  <div className={styles.folderEmpty}>{t('folderEmpty')}</div>
                )}
              </div>
            )
          })}
          {views.groupViews.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => renderSession(session))}
            </div>
          ))}
          {views.hasMore ? (
            <button
              type="button"
              className={styles.loadMore}
              // 滚动到底部会自动续载；这个按钮是给「滚不到底 / 辅助功能」的兜底
              onClick={() => setLimit((current) => current + SIDER_PAGE)}
            >
              {t('siderLoadMore', { count: views.total - views.shown })}
            </button>
          ) : null}
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
      {folderPrompt ? (
        <Modal
          title={folderPrompt.mode === 'create' ? t('folderNew') : t('folderRename')}
          onClose={() => setFolderPrompt(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setFolderPrompt(null)}>
                {t('cancel')}
              </Button>
              <Button
                disabled={!folderPrompt.name.trim()}
                onClick={() => {
                  if (folderPrompt.mode === 'create') {
                    createFolder(folderPrompt.name)
                  } else {
                    renameFolder(folderPrompt.id, folderPrompt.name)
                  }
                  setFolderPrompt(null)
                }}
              >
                {t('confirm')}
              </Button>
            </>
          }
        >
          <input
            className={styles.folderInput}
            autoFocus
            value={folderPrompt.name}
            placeholder={t('folderNamePlaceholder')}
            aria-label={t('folderNamePlaceholder')}
            onChange={(event) =>
              setFolderPrompt((current) => (current ? { ...current, name: event.target.value } : current))
            }
            onKeyDown={(event) => {
              // 输入法组词中的回车是选候选词，不提交
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && folderPrompt.name.trim()) {
                event.preventDefault()
                if (folderPrompt.mode === 'create') {
                  createFolder(folderPrompt.name)
                } else {
                  renameFolder(folderPrompt.id, folderPrompt.name)
                }
                setFolderPrompt(null)
              }
            }}
          />
        </Modal>
      ) : null}
      {folderDelete ? (
        <Modal
          title={t('folderDeleteTitle')}
          onClose={() => setFolderDelete(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setFolderDelete(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeFolder(folderDelete.id)
                  showToast({ key: 'folderDeleted' })
                  setFolderDelete(null)
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('folderDeleteDesc')}
        </Modal>
      ) : null}
      {moving ? (
        <Modal
          title={t('folderMoveTitle')}
          onClose={() => setMoving(null)}
          footer={
            <Button variant="outlined" onClick={() => setMoving(null)}>
              {t('cancel')}
            </Button>
          }
        >
          <div className={styles.folderPicker}>
            <button
              type="button"
              className={clsx(
                styles.folderPickerRow,
                !assignments[moving.id] && styles.folderPickerRowActive
              )}
              onClick={() => {
                assignSessionFolder(moving.id, null)
                setMoving(null)
              }}
            >
              {t('folderUngrouped')}
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={clsx(
                  styles.folderPickerRow,
                  assignments[moving.id] === folder.id && styles.folderPickerRowActive
                )}
                onClick={() => {
                  assignSessionFolder(moving.id, folder.id)
                  setMoving(null)
                }}
              >
                {folder.name}
              </button>
            ))}
          </div>
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
