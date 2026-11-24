import type { MessageParam } from '../api/types.js'
import type { Locale } from '../settings.js'

/**
 * 「向模型提供具体时刻」。
 *
 * 服务端的日期快照（`latest_reminder`）只有日期与星期，没有时分；用户问「现在几点」
 * 时模型只能瞎猜。这里按开关把极简的 `[环境时钟: HH:mm]` 附在**最后一条提问的尾部**：
 *
 * - 尾部只放**纯数据标记**，规则单独一句静态写进 system —— 把整段解释放尾部时，
 *   模型会把那段说明当成用户输入的一部分去回应（会回一句「现在是几点」）；
 * - 不放 system 里带时刻：system 随时钟变会让这一轮的提示词前缀缓存全废，
 *   所以 system 只加与时刻无关的固定一句；
 * - v4-pro（不发日期快照）也照样拿得到时分。
 */

/** 旧版标签：`<system_time>HH:mm（说明文字）</system_time>`，历史里可能还留着 */
const LEGACY_TAG = /<system_time>[\s\S]*?<\/system_time>/g
/** 新版标记：`[环境时钟: HH:mm]` / `[Clock: HH:mm]` */
const TAIL_MARK = /\s*\[(?:环境时钟|Clock):\s*\d{2}:\d{2}\]/g

/** 旧消息里可能已经带过时刻：追加前先剥掉，避免越叠越多 */
export const stripClockTime = (text: string): string =>
  text.replace(LEGACY_TAG, '').replace(TAIL_MARK, '').trimEnd()

/** `HH:mm`，两位补零，用本机时区 */
export const formatClockTime = (now: Date = new Date()): string =>
  `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

/** 尾部标记：纯数据，越短越好（跟着界面语言走，别中英混排） */
export const clockMark = (now: Date = new Date(), locale: Locale = 'zh-CN'): string =>
  locale === 'zh-CN' ? `[环境时钟: ${formatClockTime(now)}]` : `[Clock: ${formatClockTime(now)}]`

/** 写进 system 的固定规则句：说明「那个标记是什么」，与具体时刻无关，不伤缓存 */
export const clockTimeRule = (locale: Locale = 'zh-CN'): string =>
  locale === 'zh-CN'
    ? '【环境时钟】提问末尾可能出现「[环境时钟: HH:mm]」标记，它表示这条提问发出时的本机时间，仅作环境参考；与语境无关时不要提及，也不要每轮报告时间。'
    : '[Clock] A question may end with a "[Clock: HH:mm]" marker: the local time when that question was sent, for context only. Do not mention it and do not report the time on every turn unless it is naturally relevant.'

/** 把规则句并进 system；已存在时不重复追加 */
export const appendClockRule = (system: string, locale: Locale = 'zh-CN'): string => {
  if (system.includes('【环境时钟】') || system.includes('[Clock] A question may end')) {
    return system
  }
  const rule = clockTimeRule(locale)
  return system ? `${system}\n\n${rule}` : rule
}

/**
 * 把时刻标记附到最后一条 user 消息尾部。没有 user 消息时原样返回。
 * 只改最后一条：历史里的旧时刻不重写，前缀缓存才稳。
 */
export const appendClockTime = (
  messages: readonly MessageParam[],
  now: Date = new Date(),
  locale: Locale = 'zh-CN'
): MessageParam[] => {
  let lastUser = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUser = index
      break
    }
  }
  if (lastUser < 0) {
    return messages.slice()
  }
  const tag = clockMark(now, locale)
  const target = messages[lastUser]
  if (target.role !== 'user') {
    return messages.slice()
  }
  const content = target.content
  const next: MessageParam =
    typeof content === 'string'
      ? { role: 'user', content: `${stripClockTime(content)}\n\n${tag}` }
      : {
          role: 'user',
          content: [
            // 旧时刻块先剔掉，避免同一段里叠两个
            ...content.filter(
              (block) =>
                !(
                  block.type === 'text' &&
                  (/<system_time>/.test(block.text) || /\[(?:环境时钟|Clock):/.test(block.text))
                )
            ),
            { type: 'text', text: tag },
          ],
        }
  return messages.map((message, index) => (index === lastUser ? next : message))
}
