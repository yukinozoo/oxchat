import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import {
  characterById,
  createCharacter,
  displayNameOfCharacter,
  updateCharacter,
} from '../../services/chat/characters.js'
import { characterToCardJson } from '../../services/chat/characterCards.js'
import { saveTxt } from '../../services/chat/exportTxt.js'
import { makeAvatarDataUrl } from '../../utils/avatar.js'
import { CharacterAvatar } from '../session/CharacterAvatar.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { ScrollPane } from '../base/ScrollPane.js'
import { showToast } from '../base/toastState.js'
import styles from './CharacterEditor.module.css'
import { HIDDEN_FILE_INPUT_STYLE } from '../../utils/hiddenFileInput.js'

/**
 * 新建 / 编辑角色页（整屏）。
 *
 * 排版按确认过的设计稿：基本（头像、名字、昵称、标签）→ 设定（描述、性格、场景）
 * → 开场白（可加多条）→ 更多字段（说话风格、行为准则、示例对话、系统提示、历史后指令，默认收起）。
 *
 * 字段口径对齐酒馆 v2 卡：`greetings[0]` 就是 first_mes，其余是备选开场白；
 * `systemPrompt` 非空时取代 `prompt`。作者 / 版本 / 作者说明不在界面上（留给角色卡导入导出用）。
 */
