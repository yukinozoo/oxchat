import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { listCompactTemplates, templateById } from '../../services/chat/compactTemplates.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { canCompact, DEFAULT_COMPACT_CHARS, DEFAULT_KEEP_ROUNDS, getCompactPlan, type CompactScope } from '../../services/chat/compact.js'
import { compactProgress, subscribeCompactProgress } from '../../services/chat/compactProgress.js'
import {
  compactNewSession,
  compactSession,
  selectSession,
  setCompactInstruction,
  useChatStore,
} from '../../services/chat/store.js'
import { DEFAULT_MODEL } from '../../services/api/types.js'
import { loadModels, useModels } from '../../services/models.js'
import {
  setCompactPanel,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { CompactDialog } from './CompactDialog.js'
import { CompactTemplatesPanel } from './CompactTemplatesPanel.js'
import whaleUrl from '../../assets/whale-alpha.png'
import styles from './CompactContextDialog.module.css'

/**
 * 压缩上下文：一个窗口里装完所有压缩配置。
 *
 * 从上往下：说明 → 摘要模板（点一下填进「重点留下什么」）→ 压缩模型（点开弹窗选）
 * → 压缩范围（四选一，参数与预估跟着变）→ 高级设置（折叠：原样带上提问原文、
 * 摘要长度、总输出上限、重点留下什么）→ 底部固定按钮。
 *
 * 范围/模型/长度这些设置都存在全局（`compact*` 键），跨会话复用。
 */
/** 范围四选一的顺序与文案键 */
const SCOPES: { scope: CompactScope; label: TranslationKey; desc: TranslationKey }[] = [
  { scope: 'keepRecent', label: 'compactScopeKeepRecent', desc: 'compactScopeKeepRecentDesc' },
  { scope: 'all', label: 'compactScopeAll', desc: 'compactScopeAllDesc' },
  { scope: 'earlier', label: 'compactScopeEarlier', desc: 'compactScopeEarlierDesc' },
  { scope: 'nearer', label: 'compactScopeNearer', desc: 'compactScopeNearerDesc' },
]

export const CompactContextDialog = ({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    Object.hasOwn(state.sessionCache, sessionId) ? state.sessionCache[sessionId] : undefined
  )
  const prefs = useSettings.getState()
  const [scope, setScope] = useState<CompactScope>((prefs.compactScope as CompactScope) ?? 'keepRecent')
  const [keepRounds, setKeepRounds] = useState(prefs.compactKeepRounds || DEFAULT_KEEP_ROUNDS)
  const [compactChars, setCompactChars] = useState(prefs.compactChars || DEFAULT_COMPACT_CHARS)
  const [summaryChars, setSummaryChars] = useState(prefs.compactSummaryChars || 4096)
  const [maxOutput, setMaxOutput] = useState(prefs.compactMaxOutput || 0)
  const [verbatimUser, setVerbatimUser] = useState(Boolean(prefs.compactVerbatimUser))
  /** 压缩到新会话：原会话完全不动 */
  const [intoNew, setIntoNew] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [modelOverride, setModelOverride] = useState(prefs.compactModel || '')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [instruction, setInstruction] = useState(session?.memory?.instruction ?? '')
  const progress = useSyncExternalStore(subscribeCompactProgress, compactProgress, compactProgress)
  /** 正在跑的压缩请求：关面板或点「停止」都要真的中断，不能留在后台空烧 token */
  const abortRef = useRef<AbortController | null>(null)
  useAndroidBackHandler(true, onClose)

  useEffect(() => () => abortRef.current?.abort(), [])

  // 会话切换时同步一次已保存的要求；打字过程中不覆盖
  useEffect(() => {
    const current = useChatStore.getState().sessionCache[sessionId]
    setInstruction(current?.memory?.instruction ?? '')
  }, [sessionId])

  const range = useMemo(
    () => ({ scope, keepRounds, compactChars }),
    [scope, keepRounds, compactChars]
  )
  const plan = session ? getCompactPlan(session, range) : { head: [], tail: [] }
  const compactable = session ? canCompact(session, range) : false
  const keptRounds = plan.tail.filter((message) => message.role === 'user').length
  const activeScope = SCOPES.find((item) => item.scope === scope) ?? SCOPES[0]
  const activeTemplateId = useSettings((state) => state.compactTemplate) || 'general'
  const activeTemplate = templateById(activeTemplateId)
  const templates = listCompactTemplates()
  const currentModel = useSettings((state) => state.model) || DEFAULT_MODEL
  const modelName = modelOverride || currentModel

  const savePanel = (patch: Parameters<typeof setCompactPanel>[0]) => setCompactPanel(patch)

  const run = async (confirmed = false) => {
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller
    const runCompact = intoNew ? compactNewSession : compactSession
    const result = await runCompact(sessionId, controller.signal, {
      ...(confirmed ? { confirmed: true } : {}),
      scope,
      keepRounds,
      compactChars,
      model: modelOverride || undefined,
      summaryChars,
      maxOutput,
      verbatimUser,
    })
    abortRef.current = null
    setRunning(false)
    if (result.status === 'confirm') {
      setConfirmOpen(true)
      return
    }
    if (result.status === 'done') {
      if (result.id) {
        showToast({ key: 'compactNewSessionDone' })
        selectSession(result.id)
      } else {
        showToast({ key: 'compactDone', params: { count: result.messages } })
      }
      onClose()
    } else if (result.status === 'short') {
      showToast({ key: 'compactShort' })
    } else if (result.status === 'busy') {
      showToast({ key: 'compactBusy' })
    } else if (result.status === 'error') {
      showToast(t('compactFailed', { message: result.message }))
    }
  }



  return (
    <>
      <Modal
        title={<span className={styles.panelTitle}>{t('usageStatsTitle')}</span>}
        closable={!running}
        overlayClassName={styles.overlay}
        className={styles.dialog}
        mainClassName={styles.body}
        onClose={() => {
          if (!running) {
            onClose()
          }
        }}
        footer={
          running ? (
            <>
              <Button variant="outlined" onClick={() => onClose()}>
                {t('cancel')}
              </Button>
              <Button variant="dangerOutlined" onClick={() => abortRef.current?.abort()}>
                {t('compactStop')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outlined" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button disabled={!compactable} onClick={() => void run(false)}>
                {t('usageCompactNow')}
              </Button>
            </>
          )
        }
      >
        <p className={styles.lead}>{t('compactPanelLead')}</p>
        {running ? (
          <p className={styles.runningNote}>
            {progress.total > 1
              ? t('compactRunningStep', { done: progress.done, total: progress.total })
              : t('compactRunning')}
          </p>
        ) : null}

        {/* 摘要模板 */}
        <div className={styles.blockHead}>
          <span className={styles.blockTitle}>{t('compactTemplates')}</span>
          <button
            type="button"
            className={styles.blockAction}
            onClick={() => setTemplatesOpen(true)}
          >
            {t('compactTemplateManage')}
          </button>
        </div>
        <div className={styles.chips}>
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={clsx(styles.chip, activeTemplateId === template.id && styles.chipActive)}
              onClick={() => savePanel({ compactTemplate: template.id })}
            >
              {template.name}
            </button>
          ))}
        </div>
        <p className={styles.hint}>{activeTemplate.hint}</p>

        {/* 压缩模型 */}
        <div className={styles.blockTitle}>{t('compactModelTitle')}</div>
        <button type="button" className={styles.rowButton} onClick={() => setModelOpen(true)}>
          <span
            className={styles.modelLogo}
            aria-hidden="true"
            style={{ maskImage: `url(${whaleUrl})`, WebkitMaskImage: `url(${whaleUrl})` }}
          />
          <span className={styles.rowMain}>
            <span className={styles.rowLabel}>{modelName}</span>
            <span className={styles.rowDesc}>
              {modelOverride ? t('compactModelManual') : t('compactModelFollow')}
            </span>
          </span>
          <span className={styles.rowChevron}>
            <IconChevronRightOutline14 />
          </span>
        </button>

        {/* 压缩范围 */}
        <div className={styles.blockTitle}>{t('compactScopeTitle')}</div>
        <button type="button" className={styles.rowButton} onClick={() => setScopeOpen(true)}>
          <span className={styles.rowMain}>
            <span className={styles.rowLabel}>{t(activeScope.label)}</span>
            <span className={styles.rowDesc}>{t(activeScope.desc)}</span>
          </span>
          <span className={styles.rowChevron}>
            <IconChevronRightOutline14 />
          </span>
        </button>

        {scope === 'keepRecent' ? (
          <div className={styles.numberRow}>
            <span className={styles.numberLabel}>{t('compactKeepRoundsLabel')}</span>
            <input
              className={styles.numberInput}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={keepRounds}
              onChange={(event) => {
                const value = Math.min(50, Math.max(1, Number(event.target.value) || 1))
                setKeepRounds(value)
                savePanel({ compactKeepRounds: value })
              }}
            />
            <span className={styles.numberUnit}>{t('compactRoundsUnit')}</span>
          </div>
        ) : null}
        {scope === 'earlier' || scope === 'nearer' ? (
          <div className={styles.numberRow}>
            <span className={styles.numberLabel}>{t('compactCharsLabel')}</span>
            <input
              className={styles.numberInput}
              type="number"
              inputMode="numeric"
              min={500}
              max={200000}
              step={500}
              value={compactChars}
              onChange={(event) => {
                const value = Math.min(200000, Math.max(500, Number(event.target.value) || 500))
                setCompactChars(value)
                savePanel({ compactChars: value })
              }}
            />
            <span className={styles.numberUnit}>{t('compactCharsUnit')}</span>
          </div>
        ) : null}
        <p className={styles.note}>
          {scope === 'keepRecent'
            ? t('compactScopeKeepRecentNote', { rounds: keepRounds })
            : scope === 'all'
              ? t('compactScopeAllNote')
              : t(activeScope.desc)}
        </p>
        <p className={styles.estimate}>
          {compactable
            ? scope === 'all'
              ? t('compactEstimateAll', { count: plan.head.length })
              : t('compactEstimate', { count: plan.head.length, rounds: keptRounds })
            : t('compactNoContent')}
        </p>

        {/* 高级设置 */}
        <button
          type="button"
          className={styles.foldHead}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <span className={styles.foldTitle}>{t('compactAdvanced')}</span>
          <span className={clsx(styles.foldArrow, advancedOpen && styles.foldArrowOpen)}>
            <IconChevronDownOutline14 />
          </span>
        </button>
        {advancedOpen ? (
          <div className={styles.foldBody}>
            <div className={styles.toggleRow}>
              <span className={styles.toggleMain}>
                <span className={styles.rowLabel}>{t('compactVerbatimUser')}</span>
                <span className={styles.rowDesc}>{t('compactVerbatimUserDesc')}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={verbatimUser}
                aria-label={t('compactVerbatimUser')}
                className={clsx(styles.switch, verbatimUser && styles.switchOn)}
                onClick={() => {
                  setVerbatimUser(!verbatimUser)
                  savePanel({ compactVerbatimUser: !verbatimUser })
                }}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>
            <div className={styles.numberRow}>
              <span className={styles.numberLabel}>{t('compactSummaryCharsLabel')}</span>
              <input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={300}
                max={20000}
                step={100}
                value={summaryChars}
                onChange={(event) => {
                  const value = Math.min(20000, Math.max(300, Number(event.target.value) || 300))
                  setSummaryChars(value)
                  savePanel({ compactSummaryChars: value })
                }}
              />
            </div>
            <div className={styles.numberRow}>
              <span className={styles.numberLabel}>{t('compactMaxOutputLabel')}</span>
              <input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                max={64000}
                step={256}
                value={maxOutput}
                placeholder={t('compactMaxOutputPlaceholder')}
                onChange={(event) => {
                  const value = Math.min(64000, Math.max(0, Number(event.target.value) || 0))
                  setMaxOutput(value)
                  savePanel({ compactMaxOutput: value })
                }}
              />
            </div>
            <p className={styles.note}>{t('compactMaxOutputDesc')}</p>
            <div className={styles.blockTitle}>{t('compactRequirement')}</div>
            <textarea
              className={styles.textarea}
              rows={3}
              value={instruction}
              placeholder={t('compactRequirementPlaceholder')}
              onChange={(event) => setInstruction(event.target.value)}
              onBlur={() => setCompactInstruction(sessionId, instruction)}
            />
            <p className={styles.note}>{t('compactSourcesNote')}</p>
            <div className={styles.toggleRow}>
              <span className={styles.toggleMain}>
                <span className={styles.rowLabel}>{t('compactNewSession')}</span>
                <span className={styles.rowDesc}>{t('compactNewSessionDesc')}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={intoNew}
                aria-label={t('compactNewSession')}
                className={clsx(styles.switch, intoNew && styles.switchOn)}
                onClick={() => setIntoNew(!intoNew)}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>
          </div>
        ) : null}

      </Modal>

      {scopeOpen ? (
        <CompactScopeDialog
          value={scope}
          onPick={(next) => {
            setScope(next)
            savePanel({ compactScope: next })
            setScopeOpen(false)
          }}
          onClose={() => setScopeOpen(false)}
        />
      ) : null}
      {modelOpen ? (
        <CompactModelDialog
          value={modelOverride}
          onPick={(model) => {
            setModelOverride(model)
            savePanel({ compactModel: model })
            setModelOpen(false)
          }}
          onClose={() => setModelOpen(false)}
        />
      ) : null}
      {confirmOpen ? (
        <CompactDialog
          sessionId={sessionId}
          onClose={() => {
            setConfirmOpen(false)
            onClose()
          }}
        />
      ) : null}
      {templatesOpen ? (
        <CompactTemplatesPanel onClose={() => setTemplatesOpen(false)} />
      ) : null}
    </>
  )
}

