import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import {
  useChatStore,
  compactSession,
  selectSession,
  setSessionCharacter,
} from '../../services/chat/store.js'
import { createCharacter, updateCharacter } from '../../services/chat/characters.js'
import {
  DEFAULT_RANGE,
  estimateExtraction,
  extractPersona,
  pickStyleSamples,
  type ExtractProgress,
  type PersonaDraft,
} from '../../services/chat/personaExtract.js'
import { useSettings } from '../../services/settings.js'
import { effectiveApiKey } from '../../services/apiKey.js'
import { closeSettings } from './settingsDialogState.js'
import styles from './ContinuationWizard.module.css'

/**
 * 「接着聊」向导：把一条很长的旧会话接续到 OxChat。
 *
 * 三步：
 * ① 抽人设（选会话 + 扫描范围 + 花费预估 → 分块抽取）
 * ② 挑风格样例（自动 6~12 条，可勾选/换一批/手粘）
 * ③ 一键接续：建角色卡 → 绑定会话 → 用「角色扮演」模板压缩保留最近 6 轮
 *
 * 全程不碰原会话的消息：压缩只是把旧消息折叠出上下文，原文一条不删。
 */
export const ContinuationWizard = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const sessionCache = useChatStore((state) => state.sessionCache)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [keyword, setKeyword] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(sessions[0]?.id ?? null)
  const [range, setRange] = useState<'recent' | 'all'>('recent')
  const [progress, setProgress] = useState<ExtractProgress | null>(null)
  const [draft, setDraft] = useState<PersonaDraft | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [extraSample, setExtraSample] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messages = useMemo(() => {
    if (!sessionId) {
      return []
    }
    const cached = Object.hasOwn(sessionCache, sessionId) ? sessionCache[sessionId] : undefined
    return cached?.messages ?? []
  }, [sessionCache, sessionId])

  const estimate = useMemo(
    () => (messages.length > 0 ? estimateExtraction(messages, range === 'all' ? messages.length : DEFAULT_RANGE) : null),
    [messages, range]
  )

  const filtered = sessions.filter((item) => {
    const text = keyword.trim().toLowerCase()
    return text ? (item.title || t('newChat')).toLowerCase().includes(text) : true
  })

  useEffect(() => {
    if (draft && !name.trim()) {
      const title = sessions.find((item) => item.id === sessionId)?.title ?? ''
      setName(title.slice(0, 20) || t('continuationDefaultName'))
    }
  }, [draft, name, sessionId, sessions, t])

  const runExtract = async () => {
    if (!sessionId || messages.length === 0) {
      return
    }
    const apiKey = effectiveApiKey()
    if (!apiKey) {
      setError(t('apiKeyStart'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const controller = new AbortController()
      const result = await extractPersona({
        apiKey,
        messages,
        range: range === 'all' ? messages.length : DEFAULT_RANGE,
        signal: controller.signal,
        onProgress: setProgress,
      })
      setDraft(result)
      setPicked(new Set(result.samples.slice(0, 8).map((item) => item.messageId)))
      setStep(2)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const reshuffle = () => {
    const next = pickStyleSamples(messages, 12).slice(0, 8)
    setDraft((current) =>
      current ? { ...current, samples: pickStyleSamples(messages, 12) } : current
    )
    setPicked(new Set(next.map((item) => item.messageId)))
  }

  const samples = draft?.samples ?? []
  const chosen = samples.filter((item) => picked.has(item.messageId)).map((item) => item.text)

  const apply = async () => {
    if (!draft || !sessionId) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = createCharacter(name.trim() || t('continuationDefaultName'))
      updateCharacter(id, {
        description: draft.description,
        personality: draft.personality,
        style: draft.style,
        rules: draft.rules,
        scenario: draft.scenario,
        timeline: draft.timeline,
        styleSamples: [...chosen, ...(extraSample.trim() ? [extraSample.trim()] : [])],
        model: useSettings.getState().model,
      })
      setSessionCharacter(sessionId, id)
      await compactSession(sessionId, undefined, {
        scope: 'keepRecent',
        keepRounds: 6,
        confirmed: true,
        templateId: 'roleplay',
      })
      closeSettings()
      selectSession(sessionId)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const total = progress?.total ?? 0
  const done = progress?.done ?? 0

  return (
    <Modal
      title={<span className={styles.title}>{t('continuationTitle')}</span>}
      overlayClassName={styles.overlay}
      className={styles.dialog}
      mainClassName={styles.body}
      closable
      onClose={onClose}
      footer={
        <div className={styles.footerRow}>
          {step > 1 ? (
            <Button variant="outlined" size="m" disabled={busy} onClick={() => setStep((step - 1) as 1 | 2)}>
              {t('continuationBack')}
            </Button>
          ) : null}
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          {step === 1 ? (
            <Button size="m" disabled={busy || !sessionId || messages.length === 0} onClick={() => void runExtract()}>
              {busy ? t('continuationExtracting') : t('continuationExtract')}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button size="m" disabled={busy || chosen.length === 0} onClick={() => setStep(3)}>
              {t('continuationNext')}
            </Button>
          ) : null}
          {step === 3 ? (
            <Button size="m" disabled={busy} onClick={() => void apply()}>
              {busy ? t('continuationApplying') : t('continuationApply')}
            </Button>
          ) : null}
        </div>
      }
    >
      <ol className={styles.steps}>
        {[1, 2, 3].map((value) => (
          <li key={value} className={value === step ? styles.stepOn : styles.step}>
            {t(`continuationStep${value}` as 'continuationStep1')}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <>
          <p className={styles.lead}>{t('continuationLead')}</p>
          <input
            className={styles.search}
            value={keyword}
            placeholder={t('continuationSearch')}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className={styles.list}>
            {filtered.slice(0, 200).map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === sessionId ? styles.rowOn : styles.row}
                onClick={() => setSessionId(item.id)}
              >
                <span className={styles.rowTitle}>{item.title || t('newChat')}</span>
              </button>
            ))}
          </div>
          <div className={styles.rangeRow}>
            {(['recent', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                className={range === value ? styles.chipOn : styles.chip}
                onClick={() => setRange(value)}
              >
                {t(value === 'recent' ? 'continuationRangeRecent' : 'continuationRangeAll')}
              </button>
            ))}
            {estimate ? (
              <span className={styles.estimate}>
                {t('continuationEstimate', {
                  chars: estimate.chars,
                  tokens: estimate.tokens,
                  chunks: estimate.chunks,
                })}
              </span>
            ) : null}
          </div>
          {progress ? (
            <p className={styles.progress}>
              {t('continuationProgress', { done, total: total || 0 })}
            </p>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <p className={styles.lead}>{t('continuationSamplesLead')}</p>
          <div className={styles.samples}>
            {samples.map((item) => (
              <label key={item.messageId} className={styles.sample}>
                <input
                  type="checkbox"
                  checked={picked.has(item.messageId)}
                  onChange={() =>
                    setPicked((current) => {
                      const next = new Set(current)
                      if (next.has(item.messageId)) {
                        next.delete(item.messageId)
                      } else {
                        next.add(item.messageId)
                      }
                      return next
                    })
                  }
                />
                <span className={styles.sampleText}>{item.text}</span>
              </label>
            ))}
          </div>
          <div className={styles.sampleActions}>
            <Button variant="outlined" size="s" onClick={reshuffle}>
              {t('continuationReshuffle')}
            </Button>
            <span className={styles.count}>
              {t('continuationChosen', { count: chosen.length })}
            </span>
          </div>
          <textarea
            className={styles.textarea}
            rows={2}
            value={extraSample}
            placeholder={t('continuationPasteSample')}
            onChange={(event) => setExtraSample(event.target.value)}
          />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <p className={styles.lead}>{t('continuationApplyLead')}</p>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('continuationName')}</span>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('continuationDefaultName')}
            />
          </label>
          <div className={styles.previewBox}>
            <div className={styles.previewTitle}>{t('continuationTimeline')}</div>
            <p className={styles.previewText}>{draft?.timeline || t('continuationEmptySection')}</p>
          </div>
          <div className={styles.previewBox}>
            <div className={styles.previewTitle}>{t('continuationStyle')}</div>
            <p className={styles.previewText}>{draft?.style || t('continuationEmptySection')}</p>
          </div>
          <p className={styles.hint}>{t('continuationCompressHint')}</p>
        </>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
    </Modal>
  )
}
