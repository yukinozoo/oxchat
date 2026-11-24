import { create } from 'zustand'
import { showToast } from '../../components/base/toastState.js'
import { createId } from '../../utils/id.js'
import { translate } from '../../i18n/index.js'
import { ApiError, streamMessage } from '../api/client.js'
import { DEFAULT_MODEL, type ChatModel } from '../api/types.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import {
  cancelUpload,
  describeUploadError,
  isNonRetryableUploadError,
  uploadAttachment,
  useUploads,
} from '../attachments.js'
import { currentSystemPrompt, effortOfDepth, useSettings } from '../settings.js'
import {
  appendBranch,
  getVisibleMessages,
  normalizeSession,
  revealMessage,
  selectVersion,
} from './branches.js'
import { canCompact, getCompactPlan, KEEP_TOKENS_MANUAL, type CompactScope } from './compact.js'
import { renderTemplatePrompt, templateById } from './compactTemplates.js'
import { loadFileExcerpts } from './fileText.js'
import { extractAttachmentMemories, readAttachmentText } from './attachmentMemory.js'
import { characterById, defaultCharacterId, systemPromptOfSession } from './characters.js'
import { readGreetingDraft } from './greetingDraft.js'
import { appendClockRule, appendClockTime } from './clockTime.js'
import { buildRequest, EXTENDED_INPUT_LIMIT_TOKENS } from './request.js'
import { formatReference, runSearchStep, withReference } from './twoStepSearch.js'
import { systemForRequest } from './systemPrompt.js'
import { modelCaps } from '../modelCaps.js'
import {
  buildTranscript,
  cutTranscript,
  estimateTokens,
  historyTokens,
  isTooLongError,
  messageTokens,
  noteLimitFor,
  planTranscriptChunks,
  prepareContext,
  summarizeBudget,
  summarizeMessages,
} from './context.js'
import {
  contextMessages,
  foldMessages,
  MAX_NOTE_CHARS,
  mergeNotes,
  notesFromSummary,
  renderMemorySection,
} from './memory.js'
import { createBackupSession } from './sessionBackup.js'
import { noteReplyCompleted } from './giteeAutoSync.js'
import { resetCompactProgress, setCompactProgress } from './compactProgress.js'
import * as db from './db.js'
import { addTombstone } from './tombstones.js'
import { dropSessionIndex, flushSearchIndex, scheduleSessionIndex, warmSearchIndex } from './searchIndex.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type AttachmentMemory,
  type FileAttachment,
  type MemoryNote,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** 当前选中的模型（设置里可切换，未设置时用默认值） */
const currentModel = (): ChatModel => useSettings.getState().model ?? DEFAULT_MODEL

/** 当前思考强度：深度关掉时不发送该字段 */
const currentEffort = () => effortOfDepth(useSettings.getState().thinkingDepth)
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 不支持的模型拿不到服务端标题时，用第一句提问兜底，别让会话一直叫「新对话」 */
const localTitle = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) {
    return ''
  }
  return flat.length > 24 ? `${flat.slice(0, 24)}…` : flat
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt
  )

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

/**
 * 每个会话同一时刻只允许一个写请求在飞：流式回答时状态每帧都变，
 * 若每次都整会话写库，大消息量的会话会把 IndexedDB 写满、界面也开始掉帧。
 * 写入期间的新变更只置脏标记，等当前这次完成后再补一次最新快照。
 */
const savingSessions = new Set<string>()
const dirtySessions = new Set<string>()

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    if (savingSessions.has(sessionId)) {
      dirtySessions.add(sessionId)
      return
    }
    savingSessions.add(sessionId)
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        savingSessions.delete(sessionId)
        // 正文搜索索引：攒 1.2 秒再写，流式输出期间不会每帧重建
        scheduleSessionIndex(session)
        // 期间又有变更：用最新状态再写一次
        if (dirtySessions.delete(sessionId) && epoch === historyEpoch && getSession(sessionId)) {
          persist(sessionId)
        }
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          saveRetry.attempt = 0
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        savingSessions.delete(sessionId)
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
          // 掉线、存储配额抖动这类失败自己会好，退避重试而不是干等用户点重试
          scheduleSaveRetry()
        }
      })
  }
}

/** 保存失败后的自动重试：2s 起翻倍，封顶 60s，成功后清零 */
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000
const saveRetry: { handle: ReturnType<typeof setTimeout> | null; attempt: number } = {
  handle: null,
  attempt: 0,
}

const scheduleSaveRetry = () => {
  if (saveRetry.handle !== null) {
    return
  }
  if (!Object.values(get().sessionSaveErrors).some(Boolean)) {
    return
  }
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** saveRetry.attempt)
  saveRetry.attempt += 1
  saveRetry.handle = setTimeout(() => {
    saveRetry.handle = null
    retrySaveSessions()
  }, delay)
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
      void flushSearchIndex()
      return
    }
    // 切回前台：后台期间可能掉线或写库被限流，立刻补一次
    saveRetry.attempt = 0
    retrySaveSessions()
  }
  const onOnline = () => {
    saveRetry.attempt = 0
    retrySaveSessions()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  window.addEventListener('online', onOnline)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
    window.removeEventListener('online', onOnline)
  }
}

