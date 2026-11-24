import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from './Modal.js'
import styles from './TextEditPage.module.css'

/**
 * 整屏文本编辑页（笔记 / AI 回答共用）。
 *
 * 为什么要整页：这些文本动辄上千字，塞在列表里两行高的输入框里，光标一进去就被截断，
 * 键盘弹起来更是看不见自己写到哪。整页 = 正文铺满 + 底部固定取消/保存 + 实时字数。
 */
export const TextEditPage = ({
  title,
  initial,
  placeholder,
  onSave,
  secondaryLabel,
  onSecondary,
  onClose,
}: {
  title: string
  initial: string
  placeholder?: string
  onSave: (next: string) => void
  /** 可选的第二个动作（例如「保存并发送」）；不给就只显示保存 */
  secondaryLabel?: string
  onSecondary?: (next: string) => void
  onClose: () => void
}) => {
  const t = useTranslate()
  const [draft, setDraft] = useState(initial)

  return (
    <Modal
      title={<span className={styles.panelTitle}>{title}</span>}
      overlayClassName={styles.overlay}
      className={styles.dialog}
      mainClassName={styles.body}
      closable
      onClose={onClose}
      footer={
        <div className={styles.footerRow}>
          <span className={styles.counter}>{t('charCount', { chars: draft.length })}</span>
          <button type="button" className={styles.cancel} onClick={onClose}>
            {t('cancel')}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              className={styles.cancel}
              disabled={!draft.trim()}
              onClick={() => onSecondary(draft)}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.save}
            disabled={!draft.trim()}
            onClick={() => onSave(draft)}
          >
            {t('memorySave')}
          </button>
        </div>
      }
    >
      <textarea
        className={styles.textarea}
        value={draft}
        autoFocus
        {...(placeholder ? { placeholder } : {})}
        onChange={(event) => setDraft(event.target.value)}
      />
    </Modal>
  )
}
