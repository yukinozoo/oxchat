import { useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { OptionFold } from './OptionFold.js'
import styles from './WebsiteImport.module.css'

/**
 * 导出前选择对话：默认全选，可搜索、可只导出部分。
 * 确认后把选中的 id 集合交给导出流程。
 */
/** 导出格式：整包备份（官方 ZIP）或可读文本 */
export type ExportFormat = 'zip' | 'txt'

export type ExportChoice = {
  includeImages: boolean
  format: ExportFormat
  includeThinking: boolean
  /** 是否附带记忆 / 角色卡 / 置顶 / 墓碑等附加数据（默认带，关掉只导对话本身） */
  includeExtras: boolean
}

export const ExportSelectDialog = ({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (ids: Set<string>, choice: ExportChoice) => void
}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const sessionCache = useChatStore((state) => state.sessionCache)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sessions.map((session) => session.id))
  )
  const [keyword, setKeyword] = useState('')
  /** 「不包含图片原件」默认不勾选，保持原来的导出内容 */
  const [withoutImages, setWithoutImages] = useState(false)
  /** 「同时导出 OxChat 特有数据」默认不勾：不勾就是纯 DeepSeek 官方格式 */
  const [withExtras, setWithExtras] = useState(false)
  /** 格式：ZIP 备份（默认）或 TXT 文本 */
  const [format, setFormat] = useState<ExportFormat>('zip')
  /** TXT 是否带思考过程（默认不带） */
  const [includeThinking, setIncludeThinking] = useState(false)
  /** 收起时的状态摘要：格式 + 当前已选中的附加项（不勾附加数据就是纯官方格式，不占摘要） */
  const optionsSummary = [
    t(format === 'zip' ? 'exportFormatZip' : 'exportFormatTxt'),
    format === 'zip' && withoutImages ? t('exportWithoutImages') : null,
    format === 'zip' && withExtras ? t('exportWithExtras') : null,
    format === 'txt' && includeThinking ? t('exportIncludeThinking') : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const titleOf = (session: (typeof sessions)[number]) => session.title || t('newChat')
  /** 消息数只在会话详情已缓存时才知道；没缓存就只显示日期 */
  const countOf = (id: string): number | null => {
    const cached = Object.hasOwn(sessionCache, id) ? sessionCache[id] : undefined
    return cached ? cached.messages.length : null
  }
  const dateOf = (timestamp: number): string => {
    const date = new Date(timestamp)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
  const filtered = sessions.filter((session) => {
    const text = keyword.trim().toLowerCase()
    if (!text) {
      return true
    }
    return `${titleOf(session)} ${dateOf(session.updatedAt)}`.toLowerCase().includes(text)
  })
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
      className={clsx(styles.dialog, styles.dialogFill)}
      overlayClassName={styles.overlay}
      mainClassName={clsx(styles.body, styles.bodyFill)}
      closable
      onClose={onClose}
      footer={
        <div className={styles.footerGrid}>
          <div className={styles.footerButtons}>
            <Button variant="outlined" size="m" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              size="m"
              disabled={selected.size === 0}
              onClick={() =>
                onConfirm(selected, {
                  includeImages: !withoutImages,
                  format,
                  includeThinking,
                  includeExtras: withExtras,
                })
              }
            >
              {t('exportSelectedCount', { count: selected.size })}
            </Button>
          </div>
        </div>
      }
    >
      <p className={styles.lead}>{t('exportSelectLead')}</p>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          value={keyword}
          placeholder={t('archiveSearchPlaceholder')}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <div className={styles.bulkRow}>
        <button type="button" className={styles.checkAll} onClick={toggleAll}>
          {allChecked ? t('unselectAll') : t('selectAll')}
        </button>
        <span className={styles.totalCount}>
          {t('archiveCountTotal', { count: sessions.length })}
        </span>
      </div>
      <div className={styles.listCard}>
        {filtered.map((session) => {
          const count = countOf(session.id)
          return (
            <label key={session.id} className={styles.listItem}>
              <input
                type="checkbox"
                checked={selected.has(session.id)}
                onChange={() => toggle(session.id)}
              />
              <span className={styles.listMain}>
                <span className={styles.listTitle}>{titleOf(session)}</span>
                <span className={styles.listMeta}>
                  {count === null
                    ? t('exportItemMetaDate', { date: dateOf(session.updatedAt) })
                    : t('exportItemMeta', {
                        count,
                        date: dateOf(session.updatedAt),
                      })}
                </span>
              </span>
            </label>
          )
        })}
        {filtered.length === 0 ? <div className={styles.empty}>{t('websiteEmpty')}</div> : null}
      </div>
      <OptionFold title={t('exportOptionsTitle')} summary={optionsSummary}>
        <div className={styles.row} role="radiogroup" aria-label={t('exportFormat')}>
          <button
            type="button"
            role="radio"
            aria-checked={format === 'zip'}
            className={styles.checkAll}
            onClick={() => setFormat('zip')}
          >
            {format === 'zip' ? '● ' : '○ '}
            {t('exportFormatZip')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={format === 'txt'}
            className={styles.checkAll}
            onClick={() => setFormat('txt')}
          >
            {format === 'txt' ? '● ' : '○ '}
            {t('exportFormatTxt')}
          </button>
        </div>
        {format === 'txt' ? (
          <label className={styles.skip}>
            <input
              type="checkbox"
              className={styles.skipCheck}
              checked={includeThinking}
              onChange={() => setIncludeThinking((value) => !value)}
            />
            <span className={styles.skipText}>
              <span className={styles.skipTitle}>{t('exportIncludeThinking')}</span>
            </span>
          </label>
        ) : null}
        {format === 'zip' ? (
          <label className={styles.skip}>
            <input
              type="checkbox"
              className={styles.skipCheck}
              checked={withoutImages}
              onChange={() => setWithoutImages((value) => !value)}
            />
            <span className={styles.skipText}>
              <span className={styles.skipTitle}>{t('exportWithoutImages')}</span>
              <span className={styles.skipDesc}>{t('exportWithoutImagesDesc')}</span>
            </span>
          </label>
        ) : null}
        {format === 'zip' ? (
          <label className={styles.skip}>
            <input
              type="checkbox"
              className={styles.skipCheck}
              checked={withExtras}
              onChange={() => setWithExtras((value) => !value)}
            />
            <span className={styles.skipText}>
              <span className={styles.skipTitle}>{t('exportIncludeExtras')}</span>
              <span className={styles.skipDesc}>{t('exportIncludeExtrasDesc')}</span>
            </span>
          </label>
        ) : null}
      </OptionFold>
    </Modal>
  )
}
