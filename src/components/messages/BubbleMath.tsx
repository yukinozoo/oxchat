import { Fragment, memo, useMemo } from 'react'
import { InlineMath, MathBlock } from '../markdown/MathFormula.js'

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; value: string }
  | { kind: 'block'; value: string }

/**
 * 用户气泡里的 LaTeX：只识别公式定界符，其余内容（含 Markdown 语法）保持原样。
 * 定界符与正文解析一致：$$...$$、\[...\]、\(...)、$...$。
 * 防误判：单美元内容首尾不能是空白、不能首尾都是数字；含中文的片段不当作公式。
 */
const MATH_SPAN =
  /\$\$([^$\n]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]*[^\s$])\$/g

const containsCJK = (value: string) => /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/.test(value)

export const splitMathSpans = (content: string): Segment[] => {
  const segments: Segment[] = []
  let cursor = 0
  for (const match of content.matchAll(MATH_SPAN)) {
    const [raw, block, bracketBlock, bracketInline, dollarInline] = match
    if (match.index > cursor) {
      segments.push({ kind: 'text', value: content.slice(cursor, match.index) })
    }
    cursor = match.index + raw.length
    if (block !== undefined) {
      segments.push({ kind: 'block', value: block })
    } else if (bracketBlock !== undefined) {
      segments.push({ kind: 'block', value: bracketBlock })
    } else if (bracketInline !== undefined) {
      if (containsCJK(bracketInline)) {
        segments.push({ kind: 'text', value: raw })
      } else {
        segments.push({ kind: 'inline', value: bracketInline })
      }
    } else if (dollarInline !== undefined) {
      const currencyLike = /^\d.*\d$/.test(dollarInline)
      if (currencyLike || containsCJK(dollarInline)) {
        segments.push({ kind: 'text', value: raw })
      } else {
        segments.push({ kind: 'inline', value: dollarInline })
      }
    }
  }
  if (cursor < content.length) {
    segments.push({ kind: 'text', value: content.slice(cursor) })
  }
  // 被防误判回退的公式与前后文本合并成一段，渲染结果与原始输入一致
  const merged: Segment[] = []
  for (const segment of segments) {
    const last = merged.at(-1)
    if (segment.kind === 'text' && last?.kind === 'text') {
      last.value += segment.value
    } else {
      merged.push(segment)
    }
  }
  return merged
}

/** 用户消息气泡的正文：普通文本原样显示（依赖气泡的 pre-wrap），公式用 KaTeX 渲染 */
export const BubbleMath = memo(function BubbleMath({ content }: { content: string }) {
  const segments = useMemo(() => splitMathSpans(content), [content])
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <Fragment key={index}>{segment.value}</Fragment>
        ) : segment.kind === 'inline' ? (
          <InlineMath key={index} value={segment.value} />
        ) : (
          <MathBlock key={index} value={segment.value} />
        )
      )}
    </>
  )
})
