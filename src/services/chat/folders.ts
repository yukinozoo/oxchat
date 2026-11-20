import { create } from 'zustand'
import { createId } from '../../utils/id.js'

/**
 * 会话分组：只保存「分组本身」和「会话属于哪个分组」的映射，
 * 会话数据仍然在 IndexedDB 里；删除分组只是清掉映射，对话不受影响。
 */
export type SessionFolder = {
  id: string
  name: string
  createdAt: number
}

type FolderState = {
  folders: SessionFolder[]
  /** 会话 id → 分组 id；没有条目就是「未分组」 */
  assignments: Record<string, string>
  /** 折叠中的分组 id */
  collapsed: Record<string, true>
  ready: boolean
}

const STORAGE_KEY = 'oxchat:session-folders'
/**
 * 上一次的非空快照。分组映射曾经因为「会话列表还没加载就清理悬空映射」被整片删掉，
 * 这里留一份上一版，万一再次被清空，加载时能自动救回来。
 */
const BACKUP_KEY = 'oxchat:session-folders.bak'

const empty: FolderState = { folders: [], assignments: {}, collapsed: {}, ready: false }

/** 读取时做一次结构校验，脏数据不会把侧边栏搞崩 */
export const normalizeFolderState = (raw: unknown): Pick<FolderState, 'folders' | 'assignments' | 'collapsed'> => {
  const record = (raw ?? {}) as Record<string, unknown>
  const folders: SessionFolder[] = Array.isArray(record.folders)
    ? record.folders.flatMap((item) => {
        const folder = item as Partial<SessionFolder>
        if (typeof folder.id !== 'string' || !folder.id) {
          return []
        }
        return [
          {
            id: folder.id,
            name: typeof folder.name === 'string' && folder.name ? folder.name : '未命名分组',
            createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : Date.now(),
          },
        ]
      })
    : []
  const known = new Set(folders.map((folder) => folder.id))
  const assignments: Record<string, string> = {}
  const rawAssignments = (record.assignments ?? {}) as Record<string, unknown>
  for (const [sessionId, folderId] of Object.entries(rawAssignments)) {
    // 指向已不存在分组的映射直接丢弃，会话自动回到未分组
    if (typeof folderId === 'string' && known.has(folderId)) {
      assignments[sessionId] = folderId
    }
  }
  const collapsed: Record<string, true> = {}
  const rawCollapsed = (record.collapsed ?? {}) as Record<string, unknown>
  for (const [folderId, value] of Object.entries(rawCollapsed)) {
    if (value && known.has(folderId)) {
      collapsed[folderId] = true
    }
  }
  return { folders, assignments, collapsed }
}

/** 读取（可注入 storage：冒烟里验证「主键被清空后从备份恢复」） */
export const loadFolders = (
  storage?: Storage
): Pick<FolderState, 'folders' | 'assignments' | 'collapsed'> => {
  try {
    // 没有 localStorage（Node/隐私模式）时按空库处理；参数只为冒烟注入
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    if (!target) {
      return { folders: [], assignments: {}, collapsed: {} }
    }
    const raw = target.getItem(STORAGE_KEY)
    const state = normalizeFolderState(raw ? JSON.parse(raw) : null)
    if (Object.keys(state.assignments).length > 0 || state.folders.length === 0) {
      return state
    }
    // 主键里有分组却一条映射都没有：很可能是被误清过，用上一版快照救回来
    const backup = target.getItem(BACKUP_KEY)
    if (!backup) {
      return state
    }
    const restored = normalizeFolderState(JSON.parse(backup))
    return Object.keys(restored.assignments).length > 0 ? restored : state
  } catch {
    return { folders: [], assignments: {}, collapsed: {} }
  }
}

export const useFolders = create<FolderState>(() => ({ ...empty, ...loadFolders(), ready: true }))

const persist = () => {
  const { folders, assignments, collapsed } = useFolders.getState()
  try {
    const next = JSON.stringify({ folders, assignments, collapsed })
    const previous = localStorage.getItem(STORAGE_KEY)
    // 只有「原来有映射、这次会更少」时才留快照，避免把备份也写成空的
    if (previous && Object.keys(assignments).length > 0) {
      try {
        const old = normalizeFolderState(JSON.parse(previous))
        if (Object.keys(old.assignments).length > Object.keys(assignments).length) {
          localStorage.setItem(BACKUP_KEY, previous)
          localStorage.setItem(STORAGE_KEY, next)
          return
        }
      } catch {
        // 旧值坏了就直接覆盖
      }
    }
    if (Object.keys(assignments).length > 0) {
      localStorage.setItem(BACKUP_KEY, next)
    }
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存储不可用时只在内存里生效
  }
}

export const createFolder = (name: string): string => {
  const folder: SessionFolder = {
    id: createId(),
    name: name.trim() || '未命名分组',
    createdAt: Date.now(),
  }
  useFolders.setState((state) => ({ folders: [...state.folders, folder] }))
  persist()
  return folder.id
}

export const renameFolder = (id: string, name: string) => {
  const trimmed = name.trim()
  if (!trimmed) {
    return
  }
  useFolders.setState((state) => ({
    folders: state.folders.map((folder) =>
      folder.id === id ? { ...folder, name: trimmed } : folder
    ),
  }))
  persist()
}

/** 删除分组：只清映射与折叠状态，组内会话回到未分组 */
export const removeFolder = (id: string) => {
  useFolders.setState((state) => ({
    folders: state.folders.filter((folder) => folder.id !== id),
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(([, folderId]) => folderId !== id)
    ),
    collapsed: Object.fromEntries(
      Object.entries(state.collapsed).filter(([folderId]) => folderId !== id)
    ) as Record<string, true>,
  }))
  persist()
}

export const toggleFolder = (id: string) => {
  useFolders.setState((state) => {
    const folded = Boolean(state.collapsed[id])
    const rest = Object.entries(state.collapsed).filter(([folderId]) => folderId !== id)
    return {
      collapsed: Object.fromEntries(folded ? rest : [...rest, [id, true]]) as Record<string, true>,
    }
  })
  persist()
}

/** 把会话移进分组；folderId 为 null 表示移出（回到未分组） */
export const assignSessionFolder = (sessionId: string, folderId: string | null) => {
  useFolders.setState((state) => {
    const kept = Object.entries(state.assignments).filter(([id]) => id !== sessionId)
    return { assignments: Object.fromEntries(folderId ? [...kept, [sessionId, folderId]] : kept) }
  })
  persist()
}

/** 会话被删除后清理残留映射 */
export const pruneAssignments = (existingIds: ReadonlySet<string>) => {
  // 空集合几乎只可能出现在「会话还没加载完」或「正在替换历史」，
  // 这时候清映射等于把用户的分组整片删掉，宁可不清理
  if (existingIds.size === 0) {
    return
  }
  const state = useFolders.getState()
  const entries = Object.entries(state.assignments).filter(([sessionId]) =>
    existingIds.has(sessionId)
  )
  if (entries.length === Object.keys(state.assignments).length) {
    return
  }
  useFolders.setState({ assignments: Object.fromEntries(entries) })
  persist()
}