/** 请求用的 system：会话角色的设定（缺省回落全局提示词）+ 会话的长期记忆段落 */
const memoryAwareSystemPrompt = (sessionId: string): string => {
  const session = getSession(sessionId)
  const base = session ? systemPromptOfSession(session) : currentSystemPrompt()
  const memory = session ? renderMemorySection(session) : ''
  return memory ? `${base}\n\n${memory}` : base
}


/** 整理前备份：写库并把摘要加到列表最前面，不占详情缓存 */
const saveBackupSession = async (session: Session): Promise<void> => {
  const backup = createBackupSession(session)
  await db.saveSession(backup)
  set((state) => ({ sessions: sortSessions([toSessionSummary(backup), ...state.sessions]) }))
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: currentModel(),
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      // 附件搬到原生目录（只在安卓壳里生效；失败不影响启动，下次再试）
      if (!localStorage.getItem('oxchat:files-migrated-v1')) {
        void db
          .migrateFilesToNative()
          .then((moved) => {
            if (moved >= 0) {
              localStorage.setItem('oxchat:files-migrated-v1', '1')
            }
          })
          .catch(() => undefined)
      }
      const summaries = await db.loadSessionSummaries()
      // 后台补索引：每次最多补一批，首次升级到带索引的版本也会分几次启动慢慢补完
      void warmSearchIndex(summaries).catch(() => undefined)
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
        // 开着「回到上次对话」时直接进上次那条；找不到（已删除/换库）就当新对话
        if (useSettings.getState().resumeLastSession) {
          const last = readLastSession()
          if (last && summaries.some((summary) => summary.id === last)) {
            set({ activeId: last })
            void ensureSessionLoaded(last)
          }
        }
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 把会话载入缓存（不切换当前会话）：记忆管理等页面要预览别的会话时用 */
export const ensureSession = (id: string): Promise<void> => ensureSessionLoaded(id)

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * merge 模式不清空正式数据，只并入新增会话（导入去重后）。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async <T>(
  write: () => Promise<T>,
  mode: 'replace' | 'merge' = 'replace'
): Promise<T | number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    let result: T | undefined
    try {
      result = await write()
      summaries = await db.commitStaging(mode === 'merge')
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    if (mode === 'merge') {
      // 并入模式：按 id 合并列表（同 id 用新写入的覆盖），并清空详情缓存，
      // 否则已打开的会话仍展示缓存里的旧内容（例如补全前的空壳）。
      const merged = new Map(get().sessions.map((item) => [item.id, item]))
      for (const summary of summaries) {
        merged.set(summary.id, summary)
      }
      const { activeId } = get()
      set({
        ready: true,
        initError: false,
        sessions: sortSessions([...merged.values()]),
        sessionCache: {},
      })
      // 当前打开的会话若被覆盖，立即重新读取
      if (activeId !== null) {
        void ensureSessionLoaded(activeId)
      }
      // 导入/同步进来的会话还没有索引：后台补一批，搜索不必等直读兜底
      void warmSearchIndex(summaries).catch(() => undefined)
      return result as T
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    // 整库替换后旧索引全部作废：后台按新列表重建（每次一批）
    void warmSearchIndex(summaries).catch(() => undefined)
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

/** 上次打开的对话：只给「启动回到上次对话」用，新对话会把它清掉 */
const LAST_SESSION_KEY = 'oxchat:last-session'

const readLastSession = (): string | null => {
  try {
    return localStorage.getItem(LAST_SESSION_KEY)
  } catch {
    return null
  }
}

const writeLastSession = (id: string | null) => {
  try {
    if (id) {
      localStorage.setItem(LAST_SESSION_KEY, id)
    } else {
      localStorage.removeItem(LAST_SESSION_KEY)
    }
  } catch {
    // 存储不可用时只是不恢复，不影响使用
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    writeLastSession(null)
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    writeLastSession(id)
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  // 先把摘要改掉：侧边栏与顶栏都以摘要为准，避免详情缓存缺失时界面不更新
  set((state) => ({
    sessions: state.sessions.map((item) => (item.id === id ? { ...item, title } : item)),
  }))
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
/** 置顶或取消置顶：先更新内存列表（顺序会变），再写库；未加载的会话也能标记 */
export const pinSession = (id: string, pinned: boolean): Promise<void> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return Promise.resolve()
  }
  set((state) => ({
    sessions: sortSessions(
      state.sessions.map((summary) => (summary.id === id ? { ...summary, pinned } : summary))
    ),
    sessionCache: Object.hasOwn(state.sessionCache, id)
      ? { ...state.sessionCache, [id]: { ...state.sessionCache[id], pinned } }
      : state.sessionCache,
  }))
  return db.setSessionPinned(id, pinned).catch(db.reportStorageError('save session pin'))
}

/** 批量置顶：一次改完再统一落库，列表只重排一次 */
export const pinSessions = (ids: string[], pinned: boolean): Promise<void> =>
  Promise.all(ids.map((id) => pinSession(id, pinned))).then(() => undefined)

/** 批量删除：串行删除，避免同时开多个删除事务 */
export const removeSessions = async (ids: string[]): Promise<void> => {
  for (const id of ids) {
    await removeSession(id)
  }
}

export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    // 墓碑：让其它设备拉取时也把这条删掉（否则「删了又回来」）
    addTombstone(id)
    // 搜索索引也要清，否则删掉的会话还能被搜出来
    void dropSessionIndex(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

export type CompactResult =
  /** done 的 messages 是本次压缩掉的消息条数；createNew 时附带新会话 id */
  | { status: 'done'; messages: number; id?: string }
  /** 对话太短，没有可压缩的历史 */
  | { status: 'short' }
  | { status: 'missing' }
  /** 正在生成回复，或会话正在被替换 */
  | { status: 'busy' }
  | { status: 'cancelled' }
  /** 历史太长，整理需要分多次请求：先回来问一句要不要继续 */
  | { status: 'confirm'; chunks: number; tokens: number }
  | { status: 'error'; message: string }

/**
 * 压缩当前对话：把保留段之前的内容交给模型总结成摘要，摘要挂到保留段第一条提问上，
 * 其余消息从会话中移除。摘要随后续请求进入上下文，界面单独展示。
 * 生成中不压缩；压缩期间会话位置变化（有新消息、删了会话）则放弃本次结果。
 */
/**
 * 整理失败时的提示：把「服务端什么状态码」翻成人话。
 * 直接把英文原文甩给用户没有意义，尤其是 405（网关不允许）、200 却非流式（网关登录页/WAF）这类。
 */
export const describeCompactFailure = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return translate('compactNetworkError')
    }
    if (error.kind === 'interrupted') {
      return translate('compactInterrupted')
    }
    if (error.status === 405) {
      return translate('compactStatus405')
    }
    if (error.status === 200) {
      // HTTP 200 却进了错误分支：多半是网关/校园网登录页把接口拦了
      return translate('compactGatewayPage')
    }
    if (error.status === 401 || error.status === 403) {
      return translate('compactStatus401')
    }
    if (error.status === 429) {
      return translate('compactStatus429')
    }
    if (error.status === 400) {
      return translate('compactStatus400')
    }
    if (error.status !== undefined) {
      return translate('compactStatusOther', { status: error.status })
    }
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/** 超过这么多段就先确认：每段一次请求，超长历史可能是几十次 */
export const COMPACT_CONFIRM_CHUNKS = 8

/**
 * 「原样带上我说过的话」：从被压缩的那段里，把用户提问的原文攒成一条笔记。
 *
 * 摘要一定会把提问改写成第三人称转述，人设类对话一被转述就变味；
 * 这条笔记让原话也能进 system（封顶 1200 字，取最近的部分）。
 */
const verbatimUserNote = (head: readonly Message[]): MemoryNote | null => {
  const texts = head
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
  if (texts.length === 0) {
    return null
  }
  const joined = texts.join('\n')
  const text = joined.length > 1200 ? joined.slice(joined.length - 1200) : joined
  return {
    id: createId(),
    text: `【用户原话】\n${text}`,
    source: 'manual',
    createdAt: Date.now(),
  }
}

/** 压缩参数：面板传整套，老入口只传 keepTokens */
export type CompactOptions = {
  confirmed?: boolean
  keepTokens?: number
  scope?: CompactScope
  keepRounds?: number
  compactChars?: number
  model?: string
  summaryChars?: number
  maxOutput?: number
  verbatimUser?: boolean
  /** true = 不折叠原会话，改成新建一个带摘要与保留原文的会话 */
  createNew?: boolean
}

type CompactRun = {
  session: Session
  head: Message[]
  tail: Message[]
  text: string
  maxNoteChars: number
  notes: MemoryNote[]
  /** 本次折叠轮次里提炼到的资料记忆；undefined 表示这次没动（沿用已有的） */
  attachments: AttachmentMemory[] | undefined
}

/**
 * 从本次要折叠的消息里提炼「资料记忆」。
 *
 * - 只处理带附件的轮次；图片与读不到正文的附件不发请求，直接用这一轮问答兜底；
 * - 同一份附件（同一本地 id / 同一文件名）只提炼一次；
 * - 任何失败都只是少一份资料记忆，不影响整理本身。
 */
const extractFoldedAttachments = async (
  session: Session,
  head: readonly Message[],
  signal: AbortSignal | undefined
): Promise<AttachmentMemory[] | undefined> => {
  const hasFiles = head.some((message) => message.role === 'user' && message.files.length > 0)
  if (!hasFiles) {
    return undefined
  }
  const apiKey = useSettings.getState().apiKey ?? ''
  if (!apiKey) {
    return undefined
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    return await extractAttachmentMemories({
      apiKey,
      locale: useSettings.getState().locale,
      messages: head,
      existing: session.memory?.attachments,
      readFileContent: readFileForMemory,
      signal: controller.signal,
    })
  } catch {
    // 提炼失败（取消、超时、接口报错）就保住旧资料记忆，别把整理一起拖垮
    return undefined
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

/** 读附件正文：优先用上传时留下的片段，其次本地原件抽取/解码 */
const readFileForMemory = async (file: FileAttachment): Promise<string | null> => {
  const excerpt = file.serverId
    ? (await loadFileExcerpts([file.serverId])).get(file.serverId)
    : undefined
  return readAttachmentText(file, db.loadFile, excerpt)
}

/**
 * 压缩的公共前半段：规划要压哪段、调模型写摘要、把摘要（和可选的提问原话）变成笔记。
 * 后半段分两条路：折叠原会话（compactSession），或新建会话（compactNewSession）。
 */
const runCompactSummary = async (
  sessionId: string,
  signal: AbortSignal | undefined,
  options: CompactOptions
): Promise<{ ok: true; run: CompactRun } | { ok: false; result: CompactResult }> => {
  const keepTokens = options.keepTokens ?? KEEP_TOKENS_MANUAL
  const prefs = useSettings.getState()
  // 传了 scope 就按面板的四选一规划；没传（确认弹窗等老入口）继续按 token 预算
  const range = options.scope
    ? {
        scope: options.scope,
        keepRounds: options.keepRounds ?? prefs.compactKeepRounds,
        compactChars: options.compactChars ?? prefs.compactChars,
        keepTokens,
      }
    : { keepTokens }
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return { ok: false, result: { status: 'busy' } }
  }
  if (getStreamController(sessionId)) {
    return { ok: false, result: { status: 'busy' } }
  }
  const session = getSession(sessionId)
  if (!session) {
    return { ok: false, result: { status: 'missing' } }
  }
  if (!canCompact(session, range)) {
    return { ok: false, result: { status: 'short' } }
  }
  const apiKey = useSettings.getState().apiKey ?? ''
  if (!apiKey) {
    return { ok: false, result: { status: 'error', message: translate('apiKeyStart') } }
  }
  if (signal?.aborted) {
    return { ok: false, result: { status: 'cancelled' } }
  }
  const { head, tail } = getCompactPlan(session, range)
  const kept = tail[0]
  if (!kept && !options.createNew) {
    return { ok: false, result: { status: 'short' } }
  }
  // 超长历史一次请求塞不下（会报 user input too long）：按预算分段，段数多了先问一句
  const chunks = planTranscriptChunks(head).length
  if (!options.confirmed && chunks > COMPACT_CONFIRM_CHUNKS) {
    return {
      ok: false,
      result: { status: 'confirm', chunks, tokens: historyTokens(head) },
    }
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const previousSummary = kept?.role === 'user' ? kept.summary : undefined
  // 面板传了目标字数就用它；其它入口（确认弹窗、自动压缩）仍按历史规模分档
  const limitChars = options.summaryChars ?? noteLimitFor(historyTokens(head))
  const maxNoteChars = Math.max(MAX_NOTE_CHARS, Math.round(limitChars / 6))
  // 附件正文片段：按 Files API 的 file_id 取，压缩后模型还能知道文档要点
  const excerptIds = head.flatMap((message) =>
    message.role === 'user' ? message.files.map((file) => file.serverId) : []
  )
  const excerpts = await loadFileExcerpts(excerptIds)
  let text = ''
  try {
    text = await summarizeMessages(head, {
      apiKey,
      signal: controller.signal,
      previousSummary,
      // 把已经记住的笔记喂回模型：否则第二次整理会把第一批记忆整段丢掉
      existingNotes: session.memory?.notes,
      limitChars,
      // 「重点留下什么」= 用户自己的追加要求；模板是另一层（完整提示词）
      instruction: session.memory?.instruction,
      templatePrompt: renderTemplatePrompt(templateById(prefs.compactTemplate).prompt, limitChars),
      excerpts,
      onProgress: setCompactProgress,
      model: options.model || prefs.compactModel || undefined,
      maxTokens: options.maxOutput ?? prefs.compactMaxOutput,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, result: { status: 'cancelled' } }
    }
    return { ok: false, result: { status: 'error', message: describeCompactFailure(error) } }
  } finally {
    signal?.removeEventListener('abort', abort)
    resetCompactProgress()
  }
  if (!text) {
    return { ok: false, result: { status: 'error', message: translate('compactEmpty') } }
  }
  const summaryNotes = notesFromSummary(text, Date.now(), { maxChars: maxNoteChars })
  // 「原样带上我说过的话」：把被压缩那段里的提问原文摘一条笔记，摘要之外再留一份原话
  const verbatim = options.verbatimUser ?? prefs.compactVerbatimUser
  const verbatimNote = verbatim ? verbatimUserNote(head) : null
  const notes = mergeNotes(
    session.memory?.notes ?? [],
    verbatimNote ? [...summaryNotes, verbatimNote] : summaryNotes
  )
  // 独立资料记忆：只处理本次被折叠的、带附件的轮次；失败不影响整理本身
  const attachments = await extractFoldedAttachments(session, head, signal)
  return { ok: true, run: { session, head, tail, text, maxNoteChars, notes, attachments } }
}

/**
 * 压缩当前对话（折叠式）：把要压的部分折叠出上下文，摘要写进笔记；原消息一条不删。
 */
export const compactSession = async (
  sessionId: string,
  signal?: AbortSignal,
  options: CompactOptions = {}
): Promise<CompactResult> => {
  const prepared = await runCompactSummary(sessionId, signal, options)
  if (!prepared.ok) {
    return prepared.result
  }
  const { session, head, notes, attachments } = prepared.run
  const latest = getSession(sessionId)
  if (!latest) {
    return { status: 'missing' }
  }
  // 摘要期间路径变了（新提问、切换版本）就放弃，避免把摘要挂到错的位置。
  if (getVisibleMessages(latest).at(-1)?.id !== getVisibleMessages(session).at(-1)?.id) {
    return { status: 'busy' }
  }
  // 压缩前先备份一份（可关）：压缩是"折叠"不是删除，但备份仍能让用户回看压缩前的样子
  if (useSettings.getState().compactBackup !== false) {
    try {
      await saveBackupSession(session)
    } catch {
      // 备份失败不阻断压缩
    }
  }
  updateSession(sessionId, (current) => ({
    ...current,
    // 消息一条都不删：只是把它们折叠出请求上下文，随时可以恢复
    memory: foldMessages(current.memory, head, notes, Date.now(), attachments),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  return { status: 'done', messages: head.length }
}

/**
 * 压缩到新会话：原会话完全不动，新建一条「摘要 + 保留原文」的会话接着聊。
 *
 * 附件用同一个 file id 引用（`sessionSummaries.fileIds` 是索引，删任一条会话都不会误删原件），
 * 所以这里直接搬消息对象，不复制二进制。
 */
export const compactNewSession = async (
  sessionId: string,
  signal?: AbortSignal,
  options: CompactOptions = {}
): Promise<CompactResult> => {
  const prepared = await runCompactSummary(sessionId, signal, { ...options, createNew: true })
  if (!prepared.ok) {
    return prepared.result
  }
  const { session, head, tail, notes, attachments } = prepared.run
  const now = Date.now()
  const instruction = session.memory?.instruction
  const draft: Session = {
    id: createId(),
    title: `${session.title || translate('untitledChat')}${translate('compactNewSessionSuffix')}`,
    createdAt: now,
    updatedAt: now,
    messages: tail.map((message) => ({ ...message })),
    rootMessageId: null,
    memory: {
      notes,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      // 新会话里没有折叠：被压的部分根本没搬过来
      foldedIds: [],
      foldedRounds: 0,
      ...(instruction ? { instruction } : {}),
      updatedAt: now,
    },
  }
  touchSession(draft.id)
  set((state) => ({
    sessions: sortSessions([toSessionSummary(draft), ...state.sessions]),
    sessionCache: { ...state.sessionCache, [draft.id]: draft },
  }))
  persist(draft.id)
  return { status: 'done', messages: head.length, id: draft.id }
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const characterId = defaultCharacterId()
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
      characterId,
      greetingIndex: readGreetingDraft(characterId),
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  // 折叠掉的早期消息不进上下文，但仍然留在会话里可以回看
  const history = contextMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, { history, question })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
    // 编辑提问保留压缩摘要，否则摘要会随旧版本一起失效。
    ...(previous.summary ? { summary: previous.summary } : {}),
    ...(previous.summaryCount ? { summaryCount: previous.summaryCount } : {}),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

/** 从某条消息处开一条新对话：把当前分支到它为止的内容整段复制出去（原对话不动） */
export const branchSession = (sessionId: string, messageId: string): string | null => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return null
  }
  const session = getSession(sessionId)
  if (!session) {
    return null
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  if (index < 0) {
    return null
  }
  const chain = path.slice(0, index + 1).map((message) => ({ ...message }))
  const now = Date.now()
  const id = createId()
  const next: Session = {
    id,
    title: `${session.title || translate('untitledChat')} ${translate('branchSuffix')}`,
    createdAt: now,
    updatedAt: now,
    messages: chain,
    rootMessageId: chain[0]?.id ?? null,
    // 角色与会话级设置一起带走，分支里还是同一个人、同一条开场白
    ...(session.characterId ? { characterId: session.characterId } : {}),
    ...(session.greetingIndex !== undefined ? { greetingIndex: session.greetingIndex } : {}),
    ...(session.autoCompact !== undefined ? { autoCompact: session.autoCompact } : {}),
  }
  touchSession(id)
  set((state) => ({
    sessions: [toSessionSummary(next), ...state.sessions],
    sessionCache: { ...state.sessionCache, [id]: next },
    activeId: id,
  }))
  persist(id)
  writeLastSession(id)
  return id
}

/**
 * 改一条 AI 回答：改出来的内容**作为新版本**挂到同一个提问下（原回答留成旧版本，可来回切换）。
 *
 * 为什么不原地替换：改答通常是「重写一遍」，原地覆盖就没法回头比对了。
 * 追加的是同级兄弟节点 —— 版本切换器（1/2、2/2）本来就是这个模型，不需要额外机制。
 */
export const editAssistantAsVersion = (
  sessionId: string,
  messageId: string,
  text: string
): string | null => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return null
  }
  const session = getSession(sessionId)
  const target = session?.messages.find((message) => message.id === messageId)
  if (!session || target?.role !== 'assistant') {
    return null
  }
  const next = text.trim()
  if (!next) {
    return null
  }
  const reply: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: target.model,
    // prefix: true 才能「保存并发送」——把这段文字当成模型的已有输出，接着往下生成
    prefix: true,
    status: 'done',
    blocks: [{ type: 'text', text: next }],
  }
  updateSession(sessionId, (current) => ({
    ...appendBranch(current, target.parentId ?? null, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  return reply.id
}

/** 跳到某条不在当前分支上的消息：先把分支链切过来 */
export const revealSessionMessage = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => revealMessage(session, messageId))
  persist(sessionId)
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 恢复被折叠的消息：清空 foldedIds，笔记保留 */
export const unfoldMemory = (sessionId: string): boolean => {
  const session = getSession(sessionId)
  if (!session?.memory || session.memory.foldedIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) =>
    current.memory
      ? {
          ...current,
          memory: { ...current.memory, foldedIds: [], foldedRounds: 0, updatedAt: Date.now() },
        }
      : current
  )
  persist(sessionId)
  return true
}

/** 保存本会话的整理要求（空串表示清空）；没整理过时也会建立一个只带要求的 memory */
export const setCompactInstruction = (sessionId: string, instruction: string): void => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const text = instruction.trim()
  updateSession(sessionId, (current) => ({
    ...current,
    memory: {
      notes: current.memory?.notes ?? [],
      foldedIds: current.memory?.foldedIds ?? [],
      foldedRounds: current.memory?.foldedRounds ?? 0,
      ...(text ? { instruction: text } : {}),
      updatedAt: Date.now(),
    },
  }))
  persist(sessionId)
}

/**
 * 切换本会话使用的角色：只改这一条会话的 system，不动全局提示词。
 * 还没有会话时（新对话页）由调用方改默认角色。
 */
export const setSessionCharacter = (sessionId: string, characterId: string): void => {
  const session = getSession(sessionId)
  if (!session || !characterById(characterId)) {
    return
  }
  updateSession(sessionId, (current) => ({ ...current, characterId }))
  persist(sessionId)
}

/**
 * 打开/关闭本会话的自动压缩。
 *
 * 自动压缩本身仍按「触发阈值 / 保留比例」跑，只是不再全局一刀切：
 * 用量面板里那条对话关掉，其它对话照旧。写入存进会话对象，随备份一起走。
 */
export const setSessionAutoCompact = (sessionId: string, autoCompact: boolean): void => {
  const session = getSession(sessionId)
  if (!session || session.autoCompact === autoCompact) {
    return
  }
  updateSession(sessionId, (current) => ({ ...current, autoCompact }))
  persist(sessionId)
}

/**
 * 把最近一段对话压成一条笔记（用户主动触发）。
 *
 * 与「整理」的区别：不折叠任何消息、不动已有笔记，只是让模型写一条要点出来，
 * 由用户决定留不留。写出来的笔记标成 manual —— 这是用户自己要的成果，
 * 下次整理不该把它覆盖掉。
 */
export const generateMemoryNote = async (
  sessionId: string,
  signal?: AbortSignal
): Promise<{ status: 'done' | 'short' | 'error' | 'busy' | 'cancelled'; message?: string }> => {
  const session = getSession(sessionId)
  if (!session) {
    return { status: 'short' }
  }
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return { status: 'busy' }
  }
  const apiKey = useSettings.getState().apiKey ?? ''
  if (!apiKey) {
    return { status: 'error', message: translate('apiKeyStart') }
  }
  const path = contextMessages(session).slice(-24)
  if (path.length < 2) {
    return { status: 'short' }
  }
  const excerpts = await loadFileExcerpts(
    path.flatMap((message) => (message.role === 'user' ? message.files.map((file) => file.serverId) : []))
  )
  const transcript = cutTranscript(buildTranscript(path, excerpts), summarizeBudget())
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let text = ''
  try {
    const events = streamMessage(
      apiKey,
      {
        model: useSettings.getState().model ?? DEFAULT_MODEL,
        system: currentSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: `把下面这段对话压成一条不超过 200 字的要点笔记，供以后参考。只写结论、决定与关键事实，不要寒暄，不要分点，直接给一句话或一小段。\n\n${transcript}`,
          },
        ],
        thinking: { type: 'disabled' },
        safety_check: { level: 'high' },
        tools: [],
      },
      controller.signal
    )
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: 'cancelled' }
    }
    return { status: 'error', message: describeCompactFailure(error) }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  const note = text.trim()
  if (!note) {
    return { status: 'error', message: translate('compactEmpty') }
  }
  const latest = getSession(sessionId)?.memory?.notes ?? []
  saveMemoryNotes(sessionId, [
    { id: createId(), text: note.slice(0, MAX_NOTE_CHARS), source: 'manual', createdAt: Date.now() },
    ...latest,
  ])
  return { status: 'done' }
}

/** 保存一条资料记忆（改内容）；空文本等同于删除 */
export const saveAttachmentMemory = (sessionId: string, attachmentId: string, summary: string): void => {
  const session = getSession(sessionId)
  if (!session?.memory) {
    return
  }
  const text = summary.trim()
  updateSession(sessionId, (current) => {
    if (!current.memory) {
      return current
    }
    const list = current.memory.attachments ?? []
    return {
      ...current,
      memory: {
        ...current.memory,
        attachments: text
          ? list.map((item) => (item.id === attachmentId ? { ...item, summary: text } : item))
          : list.filter((item) => item.id !== attachmentId),
        updatedAt: Date.now(),
      },
    }
  })
  persist(sessionId)
}

/** 删除一条资料记忆：下次整理到同一附件时会重新提炼 */
export const removeAttachmentMemory = (sessionId: string, attachmentId: string): void => {
  const session = getSession(sessionId)
  if (!session?.memory) {
    return
  }
  updateSession(sessionId, (current) =>
    current.memory
      ? {
          ...current,
          memory: {
            ...current.memory,
            attachments: (current.memory.attachments ?? []).filter(
              (item) => item.id !== attachmentId
            ),
            updatedAt: Date.now(),
          },
        }
      : current
  )
  persist(sessionId)
}

/** 用户手动改过的笔记：内容与顺序原样保存，标记为 edited 让其不被下次整理覆盖 */
export const saveMemoryNotes = (sessionId: string, notes: MemoryNote[]): void => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  updateSession(sessionId, (current) => ({
    ...current,
    memory: {
      notes,
      foldedIds: current.memory?.foldedIds ?? [],
      foldedRounds: current.memory?.foldedRounds ?? 0,
      updatedAt: Date.now(),
    },
  }))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? currentModel(),
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (
  apiKey: string,
  file: FileAttachment,
  options: { silent?: boolean } = {}
): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage, options)
}

