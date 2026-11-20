import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderOutline16,
  IconMultiSelectOutline16,
  IconPinOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  selectable = false,
  selected = false,
  onToggleSelect,
  onPin,
  onMultiSelect,
  onMove,
  onExport,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
  /** 长按菜单：置顶 / 取消置顶 */
  onPin?: () => void
  /** 长按菜单：进入多选并选中本条 */
  onMultiSelect?: () => void
  /** 长按菜单：移动到分组 */
  onMove?: () => void
  /** 长按菜单：导出这一条对话 */
  onExport?: () => void
  /** 选择模式下整行变成勾选，不再跳转会话 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  /** 长按打开的操作菜单 */
  const [menuOpen, setMenuOpen] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 长按后紧跟的 click 要吞掉，避免同时跳转会话 */
  const suppressClick = useRef(false)

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  // 组件卸载时清掉未触发的长按计时器
  useEffect(() => clearPress, [])

  const onPressStart = () => {
    if (selectable) {
      return
    }
    clearPress()
    pressTimer.current = setTimeout(() => {
      suppressClick.current = true
      setMenuOpen(true)
    }, 480)
  }
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        enterKeyHint="done"
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(
        styles.item,
        active && !selectable && styles.active,
        selected && styles.selected
      )}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        if (selectable) {
          onToggleSelect?.()
          return
        }
        selectSession(session.id)
        closeMobileSider()
      }}
      onTouchStart={onPressStart}
      onTouchMove={clearPress}
      onTouchEnd={clearPress}
      onTouchCancel={clearPress}
      onContextMenu={(event) => {
        // 桌面右键也走同一个菜单
        event.preventDefault()
        if (!selectable) {
          setMenuOpen(true)
        }
      }}
    >
      {selectable ? (
        <span className={clsx(styles.checkbox, selected && styles.checkboxChecked)} aria-hidden>
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      {session.pinned && !selectable ? (
        <span className={styles.pin}>
          <IconPinOutline16 />
        </span>
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      {selectable ? null : (
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            options={[
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              ...(onPin
                ? [
                    {
                      key: 'pin',
                      label: session.pinned ? t('unpin') : t('pin'),
                      icon: <IconPinOutline16 />,
                      onSelect: onPin,
                    },
                  ]
                : []),
              ...(onMultiSelect
                ? [
                    {
                      key: 'multi',
                      label: t('sessionItemMenuMultiSelect'),
                      icon: <IconMultiSelectOutline16 />,
                      onSelect: onMultiSelect,
                    },
                  ]
                : []),
              ...(onMove
                ? [
                    {
                      key: 'move',
                      label: t('folderMove'),
                      icon: <IconFolderOutline16 />,
                      onSelect: onMove,
                    },
                  ]
                : []),
              ...(onExport
                ? [
                    {
                      key: 'export',
                      label: t('sessionItemMenuExport'),
                      icon: <IconDownloadOutline16 />,
                      onSelect: onExport,
                    },
                  ]
                : []),
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton
                icon={<IconEllipsisOutline16 />}
                aria-label={t('more')}
                onClick={toggle}
              />
            )}
          </Menu>
        </div>
      )}
    </div>
  )
})
