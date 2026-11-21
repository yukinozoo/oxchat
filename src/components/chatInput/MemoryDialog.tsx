import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  saveMemoryNotes,
  unfoldMemory,
  useChatStore,
} from '../../services/chat/store.js'
import { createId } from '../../utils/id.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './MemoryDialog.module.css'

/**
 * 长期记忆面板：列出折叠后的笔记，可手改、删除、新增；
 * 也能一键恢复全部上下文（消息一直都在，恢复后重新进入请求）。
 */
export const MemoryDialog = ({ sessionId, onClose }: { sessionId: string; onClose: () => void }) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    Object.hasOwn(state.sessionCache, sessionId) ? state.sessionCache[sessionId] : undefined
  )
  const memory = session?.memory
  const notes = memory?.notes ?? []
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [newText, setNewText] = useState('')

  const commitEdit = () => {
    const text = draft.trim()
    if (!editingId || !text) {
      setEditingId(null)
      return
    }
    saveMemoryNotes(
      sessionId,
      notes.map((note) =>
        note.id === editingId ? { ...note, text, edited: true } : note
      )
    )
    setEditingId(null)
    setDraft('')
  }

  const remove = (id: string) => {
    saveMemoryNotes(
      sessionId,
      notes.filter((note) => note.id !== id)
    )
  }

  const add = () => {
    const text = newText.trim()
    if (!text) {
      return
    }
    saveMemoryNotes(sessionId, [
      { id: createId(), text, edited: true, createdAt: Date.now() },
      ...notes,
    ])
    setNewText('')
  }

  return (
    <Modal
      title={t('memoryTitle')}
      closable
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              showToast({ key: unfoldMemory(sessionId) ? 'memoryUnfoldDone' : 'memoryUnfoldEmpty' })
            }}
          >
            {t('memoryUnfold')}
          </Button>
          <Button size="m" onClick={onClose}>
            {t('close')}
          </Button>
        </>
      }
    >
      {memory ? (
        <p className={styles.summary}>
          {t('memorySummary', { rounds: memory.foldedRounds, notes: notes.length })}
        </p>
      ) : null}
      {notes.length === 0 ? <p className={styles.empty}>{t('memoryEmpty')}</p> : null}
      <div className={styles.list}>
        {notes.map((note) => (
          <div key={note.id} className={styles.note}>
            {editingId === note.id ? (
              <>
                <textarea
                  className={styles.input}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                />
                <div className={styles.actions}>
                  <Button variant="outlined" size="s" onClick={() => setEditingId(null)}>
                    {t('cancel')}
                  </Button>
                  <Button size="s" onClick={commitEdit}>
                    {t('memorySave')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.text}>{note.text}</p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => {
                      setEditingId(note.id)
                      setDraft(note.text)
                    }}
                  >
                    {t('memoryEdit')}
                  </button>
                  <button type="button" className={styles.danger} onClick={() => remove(note.id)}>
                    {t('delete')}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className={styles.addRow}>
        <textarea
          className={styles.input}
          value={newText}
          placeholder={t('memoryAddPlaceholder')}
          onChange={(event) => setNewText(event.target.value)}
          rows={2}
        />
        <Button variant="outlined" size="s" disabled={!newText.trim()} onClick={add}>
          {t('memoryAdd')}
        </Button>
      </div>
    </Modal>
  )
}
