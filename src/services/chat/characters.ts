import logoUrl from '../../assets/icon-192.png'
import { translate, type TranslationKey } from '../../i18n/index.js'
import { DEFAULT_GLOBAL_PROMPT, useSettings } from '../settings.js'
import type { Session } from './types.js'

/** 内置角色的头像：应用 logo */
const LOGO_URL = logoUrl

/**
 * 角色：一段「每次提问前发给模型的设定」，可以带名字、头像与一句说明。
 *
 * 两种来源，读写规则不同：
 * - 内置角色「DeepSeek 助手」：名字走 i18n，**只读**（不可改、不可删）；
 * - 自定义角色：整条存在 `oxchat:characters`，可新建、编辑、删除；
 * - 旧数据：以前只有一个全局提示词（`settings.globalPrompt`），首次加载会把它迁移成一条自定义角色。
 *
 * 会话通过 `Session.characterId` 选角色；没选就跟随默认角色（新对话页切换的就是它）。
 *
 * 字段口径按酒馆 v2 卡命名对齐（`first_mes` → `greetings[0]`、`mes_example` → `mesExample`），
 * 这样以后做角色卡导入导出时不用再翻译一遍字段名。
 */
export type Character = {
  id: string
  /** 内置角色的名字走 i18n key；自定义或改过名的直接用 name */
  name?: string
  nameKey?: string
  hintKey?: string
  /** 一句说明，只显示在列表里，不进上下文 */
  description?: string
  /** 头像 data URL；空表示用「灰底 + 名字首字」占位 */
  avatar?: string
  /** 真正发给模型的设定（旧字段，保留兼容；systemPrompt 非空时优先） */
  prompt: string
  /** 系统提示：填了就取代 prompt */
  systemPrompt?: string
  /** 性格 */
  personality?: string
  /** 场景 */
  scenario?: string
  /** 说话风格：口癖、句式、怎么称呼对方 */
  style?: string
  /** 行为准则：底线、不会做什么（ds-lite 的 behavior 也并到这里） */
  rules?: string
  /** 昵称：{{char}} 会优先替换成它 */
  nickname?: string
  /** 标签（只用于列表，不发给模型） */
  tags?: string[]
  /** 作者 */
  creator?: string
  /** 卡的版本号 */
  version?: string
  /** 开场白：第一条是主开场，其余是备选 */
  greetings?: string[]
  /** 示例对话，每段用 <START> 开头 */
  mesExample?: string
  /**
   * 风格样例：角色自己的原话（6~12 条），挑自旧对话。
   * 比 `mesExample` 好维护（逐条勾选/换一批），注入时排在「说话风格」后面。
   */
  styleSamples?: string[]
  /** 剧情时间线：已发生的关键事件与未兑现的约定，可增量更新；压缩不会改写它 */
  timeline?: string
  /** 锁定模型：填了就用它发消息（换设备/换角色不用再手动切） */
  model?: string
  /** 历史后指令：放在对话历史之后，用来防出戏 */
  postHistoryPrompt?: string
  /** 作者说明：给看卡的人，不进上下文 */
  creatorNotes?: string
  /** 内置角色不可删除 */
  builtin: boolean
}

/** 自定义角色里可以改的字段 */
export type CharacterPatch = Partial<
  Pick<
    Character,
    | 'name'
    | 'description'
    | 'avatar'
    | 'prompt'
    | 'systemPrompt'
    | 'personality'
    | 'scenario'
    | 'style'
    | 'rules'
    | 'nickname'
    | 'tags'
    | 'creator'
    | 'version'
    | 'greetings'
    | 'mesExample'
    | 'styleSamples'
    | 'timeline'
    | 'model'
    | 'postHistoryPrompt'
    | 'creatorNotes'
  >
>

/** 落盘的字段集合：只存改过的、非空的，空值等于「回到默认」 */
const PATCH_KEYS = [
  'name',
  'description',
  'avatar',
  'prompt',
  'systemPrompt',
  'personality',
  'scenario',
  'style',
  'rules',
  'nickname',
  'tags',
  'creator',
  'version',
  'greetings',
  'mesExample',
  'styleSamples',
  'timeline',
  'model',
  'postHistoryPrompt',
  'creatorNotes',
] as const satisfies readonly (keyof CharacterPatch)[]