export const CharacterEditor = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const t = useTranslate()
  const existing = id ? characterById(id) : undefined
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(() =>
    existing ? (existing.name?.trim() || displayNameOfCharacter(existing)) : ''
  )
  const [nickname, setNickname] = useState(existing?.nickname ?? '')
  const [tags, setTags] = useState((existing?.tags ?? []).join(', '))
  const [description, setDescription] = useState(existing?.description ?? '')
  const [personality, setPersonality] = useState(existing?.personality ?? '')
  const [scenario, setScenario] = useState(existing?.scenario ?? '')
  const [style, setStyle] = useState(existing?.style ?? '')
  const [rules, setRules] = useState(existing?.rules ?? '')
  const [greetings, setGreetings] = useState<string[]>(() => {
    const list = existing?.greetings?.length ? existing.greetings : ['']
    return list
  })
  const [expanded, setExpanded] = useState(false)
  const [mesExample, setMesExample] = useState(existing?.mesExample ?? '')
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '')
  const [postHistoryPrompt, setPostHistoryPrompt] = useState(existing?.postHistoryPrompt ?? '')
  const [avatar, setAvatar] = useState(existing?.avatar ?? '')

  useAndroidBackHandler(true, onClose)

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

  const updateGreeting = (index: number, value: string) => {
    setGreetings((list) => list.map((item, i) => (i === index ? value : item)))
  }

  const removeGreeting = (index: number) => {
    setGreetings((list) => {
      const next = list.filter((_, i) => i !== index)
      return next.length > 0 ? next : ['']
    })
  }

  const save = () => {
    const trimmed = greetings.map((item) => item.trim()).filter((item) => item !== '')
    const cleanName = name.trim() || t('roleNewDefaultName')
    const patch = {
      name: cleanName,
      nickname: nickname.trim(),
      tags: tags
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== ''),
      description: description.trim(),
      personality: personality.trim(),
      scenario: scenario.trim(),
      style: style.trim(),
      rules: rules.trim(),
      greetings: trimmed,
      mesExample: mesExample.trim(),
      systemPrompt: systemPrompt.trim(),
      postHistoryPrompt: postHistoryPrompt.trim(),
      avatar,
    }
    const targetId = id ?? createCharacter(cleanName)
    updateCharacter(targetId, patch)
    showToast(t('roleSaved'))
    onClose()
  }

  const displayName = name.trim() || t('roleNewDefaultName')
  const title = id ? t('roleEditPageTitle') : t('roleNewTitle')

  return (
    <>
      <div className={styles.page}>
        <div className={styles.head}>
          <button type="button" className={styles.back} aria-label={t('back')} onClick={onClose}>
            <span className={styles.backChevron}>
              <IconChevronRightOutline14 />
            </span>
          </button>
          <h1 className={styles.title}>{title}</h1>
        </div>

        <ScrollPane contentClassName={styles.body}>
          <div className={styles.section}>{t('roleSectionBasic')}</div>
          <div className={styles.card}>
            <div className={styles.avatarRow}>
              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => fileRef.current?.click()}
              >
                <CharacterAvatar avatar={avatar || undefined} name={displayName} size={60} rounded />
              </button>
              <div className={styles.avatarActions}>
                <span className={styles.avatarTitle}>{t('roleAvatarLabel')}</span>
                <span className={styles.avatarLinks}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t('roleAvatarPick')}
                  </button>
                  {avatar ? (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setAvatar('')}
                    >
                      {t('roleAvatarClear')}
                    </button>
                  ) : null}
                </span>
              </div>
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
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('roleNameLabel')}</span>
              <input
                className={styles.input}
                value={name}
                placeholder={t('roleNamePlaceholder')}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('roleNicknameLabel')}</span>
              <input
                className={styles.input}
                value={nickname}
                placeholder={t('roleNicknamePlaceholder')}
                onChange={(event) => setNickname(event.target.value)}
              />
              <p className={styles.hint}>{t('roleNicknameHint')}</p>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('roleTagsLabel')}</span>
              <input
                className={styles.input}
                value={tags}
                placeholder={t('roleTagsPlaceholder')}
                onChange={(event) => setTags(event.target.value)}
              />
              <p className={styles.hint}>{t('roleTagsHint')}</p>
            </label>

          </div>

          <div className={styles.section}>{t('roleSectionProfile')}</div>
          <div className={styles.card}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('roleDescriptionLabel')}</span>
              <textarea
                className={styles.textarea}
                rows={6}
                value={description}
                placeholder={t('roleDescriptionPlaceholder')}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('rolePersonalityLabel')}</span>
              <textarea
                className={styles.textarea}
                rows={3}
                value={personality}
                placeholder={t('rolePersonalityPlaceholder')}
                onChange={(event) => setPersonality(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('roleScenarioLabel')}</span>
              <textarea
                className={styles.textarea}
                rows={3}
                value={scenario}
                placeholder={t('roleScenarioPlaceholder')}
                onChange={(event) => setScenario(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.section}>{t('roleSectionGreeting')}</div>
          <div className={styles.card}>
            {greetings.map((greeting, index) => (
              <div key={index} className={styles.field}>
                <div className={styles.greetingHead}>
                  <span className={styles.fieldLabel}>
                    {t('roleGreetingLabel', { index: index + 1 })}
                  </span>
                  {greetings.length > 1 ? (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => removeGreeting(index)}
                    >
                      {t('roleDelete')}
                    </button>
                  ) : null}
                </div>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={greeting}
                  placeholder={t('roleGreetingPlaceholder')}
                  onChange={(event) => updateGreeting(index, event.target.value)}
                />
              </div>
            ))}
            <button
              type="button"
              className={styles.greetingAdd}
              onClick={() => setGreetings((list) => [...list, ''])}
            >
              ＋ {t('roleGreetingAdd')}
            </button>
            <p className={styles.hint}>{t('roleGreetingHint')}</p>
          </div>

          <button
            type="button"
            className={styles.moreHead}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className={styles.moreMain}>
              <span className={styles.moreTitle}>{t('roleMoreFields')}</span>
              <span className={styles.moreSub}>{t('roleMoreFieldsSummary')}</span>
            </span>
            <span
              className={expanded ? `${styles.chev} ${styles.chevOpen}` : styles.chev}
              style={expanded ? undefined : { transform: 'rotate(90deg)' }}
            >
              <IconChevronRightOutline14 />
            </span>
          </button>

          {expanded ? (
            <div className={styles.card}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('roleStyleLabel')}</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={style}
                  placeholder={t('roleStylePlaceholder')}
                  onChange={(event) => setStyle(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('roleRulesLabel')}</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={rules}
                  placeholder={t('roleRulesPlaceholder')}
                  onChange={(event) => setRules(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('roleMesExampleLabel')}</span>
                <textarea
                  className={`${styles.textarea} ${styles.textareaMono}`}
                  rows={5}
                  value={mesExample}
                  placeholder={t('roleMesExamplePlaceholder')}
                  onChange={(event) => setMesExample(event.target.value)}
                />
                <p className={styles.hint}>{t('roleMesExampleHint')}</p>
              </label>

              <div className={styles.promptSection}>{t('rolePromptSection')}</div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('roleSystemPromptLabel')}</span>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={systemPrompt}
                  placeholder={t('roleSystemPromptPlaceholder')}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('rolePostHistoryLabel')}</span>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={postHistoryPrompt}
                  placeholder={t('rolePostHistoryPlaceholder')}
                  onChange={(event) => setPostHistoryPrompt(event.target.value)}
                />
                <p className={styles.hint}>{t('rolePostHistoryHint')}</p>
              </label>

            </div>
          ) : null}
        </ScrollPane>

        <div className={styles.footer}>
          <div className={styles.footerRow}>
            {existing ? (
              <button
                type="button"
                className={styles.exportButton}
                onClick={() => {
                  const card = characterById(existing.id) ?? existing
                  const fileName = `${(card.name ?? 'character').replace(/[\\/:*?"<>|]/g, '_')}.json`
                  void saveTxt(fileName, characterToCardJson(card))
                    .then(() => showToast(t('roleExported')))
                    .catch(() => showToast(t('roleExportFailed')))
                }}
              >
                {t('roleExport')}
              </button>
            ) : null}
            <button type="button" className={styles.save} onClick={save}>
              {t('roleSave')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
