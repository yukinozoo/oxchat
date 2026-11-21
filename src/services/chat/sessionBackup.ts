import { translate } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import type { Session } from './types.js'

/**
 * 整理（压缩）前的备份：复制一份当前会话，标题带「整理前备份」后缀。
 * 只复制消息文本与分支结构，不复制附件原件（附件按 id 复用本地存储）。
 */
export const createBackupSession = (session: Session, now = Date.now()): Session => {
  const suffix = translate('memoryBackupSuffix')
  const title = `${session.title || translate('untitledChat')} ${suffix}`
  return {
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: session.messages.map((message) => ({ ...message })),
    ...(session.rootMessageId === undefined ? {} : { rootMessageId: session.rootMessageId }),
    ...(session.memory === undefined ? {} : { memory: session.memory }),
  }
}
