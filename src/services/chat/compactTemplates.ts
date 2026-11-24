import { translate, type TranslationKey } from '../../i18n/index.js'

/**
 * 内置的「摘要模板」。
 *
 * 一个模板 = 名字（i18n key）+ 一段**完整的摘要提示词**。
 * 选中模板后，这段提示词会取代默认的通用规则发给模型；
 * 用户在「重点留下什么」里写的文字仍作为「额外要求」追加在最前面。
 *
 * 提示词里的 `{target_chars}` 会在发送前替换成「摘要长度」设置的数字，
 * 这样模板自己就能控制篇幅，不用再靠默认规则兜。
 */
export type CompactTemplate = {
  id: string
  /** 显示名（内置已本地化，自定义是用户写的） */
  name: string
  /** 卡片下面那句灰字，说明这个模板侧重什么 */
  hint: string
  prompt: string
  /** 内置模板：可改、可恢复默认，但不能删 */
  builtin: boolean
  /** 内置模板被改过（界面上给「恢复默认」） */
  edited: boolean
}

/** 内置模板的原始定义；对外的 `listCompactTemplates()` 已经合并了用户改动 */
const BUILTIN_DEFS: readonly { id: string; nameKey: string; hintKey: string; prompt: string }[] = [
  {
    id: 'general',
    nameKey: 'compactTemplateGeneral',
    hintKey: 'compactTemplateGeneralHint',
    prompt: `把这段对话收成一份「接着聊就能直接用」的摘要——不是会议纪要，也不用硬凑成任务清单。

请覆盖这些：
· 眼下在聊什么：当前焦点、用户想要的落点；目标改过就只保留最新的那个。
· 继续往下聊要用到的事实：已确认的信息、人物与对象的指代、时间与先后关系。
· 用户的明确要求：仍在生效的偏好、口径和禁区。一次具体的表现不等于长期设定，别据此下结论。
· 决定与理由：定了什么、为什么定；被否掉的思路留一句话，免得重复推荐。
· 已经落地的事、还悬着的问、需要用户补充的材料。
· 交流基调：语气、称呼、关系层面的背景——只写原文里真的出现过的内容。
· 影响理解的更正、含糊之处、以及还没定下来的点。

组织方式：可借用「现在聊什么 / 必要背景 / 要求与决定 / 未了的事」这类小标题；某一项没有内容就整节不写。
收尾：早已翻篇且不再影响当下的旧话题不必带过来，过渡期遗留的目标也别让它压过现在的重点。全文控制在 {target_chars} 字以内。`,
  },
  {
    id: 'roleplay',
    nameKey: 'compactTemplateRoleplay',
    hintKey: 'compactTemplateRoleplayHint',
    prompt: `生成一份「接着演下去」用的连续性摘要。不要下场扮演角色、不要续写剧情，也不要替玩家决定行动。

请覆盖：
· 作者约束：仍然有效的指令、角色分工、叙事视角，以及哪些角色或行动归玩家掌控。
· 场景坐标：时间、地点、在场的人，事件停在哪个瞬间——没有原文依据的不补。
· 关键事件：按先后写清谁做了什么、出于什么动机、对方如何反应、结果如何。
· 人物当下：伤势、能力限制、情绪、信任与关系的变化；情绪与动机只写叙述明确支持的部分。
· 物品与牵挂：东西在谁手上、许下的承诺、欠下的人情、任务、秘密、未化解的冲突，以及状态变化的原因。
· 各自知道什么：按角色分开写「知道 / 相信 / 怀疑 / 误解 / 瞒着 / 明说不知道 / 原文未交代」。未交代不等于不知情；一个人发现的事不能顺手写成所有人的共识。
· 事实分层：区分已经确立的世界事实、作者的明确修订、角色自己的认知。仅供理解的世界书设定不能自行升级为 canon 或角色知识。
· 未收的线：已埋下的伏笔、没兑现的承诺、还开着的剧情线——不替作者编后续。
· 有效修订：作者明确的 OOC 改设定、改名、回滚与 retcon；无关 OOC 闲聊略过，但会改变设定的修订要记下，并标注被替代的旧版本。
· 悬而未决：含糊或互相冲突之处保留归属与不确定，不替作者裁定。
· 输出约定：约定的语言、人称、时态、对白与叙述的比例、回复格式，以及有原文依据的说话特点。必要时留一两句真实原句当风格锚点，但别造夸张口癖，也别把一次情绪当成永久语气。

建议分节：作者约束 / 当前场景 / 关键事件 / 人物与物品 / 各自知识 / 未解线索 / 有效修订；没有内容的小节整节不写。
过去的争执不必一直挂着，关系已经变化就写现在的状态。专有名词、特殊术语与必须原样保留的句子保持原样。全文不超过 {target_chars} 字。`,
  },
  {
    id: 'work',
    nameKey: 'compactTemplateWork',
    hintKey: 'compactTemplateWorkHint',
    prompt: `把这段对话整理成一份工作交接用的摘要，让接手的人不翻原文也能继续推进。

请覆盖：
· 任务背景：要解决什么问题、涉及的项目与范围、做到什么程度算完成。
· 当前进度：已经交付了什么、停在哪一步、卡在哪里。
· 决策与理由：定了哪些做法、为什么；已经排除的方案各留一句，免得重复讨论。
· 人与时间：谁负责、谁在等谁、关键时间点与截止日期。
· 风险与阻塞：已知的坑、外部依赖、需要上级或他人拍板的事。
· 口径与术语：项目内特有的叫法、缩写、字段含义——原样保留，不要翻译或改写。
· 对外沟通：需要同步给谁、已经承诺过什么、措辞上的忌讳。

要求：数字、日期、版本号、金额、链接与命令按原样保留；已确认与仍待定的分开写，不要把"提议"记成"已定"；不要替用户答应任何事。
建议分节：任务与目标 / 当前进度 / 决定与理由 / 人与时间 / 风险阻塞 / 术语口径；没有内容的小节不写。全文不超过 {target_chars} 字。`,
  },
  {
    id: 'plan',
    nameKey: 'compactTemplatePlan',
    hintKey: 'compactTemplatePlanHint',
    prompt: `把这段对话整理成一份个人计划摘要，下次接着安排时照着就能推进。

请覆盖：
· 目标与约束：想达成什么、有哪些硬条件（预算、时间、身体状态、同行的人）。
· 已定的安排：日期、地点、金额、数量、已经订好的东西——数字原样抄，不要四舍五入。
· 比较过的选项：考虑过什么、为什么没选，各留一句结论即可。
· 待办与顺序：谁做什么、先后依赖、哪一项要在什么时候之前完成。
· 预算与花费：已花与预计要花，分项写清。
· 悬而未决：还需要拍板的点、在等别人回复的事、可能变动的部分。

要求：寒暄与重复确认合并成一句；不要把提议写成已定；不要替用户新增他没同意的任务。
建议分节：目标与约束 / 已定 / 备选与否决 / 待办 / 花费 / 待定；没有内容的小节不写。全文不超过 {target_chars} 字。`,
  },
  {
    id: 'study',
    nameKey: 'compactTemplateStudy',
    hintKey: 'compactTemplateStudyHint',
    prompt: `把这段对话整理成一份能复习的笔记，之后不必再翻原文。

请覆盖：
· 概念与边界：是什么、解决什么问题、和相近概念的区别。
· 原理与因果：为什么成立、前提是什么、什么情况下不适用。
· 步骤与命令：按执行顺序写，参数含义跟上；命令与配置原样保留。
· 结论与易错点：最终结论、踩过的坑、被纠正过的理解（写纠正后的版本）。
· 待补：还没弄懂或没验证过的点，明确标出来，不要假装已经确定。

要求：术语、代码、公式、引用来源按原样保留；例子压成一句"例：…"；寒暄与推理过程删掉。
建议分节：概念 / 原理 / 步骤 / 结论与易错点 / 待补；没有内容的小节不写。全文不超过 {target_chars} 字。`,
  },
] as const

