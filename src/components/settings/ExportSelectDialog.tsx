import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './WebsiteImport.module.css'

/**
 * 导出前选择对话：默认全选，可搜索、可只导出部分。
 * 确认后把选中的 id 集合交给导出流程。
 */
export const ExportSelectDialog = ({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (ids: Set<string>, includeImages: boolean) => void
}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sessions.map((session) => session.id))
  )
  const [keyword, setKeyword] = useState('')
  /** 「不包含图片原件」默认不勾选，保持原来的导出内容 */
  const [withoutImages, setWithoutImages] = useState(false)

  const titleOf = (session: (typeof sessions)[number]) => session.title || t('newChat')
  const filtered = sessions.filter(
    (session) => !keyword.trim() || titleOf(session).toLowerCase().includes(keyword.trim().toLowerCase())
  )
  const allChecked = filtered.length > 0 && filtered.every((session) => selected.has(session.id))

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (allChecked) {
        for (const session of filtered) {
          next.delete(session.id)
        }
      } else {
        for (const session of filtered) {
          next.add(session.id)
        }
      }
      return next
    })
  }

  return (
    <Modal
      title={t('exportSelectTitle')}
      className={styles.dialog}
      overlayClassName={styles.overlay}
      closable
      onClose={onClose}
      footer={
        <div className={styles.actions}>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            size="m"
            disabled={selected.size === 0}
            onClick={() => onConfirm(selected, !withoutImages)}
          >
            {t('exportSelectConfirm', { count: selected.size })}
          </Button>
        </div>
      }
    >
      <p className={styles.lead}>{t('exportSelectLead')}</p>
      <div className={styles.row}>
        <button type="button" className={styles.checkAll} onClick={toggleAll}>
          {allChecked ? t('unselectAll') : t('selectAll')}
        </button>
        <input
          className={styles.search}
          value={keyword}
          placeholder={t('websiteSearch')}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <div className={styles.list}>
        {filtered.map((session) => (
          <label key={session.id} className={styles.item}>
            <input
              type="checkbox"
              checked={selected.has(session.id)}
              onChange={() => toggle(session.id)}
            />
            <span className={styles.itemTitle}>{titleOf(session)}</span>
          </label>
        ))}
        {filtered.length === 0 ? <div className={styles.empty}>{t('websiteEmpty')}</div> : null}
      </div>
      <label className={styles.skip}>
        <input
          type="checkbox"
          className={styles.skipCheck}
          checked={withoutImages}
          onChange={() => setWithoutImages((value) => !value)}
        />
        <span className={styles.skipText}>
          <span className={styles.skipTitle}>{t('exportWithoutImages')}</span>
        </span>
      </label>
    </Modal>
  )
}
