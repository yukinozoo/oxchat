import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  createCompactTemplate,
  deleteCompactTemplate,
  duplicateCompactTemplate,
  listCompactTemplates,
  resetCompactTemplate,
  updateCompactTemplate,
} from '../../services/chat/compactTemplates.js'
import { setCompactPanel, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './CompactTemplatesPanel.module.css'

/**
 * 摘要模板管理（压缩上下文面板里的「管理」）。
 *
 * 与压缩面板同一套整屏外壳：列表 → 点「编辑」进同名面板的编辑态。
 * - 内置模板可以改（写 overrides），改过之后出现「恢复默认」；
 * - 自定义模板可以新建 / 编辑 / 复制 / 删除；
 * - 删掉的正是当前选中模板时，选择回落到「通用」，避免压缩时找不到提示词。
 */
export const CompactTemplatesPanel = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const activeId = useSettings((state) => state.compactTemplate) || 'general'
  const [templates, setTemplates] = useState(() => listCompactTemplates())
  const [editing, setEditing] = useState<
    | null
    | { id: string | null; name: string; prompt: string; builtin: boolean }
  >(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const refresh = () => setTemplates(listCompactTemplates())

  const startNew = () => {
    setEditing({
      id: null,
      name: '',
      prompt:
        '把这段对话整理成一份能接着用的摘要。\n\n重点是：\n· 现在在做什么\n· 已经确认的事实\n· 还没解决的事\n\n全文控制在 {target_chars} 字以内。',
      builtin: false,
    })
  }

  const startEdit = (id: string) => {
    const template = templates.find((item) => item.id === id)
    if (!template) {
      return
    }
    setEditing({
      id: template.id,
      name: template.name,
      prompt: template.prompt,
      builtin: template.builtin,
    })
  }

  const saveEditing = () => {
    if (!editing) {
      return
    }
    const name = editing.name.trim()
    if (!name) {
      showToast(t('compactTemplateNameRequired'))
      return
    }
    if (editing.id === null) {
      const id = createCompactTemplate(name)
      updateCompactTemplate(id, { prompt: editing.prompt })
    } else {
      updateCompactTemplate(editing.id, { name, prompt: editing.prompt })
    }
    refresh()
    setEditing(null)
    showToast(t('compactTemplateSaved'))
  }

  const remove = (id: string) => {
    if (deleteCompactTemplate(id)) {
      if (activeId === id) {
        setCompactPanel({ compactTemplate: 'general' })
      }
      refresh()
      showToast(t('compactTemplateDeleted'))
    }
    setDeleting(null)
  }

  const duplicate = (id: string) => {
    const next = duplicateCompactTemplate(id)
    if (next) {
      refresh()
      showToast(t('compactTemplateDuplicated'))
    }
  }

  const reset = (id: string) => {
    resetCompactTemplate(id)
    refresh()
    showToast(t('compactTemplateResetDone'))
  }

  const title = editing
    ? editing.id === null
      ? t('compactTemplateNew')
      : t('compactTemplateEditTitle')
    : t('compactTemplatesTitle')

  return (
    <>
      <Modal
        title={<span className={styles.panelTitle}>{title}</span>}
        closable
        overlayClassName={styles.overlay}
        className={styles.dialog}
        mainClassName={styles.body}
        onClose={onClose}
        footer={
          editing ? (
            <>
              <Button
                variant="outlined"
                onClick={() => {
                  setEditing(null)
                }}
              >
                {t('cancel')}
              </Button>
              <Button onClick={saveEditing}>{t('compactTemplateSave')}</Button>
            </>
          ) : (
            <Button variant="outlined" onClick={onClose}>
              {t('close')}
            </Button>
          )
        }
      >
        {editing ? (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('compactTemplateNameLabel')}</span>
              <input
                className={styles.input}
                value={editing.name}
                placeholder={t('compactTemplateNamePlaceholder')}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('compactTemplatePromptLabel')}</span>
              <textarea
                className={styles.textarea}
                value={editing.prompt}
                onChange={(event) => setEditing({ ...editing, prompt: event.target.value })}
              />
            </label>
            <p
              className={
                editing.prompt.includes('{target_chars}')
                  ? styles.hint
                  : `${styles.hint} ${styles.hintWarn}`
              }
            >
              {editing.prompt.includes('{target_chars}')
                ? t('compactTemplatePromptHint')
                : t('compactTemplatePromptNoChars')}
            </p>
            {editing.builtin && editing.id ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  if (editing.id) {
                    reset(editing.id)
                  }
                  setEditing(null)
                }}
              >
                {t('compactTemplateReset')}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.lead}>{t('compactTemplateManageLead')}</p>
            <div className={styles.list}>
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={
                    template.id === activeId
                      ? `${styles.row} ${styles.rowActive}`
                      : styles.row
                  }
                >
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{template.name}</span>
                    {template.id === activeId ? (
                      <span className={`${styles.badge} ${styles.badgeActive}`}>
                        {t('roleInUse')}
                      </span>
                    ) : null}
                    {template.builtin ? (
                      <span className={styles.badge}>{t('compactTemplateBuiltin')}</span>
                    ) : null}
                  </div>
                  <span className={styles.rowHint}>{template.hint}</span>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.action}
                      onClick={() => startEdit(template.id)}
                    >
                      {t('roleEdit')}
                    </button>
                    <button
                      type="button"
                      className={styles.action}
                      onClick={() => duplicate(template.id)}
                    >
                      {t('roleDuplicate')}
                    </button>
                    {template.builtin ? (
                      template.edited ? (
                        <button
                          type="button"
                          className={styles.action}
                          onClick={() => reset(template.id)}
                        >
                          {t('compactTemplateReset')}
                        </button>
                      ) : null
                    ) : (
                      <button
                        type="button"
                        className={`${styles.action} ${styles.actionDanger}`}
                        onClick={() => setDeleting(template.id)}
                      >
                        {t('roleDelete')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className={styles.newButton} onClick={startNew}>
              ＋ {t('compactTemplateNew')}
            </button>
          </>
        )}
      </Modal>

      {deleting ? (
        <Modal
          title={t('compactTemplateDeleteTitle')}
          closable
          overlayClassName={styles.overlay}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" onClick={() => remove(deleting)}>
                {t('roleDelete')}
              </Button>
            </>
          }
        >
          <p className={styles.confirmText}>{t('compactTemplateDeleteDesc')}</p>
        </Modal>
      ) : null}
    </>
  )
}