/** 内置模板的原始定义（只读，供冒烟与差异对比用；界面请用 listCompactTemplates） */
export const BUILTIN_TEMPLATES = BUILTIN_DEFS

/** 旧 id 迁移：早期版本叫 debug，现在叫 work */
const LEGACY_IDS: Record<string, string> = { debug: 'work' }

/** 把 {target_chars} 换成实际字数；其它未知占位符原样留着，方便排查 */
export const renderTemplatePrompt = (prompt: string, targetChars: number): string =>
  prompt.replace(/\{target_chars\}/g, String(Math.max(1, Math.round(targetChars))))

/** 旧 id 迁移后的 key：custom 存自己的，内置按 id 覆盖 */
const OVERRIDES_KEY = 'oxchat:compact-template-overrides'
const CUSTOM_KEY = 'oxchat:compact-template-custom'

type Override = { name?: string; prompt?: string }
type CustomTemplate = { id: string; name: string; prompt: string }

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

const readOverrides = (): Record<string, Override> =>
  parse<Record<string, Override>>(localStorage.getItem(OVERRIDES_KEY), {})

const writeOverrides = (overrides: Record<string, Override>): void => {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // 存不下就只在本次生效
  }
}

const readCustom = (): CustomTemplate[] =>
  parse<CustomTemplate[]>(localStorage.getItem(CUSTOM_KEY), []).filter(
    (item) => typeof item?.id === 'string' && typeof item?.name === 'string'
  )

