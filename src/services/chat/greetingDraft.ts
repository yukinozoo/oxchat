/**
 * 新对话页「开场白」的临时选择。
 *
 * 只存「这张卡这次用第几条」，不存正文：正文永远以角色卡为准，改卡后预览跟着变。
 * 发送第一条消息创建会话时，store 把它写进 `Session.greetingIndex`；
 * 之后这条会话的开场白就固定了，不再跟着这里的改动走。
 */
const KEY = 'oxchat:greeting-draft'

type Draft = { characterId: string; index: number }

const read = (): Draft | null => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (typeof parsed.characterId !== 'string' || typeof parsed.index !== 'number') {
      return null
    }
    return { characterId: parsed.characterId, index: parsed.index }
  } catch {
    return null
  }
}

/** 这张卡当前选的是第几条；没选过就是 0 */
export const readGreetingDraft = (characterId: string): number => {
  const draft = read()
  return draft && draft.characterId === characterId ? Math.max(0, Math.floor(draft.index)) : 0
}

export const writeGreetingDraft = (characterId: string, index: number): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ characterId, index }))
  } catch {
    // 存不下就只在本次生效
  }
}
