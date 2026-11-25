import {
  createCharacter,
  updateCharacter,
  type Character,
  type CharacterPatch,
} from './characters.js'

/**
 * 角色卡的 JSON 导入导出（酒馆 v2 口径）。
 *
 * 写出去的结构是标准的 `{ spec: 'chara_card_v2', spec_version: '2.0', data: … }`，
 * 酒馆 / Risu / Agnai 都能直接读；OxChat 自己的两段（说话风格、行为准则）放在
 * `data.extensions.oxchat` 里 —— 规范明确禁止往 `data` 顶层加自定义键。
 *
 * 读进来时 v2 / v3 / v1（顶层扁平）都认：取 `data` 有就用，没有就按顶层字段读。
 */
export type CardOutcome = { ok: true; id: string } | { ok: false; error: CardError }
export type CardError = 'json' | 'shape' | 'name'

type Loose = Record<string, unknown>

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => str(item).trim()).filter((item) => item !== '') : []

const asRecord = (value: unknown): Loose | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null

/** 把一张卡写成酒馆 v2 JSON 文本 */
export const characterToCardJson = (character: Character): string => {
  const greetings = character.greetings ?? []
  const oxchat = {
    ...(character.prompt ? { prompt: character.prompt } : {}),
    ...(character.style ? { style: character.style } : {}),
    ...(character.rules ? { rules: character.rules } : {}),
    ...(character.avatar ? { avatar: character.avatar } : {}),
    // 人设延续用的三样：原话样例、剧情时间线、锁定模型
    ...(character.styleSamples?.length ? { styleSamples: character.styleSamples } : {}),
    ...(character.timeline ? { timeline: character.timeline } : {}),
    ...(character.model ? { model: character.model } : {}),
  }
  const data = {
    name: character.name ?? '',
    ...(character.nickname ? { nickname: character.nickname } : {}),
    description: character.description ?? '',
    personality: character.personality ?? '',
    scenario: character.scenario ?? '',
    first_mes: greetings[0] ?? '',
    alternate_greetings: greetings.slice(1),
    mes_example: character.mesExample ?? '',
    system_prompt: character.systemPrompt || character.prompt || '',
    post_history_instructions: character.postHistoryPrompt ?? '',
    creator_notes: character.creatorNotes ?? '',
    tags: character.tags ?? [],
    creator: character.creator ?? '',
    character_version: character.version ?? '',
    extensions: Object.keys(oxchat).length > 0 ? { oxchat } : {},
  }
  return JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data }, null, 2)
}

/** 解析一张卡（v2 / v3 / v1 都认），只做结构归一，不落库 */
export const parseCharacterCard = (text: string): { ok: true; patch: CharacterPatch } | { ok: false; error: CardError } => {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'json' }
  }
  let root: unknown
  try {
    root = JSON.parse(text) as unknown
  } catch {
    return { ok: false, error: 'json' }
  }
  const outer = asRecord(root)
  if (!outer) {
    return { ok: false, error: 'shape' }
  }
  const data = asRecord(outer.data) ?? outer
  const name = (str(data.name) || str(data.nickname)).trim()
  if (!name) {
    return { ok: false, error: 'name' }
  }

  const ext = asRecord(data.extensions)
  const oxchat = asRecord(ext?.oxchat)

  const greetings = [
    str(data.first_mes).trim(),
    ...strArray(data.alternate_greetings),
  ].filter((item) => item !== '')

  const patch: CharacterPatch = {
    name,
    ...(str(data.nickname).trim() ? { nickname: str(data.nickname).trim() } : {}),
    description: str(data.description).trim(),
    personality: str(data.personality).trim(),
    scenario: str(data.scenario).trim(),
    mesExample: str(data.mes_example).trim(),
    systemPrompt: str(data.system_prompt).trim(),
    postHistoryPrompt: str(data.post_history_instructions).trim(),
    creatorNotes: str(data.creator_notes).trim(),
    tags: strArray(data.tags),
    creator: str(data.creator).trim(),
    version: str(data.character_version).trim(),
    greetings,
  }
  // ds-lite 出品的卡把风格/准则放在 data 顶层；OxChat 自己放在 extensions.oxchat
  const style = str(data.style).trim() || str(oxchat?.style).trim()
  const rules = str(data.rules).trim() || str(oxchat?.rules).trim()
  if (style) {
    patch.style = style
  }
  if (rules) {
    patch.rules = rules
  }
  const prompt = str(oxchat?.prompt).trim()
  if (prompt) {
    patch.prompt = prompt
  }
  const avatar = str(oxchat?.avatar)
  if (avatar) {
    patch.avatar = avatar
  }
  const samples = strArray(oxchat?.styleSamples).map((item) => item.trim()).filter(Boolean)
  if (samples.length > 0) {
    patch.styleSamples = samples
  }
  const timeline = str(oxchat?.timeline).trim()
  if (timeline) {
    patch.timeline = timeline
  }
  const model = str(oxchat?.model).trim()
  if (model) {
    patch.model = model
  }
  return { ok: true, patch }
}

/** 导入成一枚新的自定义角色（同 id 的卡不会被动到，导入永远是新增） */
export const importCharacterCard = (text: string): CardOutcome => {
  const parsed = parseCharacterCard(text)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }
  const id = createCharacter(parsed.patch.name ?? '')
  updateCharacter(id, parsed.patch)
  return { ok: true, id }
}