type Override = Partial<Pick<Character, (typeof PATCH_KEYS)[number]>>

/** 存进 localStorage 的自定义角色：补丁字段 + id */
type StoredCharacter = Override & { id: string }

/** 写进备份 sidecar 的角色卡（内置角色不进包，它随代码走） */
export type CharacterCard = StoredCharacter

/** 是否允许多个自定义角色 */
export const CUSTOM_ROLES_ENABLED = true

const CUSTOM_KEY = 'oxchat:characters'
/** 旧版本存内置角色改动的位置；内置角色改为只读后不再读取，仅留注释免得下轮又加回来 */
// const OVERRIDES_KEY = 'oxchat:character-overrides'
const DEFAULT_KEY = 'oxchat:character-default'

/**
 * 内置角色：只有一个「DeepSeek 助手」。
 *
 * 头像直接用应用 logo（`assets/icon-192.png`），提示词就是那句固定说明。
 * **内置角色不可修改、不可删除**：想改设定请新建一个自定义角色。
 */
const BUILTIN: readonly Character[] = [
  {
    id: 'default',
    nameKey: 'characterDefaultName',
    hintKey: 'characterDefaultHint',
    avatar: LOGO_URL,
    prompt: '该助手为DeepSeek，由深度求索公司创造。',
    builtin: true,
  },
] as const

export const DEFAULT_CHARACTER_ID = 'default'

const parse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 只挑出有值的补丁字段，避免把 undefined 写进存储 */
const compactPatch = (patch: CharacterPatch): Override => {
  const next: Override = {}
  for (const key of PATCH_KEYS) {
    const value = patch[key]
    if (value === undefined) {
      continue
    }
    // 空串 / 空数组视为「清空这个字段」
    Object.assign(next, { [key]: value })
  }
  return next
}

const readCustom = (): StoredCharacter[] => {
  try {
    const parsed = parse<StoredCharacter[]>(localStorage.getItem(CUSTOM_KEY), [])
    return parsed.filter((item) => typeof item?.id === 'string' && item.id !== '')
  } catch {
    return []
  }
}

const writeCustom = (list: StoredCharacter[]): void => {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    // 存不下就只在本次会话里生效
  }
}

/** 全部角色：内置在前，自定义在后。内置角色只读，不再套用旧的 overrides */
export const listCharacters = (): Character[] => {
  const builtins = BUILTIN.map((character) => ({ ...character }))
  const custom: Character[] = CUSTOM_ROLES_ENABLED
    ? readCustom().map((character) => ({
        ...character,
        name: character.name ?? '',
        prompt: character.prompt ?? '',
        builtin: false,
      }))
    : []
  return [...builtins, ...custom]
}

/** 按 id 取角色；兼容旧 id `custom`（映射到第一条自定义角色） */
export const characterById = (id: string | null | undefined): Character | undefined => {
  if (!id) {
    return undefined
  }
  const list = listCharacters()
  const found = list.find((character) => character.id === id)
  if (found) {
    return found
  }
  if (id === 'custom') {
    return list.find((character) => !character.builtin)
  }
  return undefined
}

export const isBuiltinCharacter = (id: string): boolean =>
  BUILTIN.some((character) => character.id === id)

/** 界面上显示的名字：自定义名优先，其次 i18n，最后兜底 */
export const displayNameOfCharacter = (character: Character | undefined): string => {
  if (!character) {
    return translate('characterDefaultName')
  }
  const name = character.name?.trim()
  if (name) {
    return name
  }
  return character.nameKey ? translate(character.nameKey as TranslationKey) : ''
}

/** 某个角色的实际提示词：空提示词回落到默认设定 */
export const promptOfCharacter = (character: Character | undefined): string =>
  character?.prompt.trim() || DEFAULT_GLOBAL_PROMPT

/** 用户名字与头像（「我的角色」） */
export const userProfile = (): { name: string; avatar: string } => {
  const { userName, userAvatar } = useSettings.getState()
  return { name: userName.trim(), avatar: userAvatar }
}