/** 历史补传中遇到必然失败的附件（配额/格式/鉴权）：记下来，后续轮次直接跳过，避免每轮重传 */
const nonRetryableUploads = new Set<string>()

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求。**必然失败的错误**（配额、格式/解析、鉴权）只试一次：
 *   记进 nonRetryableUploads，之后每次发送直接跳过，不再每轮重传、也不把旧消息标成「上传失败」。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  // 不用 toReversed：iOS Safari 16.4 以下没有这个原型方法，会让每次发送都报错（曾表现为「上传失败」）
  for (const [user] of getContextRounds(request.history).slice().reverse()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    if (nonRetryableUploads.has(file.id)) {
      continue
    }
    signal.throwIfAborted()
    try {
      // 静默：历史附件补传失败不写全局任务态、不弹配额提示（旧消息不该挂「上传失败」）
      const serverId = await Promise.race([
        ensureServerId(apiKey, file, { silent: true }),
        aborted,
      ])
      if (serverId) {
        nonRetryableUploads.delete(file.id)
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch (error) {
      signal.throwIfAborted()
      if (isNonRetryableUploadError(error)) {
        nonRetryableUploads.add(file.id)
      }
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/**
 * 服务端拒绝图片尺寸（宽高需 ≤ 4096）时：把该会话图片的 serverId 清空，
 * 下一次上传会走降采样，或用不到本地原件时自动跳过这张图。
 */
const resetImageServerIds = (sessionId: string): boolean => {
  const session = getSession(sessionId)
  if (!session) {
    return false
  }
  const cleared: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !file.isImage) {
        return file
      }
      cleared.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (cleared.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  cleared.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)
  /** 已降级为标准模式（长输入 / 服务端打回），只对本次生成有效 */
  let standardForced = false
  /** 降级提示只弹一次，避免重试时刷屏 */
  let fallbackNotified = false

  try {
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        const prepared = await prepareFiles(sessionId, request, controller.signal)
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const caps = modelCaps(initial.model ?? currentModel())
        // v4-pro 不接受 latest_reminder，发了会 400：这类模型直接不带快照
        const latestReminder = caps.supportsReminder
          ? prepared.prefix
            ? prepared.prefix.latestReminder
            : createLatestReminder(useSettings.getState())
          : undefined
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        // 发送前按「对话设置」整理历史：必要时自动压缩，再按上下文窗口裁剪
        const apiKey = useSettings.getState().apiKey ?? ''
        const context = await prepareContext(prepared.history, apiKey, controller.signal, {
          cacheKey: sessionId,
          autoCompact: getSession(sessionId)?.autoCompact,
        })
        const rawMessages = toRequestMessages(
          context,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder
        )
        // 具体时刻：尾部只放纯数据标记 `[环境时钟: HH:mm]`，规则另用一句静态说明进 system
        // （整段解释放尾部会被模型当成用户输入去回应；时刻本身不进 system，前缀缓存才稳）
        const clockTime = useSettings.getState().sendClockTime
        const locale = useSettings.getState().locale
        const messages = clockTime ? appendClockTime(rawMessages, new Date(), locale) : rawMessages
        const model = initial.model ?? currentModel()
        const baseSystem = memoryAwareSystemPrompt(sessionId)
        const system = systemForRequest(
          clockTime ? appendClockRule(baseSystem, locale) : baseSystem,
          caps
        )
        // 预算口径与圆环一致：历史 + 本轮提问（含附件）+ system
        const budget =
          context.reduce((total, message) => total + messageTokens(message), 0) +
          messageTokens(prepared.question) +
          estimateTokens(system)
        // 扩展模式（声明了服务端工具）的输入上限只有 32768：超了先主动退标准模式，把 1M 窗口换回来。
        // 不支持工具的模型（v4-pro）没有这个退路，只能如实报超长。
        if (caps.inputLimit !== null && budget > caps.inputLimit) {
          if (caps.serverTools && !standardForced) {
            standardForced = true
            continue
          }
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: '',
            localMessage: {
              key: 'replyInputTooLong',
              params: { tokens: budget, limit: caps.inputLimit, model },
            },
          })
          break
        }
        /**
         * 两步法：长对话 + 开了智能搜索时，先单独跑一轮检索拿资料，
         * 再用标准模式（1M 窗口）带完整历史作答 —— 否则扩展模式的 32768 上限会把搜索挤掉。
         */
        let finalMessages = messages
        let finalSearch = initial.search ?? false
        if (
          caps.serverTools &&
          finalSearch &&
          !standardForced &&
          budget > EXTENDED_INPUT_LIMIT_TOKENS
        ) {
          showToast({ key: 'searchStepRunning' })
          try {
            const step = await runSearchStep(apiKey, model, messages, controller.signal)
            const reference = formatReference(step.summary, step.results)
            if (step.usedTools && reference.trim()) {
              finalMessages = withReference(messages, reference)
              // 第二步必须是标准模式：资料已经拿到了，工具不再需要
              standardForced = true
              finalSearch = false
            }
          } catch {
            // 检索失败不阻断作答：退回普通请求（长输入由下面的闸门自动降级）
          }
        }
        const built = buildRequest({
          model,
          caps,
          system,
          messages: finalMessages,
          thinking: initial.thinking ?? false,
          effort: currentEffort(),
          temperature: useSettings.getState().temperature,
          search: finalSearch,
          wantTitle: titleRequests.has(controller),
          tokens: budget,
          forceStandard: standardForced,
        })
        if (built.standardOnly && !fallbackNotified) {
          // 降级是自动发生的，用轻提示告知，不打断输入（下次提问会自动回到扩展模式）
          fallbackNotified = true
          showToast({ key: 'replyStandardFallback' })
        }
        const events = streamMessage(apiKey, built.body, controller.signal)
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        reply = settleReply(reply, 'done', Date.now())
        if (!caps.title) {
          // 服务端不给标题（v4-pro）：用第一句提问兜底
          const fallback = localTitle(request.question.content)
          if (fallback) {
            updateSession(sessionId, (session) =>
              session.title ? session : { ...session, title: fallback }
            )
          }
        }
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          // 只有接口类失败才算「上传失败」；准备阶段的环境异常单独记，避免真实原因被「上传失败」盖住
          reply =
            error instanceof ApiError
              ? settleReply(reply, 'error', Date.now(), {
                  kind: 'upload',
                  message: '',
                  localMessage: describeUploadError(error),
                  retryable: isRetryableApiError(error),
                })
              : settleReply(reply, 'error', Date.now(), {
                  kind: 'crash',
                  message: error instanceof Error ? error.message : String(error),
                })
          break
        }
        // 服务端用「输入过长」打回：先退标准模式重发一次（扩展模式只有 32768 的窗口）
        if (
          !standardForced &&
          !receivedContent &&
          modelCaps(initial.model ?? currentModel()).serverTools &&
          isTooLongError(error)
        ) {
          standardForced = true
          continue
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        // 历史图片超过服务端尺寸限制：清掉 serverId 重发一次，上传时会自动降采样
        if (
          attempt < 1 &&
          !receivedContent &&
          error instanceof Error &&
          /image is too large/i.test(error.message) &&
          resetImageServerIds(sessionId)
        ) {
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (error instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    // 自动备份按"完成的回复条数"计数，失败的回复不计
    if (reply.status === 'done') {
      noteReplyCompleted()
    }
  }
}
