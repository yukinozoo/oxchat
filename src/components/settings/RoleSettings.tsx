import { useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  CUSTOM_ROLES_ENABLED,
  characterById,
  characterIdOfSession,
  deleteCharacter,
  duplicateCharacter,
  listCharacters,
} from '../../services/chat/characters.js'
import { useChatStore } from '../../services/chat/store.js'
import { importCharacterCard } from '../../services/chat/characterCards.js'
import { setUserName, setUserAvatar, useSettings } from '../../services/settings.js'
import { makeAvatarDataUrl } from '../../utils/avatar.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { CharacterAvatar } from '../session/CharacterAvatar.js'
import { CharacterEditor } from './CharacterEditor.js'
import { ContinuationWizard } from './ContinuationWizard.js'
import styles from './RoleSettings.module.css'
import { HIDDEN_FILE_INPUT_STYLE } from '../../utils/hiddenFileInput.js'

/**
 * 角色管理：上面是「我的角色」（只有头像和名字），下面是 AI 角色列表。
 *
 * - 内置「DeepSeek 助手」不可修改、不可删除（设定固定）；
 * - 自定义角色可新建、编辑、删除，删除后用到它的会话回落到内置助手；
 * - 名字与提示词都改完保存后，下一次请求生效（`systemPromptOfSession` 读的就是这里）。
 */