/** 压缩范围四选一：和模型选择同样是一个弹窗，选中即关 */
const CompactScopeDialog = ({
  value,
  onPick,
  onClose,
}: {
  value: CompactScope
  onPick: (scope: CompactScope) => void
  onClose: () => void
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('compactScopeTitle')}
      overlayClassName={styles.modelOverlay}
      closable
      onClose={onClose}
      footer={
        <Button variant="outlined" onClick={onClose}>
          {t('cancel')}
        </Button>
      }
    >
      <div className={styles.modelList}>
        {SCOPES.map((item) => (
          <button
            key={item.scope}
            type="button"
            className={clsx(styles.scopeItem, value === item.scope && styles.scopeItemActive)}
            onClick={() => onPick(item.scope)}
          >
            <span className={styles.scopeTitle}>{t(item.label)}</span>
            <span className={styles.scopeDesc}>{t(item.desc)}</span>
            {value === item.scope ? (
              <span className={styles.scopeCheck}>
                <IconCheckOutline16 />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </Modal>
  )
}

/** 压缩模型选择：首项是「跟随当前对话模型」（空字符串），其余来自模型列表 */
const CompactModelDialog = ({
  value,
  onPick,
  onClose,
}: {
  value: string
  onPick: (model: string) => void
  onClose: () => void
}) => {
  const t = useTranslate()
  const currentModel = useSettings((state) => state.model) || DEFAULT_MODEL
  const apiKey = useSettings((state) => state.apiKey)
  const models = useModels((state) => state.models)
  // 列表来自服务端；没拉到（没网/没 Key）时至少把当前模型列出来
  const options = models.length > 0 ? models : [currentModel]
  useEffect(() => {
    if (apiKey) {
      void loadModels(apiKey)
    }
  }, [apiKey])
  return (
    <Modal
      title={t('compactModelDialogTitle')}
      overlayClassName={styles.modelOverlay}
      closable
      onClose={onClose}
      footer={
        <Button variant="outlined" onClick={onClose}>
          {t('cancel')}
        </Button>
      }
    >
      <div className={styles.modelList}>
        <button
          type="button"
          className={clsx(styles.modelItem, value === '' && styles.modelItemActive)}
          onClick={() => onPick('')}
        >
          <span className={styles.modelName}>{t('compactModelFollow')}</span>
          <span className={styles.modelDesc}>{currentModel}</span>
          {value === '' ? (
            <span className={styles.modelCheck}>
              <IconCheckOutline16 />
            </span>
          ) : null}
        </button>
        {options
          .filter((model) => model !== currentModel)
          .map((model) => (
            <button
              key={model}
              type="button"
              className={clsx(styles.modelItem, value === model && styles.modelItemActive)}
              onClick={() => onPick(model)}
            >
              <span className={styles.modelName}>{model}</span>
              {value === model ? (
                <span className={styles.modelCheck}>
                  <IconCheckOutline16 />
                </span>
              ) : null}
            </button>
          ))}
      </div>
    </Modal>
  )
}
