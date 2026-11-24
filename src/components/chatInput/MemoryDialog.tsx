import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  generateMemoryNote,
  removeAttachmentMemory,
  saveAttachmentMemory,
  saveMemoryNotes,
  unfoldMemory,
  useChatStore,
} from '../../services/chat/store.js'
import { noteSource, renderMemorySection, SUMMARY_SECTION_CAP } from '../../services/chat/memory.js'
import { ScrollPane } from '../base/ScrollPane.js'
import { createId } from '../../utils/id.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { MemoryNoteEditor } from './MemoryNoteEditor.js'
import styles from './MemoryDialog.module.css'

/**
 * 长期记忆面板：列出折叠后的笔记，可手改、删除、新增；
 * 也能一键恢复全部上下文（消息一直都在，恢复后重新进入请求）。
 */
export const MemoryDialog = ({
  sessionId,
  overlayClassName,
  onClose,
}: {
  sessionId: string
  /** 遮罩层 class：从更上层的弹窗里打开时要抬层级，否则会被盖住 */
  overlayClassName?: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    Object.hasOwn(state.sessionCache, sessionId) ? state.sessionCache[sessionId] : undefined
  )
  const memory = session?.memory
  const notes = memory?.notes ?? []
  /** 独立资料记忆：整理时从附件提炼，单独保存，不被覆盖式整理冲掉 */
  const attachments = memory?.attachments ?? []
  /** 正在整屏编辑的笔记（id + 原文）；长笔记在列表里改不动 */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  /** 正在整屏编辑的资料记忆 */
  const [editingAttachment, setEditingAttachment] = useState<{ id: string; text: string } | null>(
    null
  )
  /** 展开的资料记忆（长摘要默认折起来） */
  const [expandedAttachments, setExpandedAttachments] = useState<Set<string>>(new Set())
  const [newText, setNewText] = useState('')
  /** 正在让模型写笔记 */
  const [generating, setGenerating] = useState(false)
  /** 展开的长笔记（默认折叠：一条 1000 字的提要会把列表撑得没法看） */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** 「注入预览」：原样展示这次会拼进 system 的记忆段落 */
  const [previewOpen, setPreviewOpen] = useState(false)
  const preview = session ? renderMemorySection(session) : ''

  /** 整屏编辑页保存：改过的笔记转成 manual（整理时不再被替换掉） */
  const saveEditedNote = (text: string) => {
    if (!editing) {
      return
    }
    const next = text.trim()
    if (!next) {
      return
    }
    saveMemoryNotes(
      sessionId,
      notes.map((note) =>
        note.id === editing.id ? { ...note, text: next, edited: true, source: 'manual' as const } : note
      )
    )
    setEditing(null)
  }

  const toggleExpand = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  /** 导出笔记 JSON：纯本地生成，不涉及备份链路 */
  const exportNotes = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      foldedRounds: memory?.foldedRounds ?? 0,
      notes: notes.map((note) => ({
        text: note.text,
        source: noteSource(note),
        createdAt: note.createdAt,
      })),
      attachments: attachments.map((item) => ({
        name: item.name,
        summary: item.summary,
        createdAt: item.createdAt,
      })),
    }
    const blob = new Blob(
      [JSON.stringify({ sessionId, title: session?.title ?? '', ...payload }, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `oxchat-notes-${sessionId}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showToast({ key: 'memoryExportDone' })
  }

  /** 把最近一段对话压成一条手写来源的笔记（不折叠、不动已有笔记） */
  const writeNote = async () => {
    setGenerating(true)
    const result = await generateMemoryNote(sessionId)
    setGenerating(false)
    if (result.status === 'done') {
      showToast({ key: 'memoryNoteDone' })
    } else if (result.status === 'short') {
      showToast({ key: 'memoryNoteShort' })
    } else if (result.status === 'busy') {
      showToast({ key: 'memoryNoteBusy' })
    } else if (result.status === 'error') {
      showToast(result.message ?? t('memoryNoteFailed'))
    }
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
      { id: createId(), text, edited: true, source: 'manual' as const, createdAt: Date.now() },
      ...notes,
    ])
    setNewText('')
  }

  return (
    <Modal
      title={<span className={styles.panelTitle}>{t('memoryTitle')}</span>}
      overlayClassName={overlayClassName}
      className={styles.dialog}
      mainClassName={styles.body}
      closable
      onClose={onClose}
      footer={
        <div className={styles.footerRow}>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              showToast({ key: unfoldMemory(sessionId) ? 'memoryUnfoldDone' : 'memoryUnfoldEmpty' })
            }}
          >
            {t('memoryUnfold')}
          </Button>
          {notes.length > 0 ? (
            <Button variant="outlined" size="m" onClick={exportNotes}>
              {t('memoryExportNotes')}
            </Button>
          ) : null}
          <Button size="m" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
      }
    >
      {memory ? (
        <div className={styles.summaryRow}>
          <p className={styles.summary}>
            {t('memorySummary', { rounds: memory.foldedRounds, notes: notes.length })}
          </p>
          {preview ? (
            <button
              type="button"
              className={styles.previewToggle}
              aria-expanded={previewOpen}
              onClick={() => setPreviewOpen((value) => !value)}
            >
              {previewOpen ? t('memoryPreviewHide') : t('memoryPreviewShow')}
            </button>
          ) : null}
        </div>
      ) : null}
      {previewOpen && preview ? (
        <div className={styles.preview}>
          <div className={styles.previewMeta}>
            {t('memoryPreviewCount', { chars: preview.length, cap: SUMMARY_SECTION_CAP })}
          </div>
          <pre className={styles.previewText}>{preview}</pre>
        </div>
      ) : null}
      {notes.length === 0 && attachments.length === 0 ? (
        <p className={styles.empty}>{t('memoryEmpty')}</p>
      ) : null}
      <ScrollPane className={styles.listPane} contentClassName={styles.list}>
        {notes.map((note) => (
          <div key={note.id} className={styles.note}>
            <>
              <div className={styles.noteHead}>
                  <span
                    className={
                      noteSource(note) === 'manual' ? styles.badgeManual : styles.badgeSummary
                    }
                  >
                    {t(noteSource(note) === 'manual' ? 'memoryBadgeManual' : 'memoryBadgeSummary')}
                  </span>
                  {note.disabled ? (
                    <span className={styles.badgeOff}>{t('memoryDisabledBadge')}</span>
                  ) : null}
                </div>
                <p className={styles.text}>
                  {note.text.length > 120 && !expanded.has(note.id)
                    ? `${note.text.slice(0, 120)}…`
                    : note.text}
                </p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => {
                      saveMemoryNotes(
                        sessionId,
                        notes.map((item) =>
                          item.id === note.id ? { ...item, disabled: !item.disabled } : item
                        )
                      )
                    }}
                  >
                    {note.disabled ? t('memoryEnableNote') : t('memoryDisableNote')}
                  </button>
                  {note.text.length > 120 ? (
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => toggleExpand(note.id)}
                    >
                      {t(expanded.has(note.id) ? 'memoryCollapse' : 'memoryExpand')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => setEditing({ id: note.id, text: note.text })}
                  >
                    {t('memoryEdit')}
                  </button>
                  <button type="button" className={styles.danger} onClick={() => remove(note.id)}>
                    {t('delete')}
                </button>
              </div>
            </>
          </div>
        ))}
      </ScrollPane>
      {attachments.length > 0 ? (
        <div className={styles.attachments}>
          <div className={styles.attachmentsHead}>
            <span className={styles.attachmentsTitle}>
              {t('memoryAttachmentsTitle', { count: attachments.length })}
            </span>
          </div>
          <p className={styles.attachmentsHint}>{t('memoryAttachmentsHint')}</p>
          {attachments.map((item) => (
            <div key={item.id} className={styles.note}>
              <div className={styles.noteHead}>
                <span className={styles.badgeAttachment}>{item.name}</span>
              </div>
              <p className={styles.text}>
                {item.summary.length > 120 && !expandedAttachments.has(item.id)
                  ? `${item.summary.slice(0, 120)}…`
                  : item.summary}
              </p>
              <div className={styles.actions}>
                {item.summary.length > 120 ? (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() =>
                      setExpandedAttachments((current) => {
                        const next = new Set(current)
                        if (next.has(item.id)) {
                          next.delete(item.id)
                        } else {
                          next.add(item.id)
                        }
                        return next
                      })
                    }
                  >
                    {t(
                      expandedAttachments.has(item.id)
                        ? 'memoryAttachmentCollapse'
                        : 'memoryAttachmentExpand'
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => setEditingAttachment({ id: item.id, text: item.summary })}
                >
                  {t('memoryEdit')}
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => removeAttachmentMemory(sessionId, item.id)}
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {editing ? (
        <MemoryNoteEditor
          text={editing.text}
          onSave={saveEditedNote}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editingAttachment ? (
        <MemoryNoteEditor
          title={t('memoryAttachmentEditTitle')}
          text={editingAttachment.text}
          onSave={(text) => {
            const next = text.trim()
            if (next) {
              saveAttachmentMemory(sessionId, editingAttachment.id, next)
            }
            setEditingAttachment(null)
          }}
          onClose={() => setEditingAttachment(null)}
        />
      ) : null}
      <div className={styles.addRow}>
        <textarea
          className={styles.input}
          value={newText}
          placeholder={t('memoryAddPlaceholder')}
          onChange={(event) => setNewText(event.target.value)}
          rows={2}
        />
        <div className={styles.addActions}>
          <Button variant="outlined" size="s" disabled={!newText.trim()} onClick={add}>
            {t('memoryAdd')}
          </Button>
          <Button variant="outlined" size="s" disabled={generating} onClick={() => void writeNote()}>
            {t(generating ? 'memoryNoteWriting' : 'memoryNoteGenerate')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
