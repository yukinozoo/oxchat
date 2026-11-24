import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'
import { KATEX_MACROS, prepareLatex } from '../../services/markdown/latex.js'

/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

type MathHtmlResult = {
  html: string
  renderMode: 'katex' | 'fallback'
}

const noop = () => {}

/** KaTeX 渲染公式；出错时保留上次成功的结果（流式中公式未写完），没有则展示原文 */
const useMathHtml = (input: string, isInline: boolean): MathHtmlResult => {
  const previousResultRef = useRef<MathHtmlResult | null>(null)
  const katexRef = useRef(ensureKatex())
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  useEffect(() => {
    if (katexRef.current instanceof Promise) {
      katexRef.current.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathHtmlResult => {
    if (!katex) {
      return { html: input, renderMode: 'fallback' }
    }
    const [prefix, suffix] = KATEX_WRAPPER[isInline ? 'inline' : 'display']
    const render = (source: string) =>
      katex
        .renderToString(source, {
          throwOnError: true,
          strict: false,
          displayMode: !isInline,
          macros: KATEX_MACROS,
        })
        .slice(prefix.length, -suffix.length)
    try {
      const result = { html: render(input), renderMode: 'katex' } as const
      previousResultRef.current = result
      return result
    } catch {
      // 美化包把数学命令塞进 \text / \raisebox / \colorbox 时会直接抛错：
      // 补一层兼容层再排一次，仍然失败才回退（流式中公式没写完也走这里）。
      try {
        const prepared = prepareLatex(input)
        if (prepared !== input) {
          const result = { html: render(prepared), renderMode: 'katex' } as const
          previousResultRef.current = result
          return result
        }
      } catch {
        /* 兼容层也救不回来，交给下面的兜底 */
      }
      return previousResultRef.current ?? { html: input, renderMode: 'fallback' }
    }
  }, [input, isInline, katex])
}

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, false)
  if (renderMode === 'fallback') {
    return <p className="ds-markdown-paragraph">{html}</p>
  }
  return (
    <span className="katex-display ds-markdown-math">
      <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
    </span>
  )
})

export const InlineMath = memo(function InlineMath({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, true)
  if (renderMode === 'fallback') {
    return html
  }
  return <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
})