const writeCustom = (list: CustomTemplate[]): void => {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    // 忽略
  }
}

/** 全部模板：内置（合并改动）在前，自定义在后 */
export const listCompactTemplates = (): CompactTemplate[] => {
  const overrides = readOverrides()
  const builtins: CompactTemplate[] = BUILTIN_DEFS.map((def) => {
    const patch = overrides[def.id]
    return {
      id: def.id,
      name: translate(def.nameKey as TranslationKey),
      hint: translate(def.hintKey as TranslationKey),
      prompt: patch?.prompt ?? def.prompt,
      builtin: true,
      edited: Boolean(patch?.prompt || patch?.name),
    }
  })
  const custom: CompactTemplate[] = readCustom().map((item) => ({
    id: item.id,
    name: item.name,
    hint: item.prompt.trim().split('\n')[0]?.slice(0, 40) ?? '',
    prompt: item.prompt,
    builtin: false,
    edited: false,
  }))
  return [...builtins, ...custom]
}

/** 按 id 取模板（含用户改动与自定义）；找不到回落到「通用」 */
export const templateById = (id: string | undefined): CompactTemplate => {
  const key = id ? (LEGACY_IDS[id] ?? id) : undefined
  const list = listCompactTemplates()
  return list.find((template) => template.id === key) ?? list[0]
}

/** 新建一个模板骨架，返回 id（提示词里预置 {target_chars}，否则字数设置会失效） */
export const createCompactTemplate = (name: string): string => {
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  writeCustom([
    ...readCustom(),
    {
      id,
      name,
      prompt: `把这段对话整理成一份能接着用的摘要。\n\n重点是：\n· 现在在做什么\n· 已经确认的事实\n· 还没解决的事\n\n全文控制在 {target_chars} 字以内。`,
    },
  ])
  return id
}

/** 保存改动：内置写 overrides（可恢复默认），自定义改整条 */
export const updateCompactTemplate = (id: string, patch: { name?: string; prompt?: string }): void => {
  const isBuiltin = BUILTIN_DEFS.some((def) => def.id === id)
  if (isBuiltin) {
    const overrides = readOverrides()
    writeOverrides({
      ...overrides,
      [id]: {
        ...overrides[id],
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      },
    })
    return
  }
  writeCustom(
    readCustom().map((item) =>
      item.id === id
        ? {
            ...item,
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          }
        : item
    )
  )
}

/** 内置模板恢复默认：删掉它的改动 */
export const resetCompactTemplate = (id: string): void => {
  const overrides = readOverrides()
  if (!Object.hasOwn(overrides, id)) {
    return
  }
  const next: Record<string, Override> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== id) {
      next[key] = value
    }
  }
  writeOverrides(next)
}

/** 复制任意模板（含内置）成一份自定义模板 */
export const duplicateCompactTemplate = (id: string): string | null => {
  const source = templateById(id)
  if (!source) {
    return null
  }
  const newId = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  writeCustom([
    ...readCustom(),
    { id: newId, name: `${source.name} 副本`, prompt: source.prompt },
  ])
  return newId
}

/** 删除自定义模板；内置模板删不掉（只能恢复默认） */
export const deleteCompactTemplate = (id: string): boolean => {
  if (BUILTIN_DEFS.some((def) => def.id === id)) {
    return false
  }
  const before = readCustom()
  const after = before.filter((item) => item.id !== id)
  if (after.length === before.length) {
    return false
  }
  writeCustom(after)
  return true
}