/**
 * 角色卡文本里的宏替换（酒馆那套 `{{char}}` / `{{user}}`）。
 * 未识别的宏原样保留，输入异常时返回空字符串。
 */
export const substituteMacros = (text: string, vars: { char: string; user: string }): string => {
  if (typeof text !== 'string' || text === '') {
    return ''
  }
  return text
    .replace(/\{\{\s*char\s*\}\}/gi, () => vars.char)
    .replace(/\{\{\s*user\s*\}\}/gi, () => vars.user)
    .replace(/<BOT>/gi, () => vars.char)
    .replace(/<USER>/gi, () => vars.user)
}

/** 第 index 条开场白（越界回落到第一条） */
export const greetingOf = (character: Character | undefined, index = 0): string => {
  const list = character?.greetings ?? []
  if (list.length === 0) {
    return ''
  }
  const safe = index >= 0 && index < list.length ? index : 0
  return list[safe] ?? ''
}

/**
 * 把角色的各段设定拼成 system。
 *
 * 顺序：设定（systemPrompt / prompt）→ 角色设定（描述）→ 性格 → 说话风格 → 行为准则
 * → 场景 → 对话示例 → 补充要求（历史后指令）→ 【开场白】→ 【用户】称呼。
 * 空字段整段跳过 —— 内置默认角色没有额外字段，拼出来和旧行为完全一致。
 */