export const RoleSettings = () => {
  const t = useTranslate()
  const userName = useSettings((state) => state.userName)
  const userAvatar = useSettings((state) => state.userAvatar)
  /** 正在编辑的对象：我的角色 / 某个 AI 角色 / 新建 */
  const [editing, setEditing] = useState<
    null | { kind: 'user' } | { kind: 'character'; id: string | null }
  >(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** 「接着聊」向导：从旧会话抽人设建卡 */
  const [wizardOpen, setWizardOpen] = useState(false)
  /** 导入后靠它触发重渲染（角色列表不是响应式 store） */
  const [version, setVersion] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)
  void version
  const characters = listCharacters()
  // 当前会话正在用哪个角色：列表里给它标「使用中」
  const activeId = useChatStore((state) => state.activeId)
  const session = useChatStore((state) =>
    activeId !== null && Object.hasOwn(state.sessionCache, activeId)
      ? state.sessionCache[activeId]
      : undefined
  )
  const currentCharacterId = characterIdOfSession(session)
  const displayName = userName.trim() || t('roleUserNamePlaceholder')

  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('roleLead')}</p>

      <div className={styles.sectionTitle}>{t('rolesMineTitle')}</div>
      <button
        type="button"
        className={styles.userCard}
        onClick={() => setEditing({ kind: 'user' })}
      >
        <CharacterAvatar avatar={userAvatar || undefined} name={displayName} size={48} rounded />
        <span className={styles.userMain}>
          <span className={styles.userName}>{displayName}</span>
          <span className={styles.userHint}>{t('rolesMineHint')}</span>
        </span>
        <span className={styles.actionText}>{t('roleEdit')}</span>
      </button>

      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{t('rolesAiTitle')}</span>
        <span className={styles.headTools}>
          {CUSTOM_ROLES_ENABLED ? (
            <>
              <button
                type="button"
                className={styles.actionText}
                onClick={() => setWizardOpen(true)}
              >
                {t('continuationEntry')}
              </button>
              <button
                type="button"
                className={styles.actionText}
                onClick={() => importRef.current?.click()}
              >
                {t('roleImport')}
              </button>
              <input
                ref={importRef}
                type="file"
                style={HIDDEN_FILE_INPUT_STYLE}
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) {
                    return
                  }
                  void file.text().then((text) => {
                    const result = importCharacterCard(text)
                    if (!result.ok) {
                      showToast(t('roleImportFailed'))
                      return
                    }
                    setVersion((value) => value + 1)
                    showToast(t('roleImported'))
                    setEditing({ kind: 'character', id: result.id })
                  })
                }}
              />
            </>
          ) : null}
          {CUSTOM_ROLES_ENABLED ? (
            <button
              type="button"
              className={styles.newButton}
              onClick={() => setEditing({ kind: 'character', id: null })}
            >
              {t('roleNew')}
            </button>
          ) : null}
        </span>
      </div>

      <div className={styles.list}>
        {characters.map((character) => {
          const name = character.nameKey
            ? t(character.nameKey as TranslationKey)
            : (character.name ?? '')
          const hint = character.hintKey ? t(character.hintKey as TranslationKey) : ''
          const description = character.description || hint
          return (
            <div
              key={character.id}
              className={
                character.id === currentCharacterId ? `${styles.row} ${styles.rowSelected}` : styles.row
              }
            >
              <CharacterAvatar avatar={character.avatar} name={name} size={36} rounded />
              <span className={styles.rowMain}>
                <span className={styles.rowName}>{name}</span>
                <span className={styles.rowHint}>{description}</span>
              </span>
              {/* 徽标放在行内、与头像同一中线：flex 的 align-items:center 负责居中 */}
              <span className={styles.badges}>
                {character.id === currentCharacterId ? (
                  <span className={styles.inUseBadge}>{t('roleInUse')}</span>
                ) : character.builtin ? null : (
                  <span className={styles.customBadge}>{t('roleCustomBadge')}</span>
                )}
              </span>
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.actionText}
                  onClick={() => {
                    const id = duplicateCharacter(character.id)
                    if (id) {
                      showToast(t('roleDuplicated'))
                      setEditing({ kind: 'character', id })
                    }
                  }}
                >
                  {t('roleDuplicate')}
                </button>
                {character.builtin ? null : (
                  <>
                    <button
                      type="button"
                      className={styles.actionText}
                      onClick={() => setEditing({ kind: 'character', id: character.id })}
                    >
                      {t('roleEdit')}
                    </button>
                    <button
                      type="button"
                      className={styles.actionDanger}
                      onClick={() => setDeleting(character.id)}
                    >
                      {t('roleDelete')}
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {wizardOpen ? <ContinuationWizard onClose={() => setWizardOpen(false)} /> : null}
      {editing?.kind === 'user' ? (
        <UserProfileDialog onClose={() => setEditing(null)} />
      ) : null}
      {editing?.kind === 'character' ? (
        <CharacterEditor id={editing.id} onClose={() => setEditing(null)} />
      ) : null}
      {deleting ? (
        <DeleteCharacterDialog
          id={deleting}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  )
}

/** 「我的角色」：只改头像与名字，名字会进 system 里的称呼 */
const UserProfileDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const userName = useSettings((state) => state.userName)
  const userAvatar = useSettings((state) => state.userAvatar)
  const [name, setName] = useState(userName)
  const [avatar, setAvatar] = useState(userAvatar)
  const fileRef = useRef<HTMLInputElement>(null)

  const pickAvatar = async (file: File | undefined) => {
    if (!file) {
      return
    }
    try {
      setAvatar(await makeAvatarDataUrl(file))
    } catch {
      showToast(t('roleAvatarFailed'))
    }
  }

  return (
    <Modal
      title={t('roleEditUserTitle')}
      closable
      onClose={onClose}
      overlayClassName={styles.overlay}
      footer={
        <>
          <Button variant="outlined" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => {
              setUserName(name.trim())
              setUserAvatar(avatar)
              showToast(t('roleSaved'))
              onClose()
            }}
          >
            {t('roleSave')}
          </Button>
        </>
      }
    >
      <div className={styles.avatarRow}>
        <button
          type="button"
          className={styles.avatarButton}
          onClick={() => fileRef.current?.click()}
        >
          <CharacterAvatar
            avatar={avatar || undefined}
            name={name.trim() || t('roleUserNamePlaceholder')}
            size={72}
            rounded
          />
          <span className={styles.avatarEdit}>{t('roleAvatarChange')}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          style={HIDDEN_FILE_INPUT_STYLE}
          accept="image/*"
          onChange={(event) => {
            void pickAvatar(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {avatar ? (
          <button type="button" className={styles.linkButton} onClick={() => setAvatar('')}>
            {t('roleAvatarClear')}
          </button>
        ) : null}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('roleNameLabel')}</span>
        <input
          className={styles.input}
          value={name}
          placeholder={t('roleUserNamePlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className={styles.note}>{t('roleUserNameHint')}</p>
    </Modal>
  )
}

/** 删除确认：内置角色进不来 */
const DeleteCharacterDialog = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const t = useTranslate()
  const character = characterById(id)
  const name = character?.nameKey
    ? t(character.nameKey as TranslationKey)
    : (character?.name ?? '')
  return (
    <Modal
      title={t('roleDeleteTitle', { name })}
      overlayClassName={styles.overlay}
      className={styles.confirmDialog}
      closable
      onClose={onClose}
      footer={
        <>
          <Button variant="outlined" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              deleteCharacter(id)
              showToast(t('roleDeleted'))
              onClose()
            }}
          >
            {t('roleDelete')}
          </Button>
        </>
      }
    >
      <p className={styles.confirmText}>{t('roleDeleteDesc')}</p>
    </Modal>
  )
}
