/**
 * 特殊 token / 工具协议标记的清洗。
 *
 * 为什么需要：服务端偶发把内部工具协议标记当普通正文下发（正文里出现
 * `</||DSML||parameter>`，竖线还有全角 `｜` 变体）。客户端若原样拼进消息，
 * 界面上就会显示标记；更糟的是脏文本会作为 assistant 历史回传，服务端对
 * 含保留特殊 token 的输入直接拒收 —— 表现为「聊到一半之后每条消息都失败」。
 *
 * 为什么不能只在整段字符串上 replace：标记可能被切成两个 delta（上一段末尾是
 * `<`，下一段开头是 `|DSML|...`）。所以流式入口用「尾部可疑前缀缓冲」：只有
 * 确定不会再拼成标记的尾巴才立即显示，半截标记留在 pending 里等下一段。
 * 整段字符串的兜底清洗用 stripSpecialTokens。
 */

/** 竖线分隔：1~3 个 | 或全角 ｜，中间允许空白（实测出现过「| | DSML | |」的写法） */
const SEP = '[|｜](?:[ \t]*[|｜]){0,2}'

/** 完整 DSML 标签，如 <||DSML||parameter>、</｜｜DSML｜｜calls>；行尾没收完 `>` 的残片也一并清掉 */
const DSML_TAG = new RegExp(
  `<[ \t]*/?[ \t]*${SEP}[ \t]*DSML[ \t]*${SEP}(?:[^<>\n]*?>|[^<>\n]*$)`,
  'gim'
)

/** 丢了 `<` 的 DSML 残片（如 ||DSML||parameter>）；要求带 `>`，避免误删讨论这个标记的正文 */
const DSML_RESIDUE = new RegExp(`${SEP}[ \t]*DSML[ \t]*${SEP}[^<>\n]*?>`, 'gi')

/** 常见特殊 token：<|end_of_sentence|>、<|begin_of_sentence|>、<|tool▁calls▁begin|> 等 */
const SPECIAL_TOKEN = /<[|｜][\w\u2581]{1,64}[|｜]>/g

/**
 * 整段文本的兜底清洗：渲染前、写库前、回传前都用它，保证已经存进库里的脏历史
 * 也不再显示标记。快路径按字符判断，绝大多数正常消息不会多一次正则扫描。
 */
export const stripSpecialTokens = (text: string): string => {
  if (!text.includes('<') && !/dsml/i.test(text)) {
    return text
  }
  return text.replace(DSML_TAG, '').replace(DSML_RESIDUE, '').replace(SPECIAL_TOKEN, '')
}

/** 完整标记可能的最大长度；超出的尾巴不再缓冲，避免半截字符一直吐不出来 */
const MAX_PENDING = 512

/** tail 是否「可能是一个还没收完的标记开头」；不是就从尾部正常吐字 */
const isTokenTail = (tail: string): boolean => {
  // 单独一个 < 必须等下一段：它可能就是 <|...|> 或 </||DSML||... 的开头
  if (tail === '<') {
    return true
  }
  const second = tail[1]
  if (second === '|' || second === '｜') {
    return /^<[|｜][\w\u2581|｜="'.:-]*$/.test(tail)
  }
  if (second === '/') {
    const third = tail[2]
    return third === '|' || third === '｜'
      ? /^<\/[ \t]*[|｜][\w\u2581|｜ \t="'.:-]*$/.test(tail)
      : false
  }
  return false
}

/** 从 raw 末尾找「可能还没收完的标记起点」；找不到返回 -1，表示整个 raw 都可以显示 */
const findPendingStart = (raw: string): number => {
  const start = raw.lastIndexOf('<')
  if (start < 0 || raw.length - start > MAX_PENDING) {
    return -1
  }
  return isTokenTail(raw.slice(start)) ? start : -1
}

export type StreamFilterChunk = {
  /** 本次可以立即显示的文本 */
  text: string
  /** 尾部可疑前缀，留到下一段再判断 */
  pending: string
}

/**
 * 流式入口：把「上次留下的 pending + 新 delta」清洗成可显示文本和新 pending。
 * 标记被切在 delta 中间时不会漏：半截先缓冲，等收完再一起清掉。
 */
export const filterStreamChunk = (pending: string, delta: string): StreamFilterChunk => {
  const raw = pending + delta
  const start = findPendingStart(raw)
  if (start < 0) {
    return { text: stripSpecialTokens(raw), pending: '' }
  }
  return { text: stripSpecialTokens(raw.slice(0, start)), pending: raw.slice(start) }
}

/**
 * 流结束：把 pending 里确定是正文的部分吐出；半截标记（<|end_of / </||DSML||par）宁可丢掉，
 * 也不把残缺的协议标记显示给用户。单个 `<` 当正文（数学比较、代码里很常见）。
 */
export const flushStreamPending = (pending: string): string => {
  if (pending === '') {
    return ''
  }
  if (/^<\/?[|｜]/.test(pending)) {
    return ''
  }
  return stripSpecialTokens(pending)
}