export const composeSystemPrompt = (
  character: Character | undefined,
  userName: string,
  greetingIndex = 0
): string => {
  const charName = character?.nickname?.trim() || displayNameOfCharacter(character)
  const vars = { char: charName, user: userName }
  const blocks: string[] = []

  const base = character?.systemPrompt?.trim() || promptOfCharacter(character)
  if (base.trim() !== '') {
    blocks.push(substituteMacros(base, vars).trim())
  }

  // 原话样例：逐条编号，标注「保持同样的语气」——摘要会丢语气，原话不会
  const samples = (character?.styleSamples ?? [])
    .map((sample) => sample.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((sample, index) => `${index + 1}. ${sample}`)
    .join('\n')
  const sections: { title: string; text: string | undefined }[] = [
    { title: '角色设定', text: character?.description },
    { title: '性格', text: character?.personality },
    { title: '说话风格', text: character?.style },
    {
      title: '原话样例',
      text: samples
        ? `以下是这个角色说过的话，回复时保持同样的语气与用词：\n${samples}`
        : undefined,
    },
    { title: '行为准则', text: character?.rules },
    { title: '场景', text: character?.scenario },
    { title: '剧情时间线', text: character?.timeline },
    { title: '对话示例', text: character?.mesExample },
    { title: '补充要求', text: character?.postHistoryPrompt },
  ]
  for (const section of sections) {
    const raw = section.text?.trim()
    if (!raw) {
      continue
    }
    blocks.push(`【${section.title}】\n${substituteMacros(raw, vars).trim()}`)
  }

  const greeting = greetingOf(character, greetingIndex).trim()
  if (greeting) {
    const line = substituteMacros(greeting, vars).trim()
    if (line) {
      blocks.push(`【开场白】对话已经从你的一句话开始：「${line}」`)
    }
  }

  if (userName) {
    blocks.push(`【用户】对方叫「${userName}」，需要称呼时用这个名字。`)
  }
  return blocks.join('\n\n')
}

/**
 * system 里「你是谁」那一段：角色设定 + 用户称呼。
 * 用户名字只在这里注入，界面上的改动会立刻影响模型怎么称呼你。
 */
export const systemPromptOfSession = (session: Session | undefined): string => {
  const { name } = userProfile()
  return composeSystemPrompt(
    characterById(characterIdOfSession(session)),
    name,
    session?.greetingIndex ?? 0
  )
}

/** 新对话默认用哪个角色：存过且还存在就用它，否则内置第一个 */
export const defaultCharacterId = (): string => {
  try {
    const stored = localStorage.getItem(DEFAULT_KEY)
    if (stored && characterById(stored)) {
      return stored
    }
  } catch {
    // 忽略
  }
  return DEFAULT_CHARACTER_ID
}

export const setDefaultCharacterId = (id: string): void => {
  try {
    localStorage.setItem(DEFAULT_KEY, id)
  } catch {
    // 忽略
  }
}

/** 会话当前角色：会话没设置就跟随默认 */
export const characterIdOfSession = (session: Session | undefined): string => {
  const id = session?.characterId
  if (id && characterById(id)) {
    return characterById(id)?.id ?? DEFAULT_CHARACTER_ID
  }
  return defaultCharacterId()
}

/** 新建一条自定义角色（先给个空壳，交给编辑页填） */
export const createCharacter = (name = ''): string => {
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const list = readCustom()
  writeCustom([
    ...list,
    { id, name: name.trim() || translate('roleNewDefaultName'), prompt: '', greetings: [''] },
  ])
  return id
}

/** 更新角色：只改自定义角色；内置角色不可修改，直接忽略 */
export const updateCharacter = (id: string, patch: CharacterPatch): void => {
  if (isBuiltinCharacter(id)) {
    return
  }
  const next = compactPatch(patch)
  writeCustom(
    readCustom().map((character) => (character.id === id ? { ...character, ...next } : character))
  )
}

/** 删除自定义角色；内置角色不可删 */
export const deleteCharacter = (id: string): void => {
  if (isBuiltinCharacter(id)) {
    return
  }
  writeCustom(readCustom().filter((character) => character.id !== id))
  try {
    if (localStorage.getItem(DEFAULT_KEY) === id) {
      localStorage.removeItem(DEFAULT_KEY)
    }
  } catch {
    // 忽略
  }
}

/** 导出全部自定义角色卡（内置角色不进包：它随代码版本走，导出去反而会被旧版覆盖） */
export const exportCharacterCards = (): CharacterCard[] =>
  CUSTOM_ROLES_ENABLED ? readCustom() : []

/**
 * 合并来自备份包 / 同步包的角色卡。
 *
 * 只追加本地没有的 id —— 同名不同 id 的卡保留两份，绝不按名字覆盖：
 * 用户可能在不同设备上改过同一张卡的副本，静默覆盖比多一条更难解释。
 */
export const mergeCharacterCards = (incoming: unknown): number => {
  if (!CUSTOM_ROLES_ENABLED || !Array.isArray(incoming)) {
    return 0
  }
  const existing = new Set(readCustom().map((character) => character.id))
  const toAdd: StoredCharacter[] = []
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const item = raw as Partial<StoredCharacter>
    if (typeof item.id !== 'string' || item.id === '' || existing.has(item.id)) {
      continue
    }
    if (typeof item.name !== 'string') {
      continue
    }
    existing.add(item.id)
    toAdd.push({ ...item, id: item.id, name: item.name })
  }
  if (toAdd.length === 0) {
    return 0
  }
  writeCustom([...readCustom(), ...toAdd])
  return toAdd.length
}

/** 复制一张卡（含内置）成新的自定义角色，返回新 id；用于「内置只读但想微调」 */
export const duplicateCharacter = (id: string): string | null => {
  const source = characterById(id)
  if (!source) {
    return null
  }
  const newId = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const card: StoredCharacter = {
    id: newId,
    name: `${displayNameOfCharacter(source)} 副本`,
    prompt: source.prompt,
    ...(source.nickname ? { nickname: source.nickname } : {}),
    ...(source.description ? { description: source.description } : {}),
    ...(source.personality ? { personality: source.personality } : {}),
    ...(source.scenario ? { scenario: source.scenario } : {}),
    ...(source.style ? { style: source.style } : {}),
    ...(source.rules ? { rules: source.rules } : {}),
    ...(source.greetings?.length ? { greetings: [...source.greetings] } : {}),
    ...(source.mesExample ? { mesExample: source.mesExample } : {}),
    ...(source.systemPrompt ? { systemPrompt: source.systemPrompt } : {}),
    ...(source.postHistoryPrompt ? { postHistoryPrompt: source.postHistoryPrompt } : {}),
    ...(source.tags?.length ? { tags: [...source.tags] } : {}),
  }
  writeCustom([...readCustom(), card])
  return newId
}

