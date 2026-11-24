import { useState } from 'react'
import clsx from 'clsx'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useChatStore, setSessionCharacter } from '../../services/chat/store.js'
import {
  characterById,
  characterIdOfSession,
  listCharacters,
  setDefaultCharacterId,
} from '../../services/chat/characters.js'
import { CharacterAvatar } from './CharacterAvatar.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { IconEditOutline16 } from '../base/icons.js'
import styles from './CharacterPicker.module.css'

/**
 * 顶栏的角色按钮：显示当前角色的符号与名字，点开就是「选择角色」。
 *
 * 有会话时只改这一条会话（`Session.characterId`）；还在新对话页时改的是默认角色，
 * 下一个会话继承。角色本身目前是提示词预设，见 `services/chat/characters.ts`。
 */
export const CharacterButton = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    sessionId !== null && Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : undefined
  )
  const [open, setOpen] = useState(false)
  const currentId = characterIdOfSession(session)
  const current = characterById(currentId)
  const label = current?.nameKey ? t(current.nameKey as TranslationKey) : (current?.name ?? '')

  return (
    <>
      <button
        type="button"
        className={styles.chip}
        aria-label={t('characterPickerTitle')}
        title={t('characterPickerTitle')}
        onClick={() => setOpen(true)}
      >
        <CharacterAvatar avatar={current?.avatar} name={label} size={20} />
        <span className={styles.chipLabel}>{label}</span>
      </button>
      {open ? (
        <CharacterPickerDialog
          sessionId={sessionId}
          currentId={currentId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

/** 「选择角色」：列出全部角色，点一下即切换 */
const CharacterPickerDialog = ({
  sessionId,
  currentId,
  onClose,
}: {
  sessionId: string | null
  currentId: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const pick = (id: string) => {
    if (sessionId !== null) {
      setSessionCharacter(sessionId, id)
    } else {
      // 新对话页没有会话可写，改默认角色，下一条会话继承
      setDefaultCharacterId(id)
    }
    onClose()
  }

  return (
    <Modal
      title={
        <span className={styles.titleRow}>
          <span>{t('characterPickerTitle')}</span>
          <span className={styles.titleMeta}>
            {t('characterPickerCount', { count: listCharacters().length })}
          </span>
          <button
            type="button"
            className={styles.editButton}
            aria-label={t('characterPickerEdit')}
            title={t('characterPickerEdit')}
            onClick={() => {
              onClose()
              openSettings('roles', { closeOnBack: true })
            }}
          >
            <IconEditOutline16 />
          </button>
        </span>
      }
      overlayClassName={styles.overlay}
      className={styles.dialog}
      mainClassName={styles.body}
      closable
      onClose={onClose}
      footer={
        <Button variant="outlined" onClick={onClose}>
          {t('cancel')}
        </Button>
      }
    >
      <div className={styles.sectionTitle}>{t('characterPickerSection')}</div>
      <div className={styles.list}>
        {listCharacters().map((character) => {
          const name = character.nameKey
            ? t(character.nameKey as TranslationKey)
            : (character.name ?? '')
          const hint = character.hintKey ? t(character.hintKey as TranslationKey) : ''
          const active = character.id === currentId
          return (
            <button
              key={character.id}
              type="button"
              className={clsx(styles.card, active && styles.cardActive)}
              onClick={() => pick(character.id)}
            >
              <CharacterAvatar avatar={character.avatar} name={name} size={36} rounded />
              <span className={styles.cardMain}>
                <span className={styles.cardName}>{name}</span>
                <span className={styles.cardHint}>{hint}</span>
              </span>
              {active ? <span className={styles.check}>✓</span> : null}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
