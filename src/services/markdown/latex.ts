/**
 * KaTeX 兼容层：把「美化包」里常见的 LaTeX 写法补成 KaTeX 能解析的形态。
 *
 * 背景：美化包（用公式拼「已读」角标、彩色标题条那种）习惯把数学符号塞进
 * \raisebox / \text / \colorbox 这类文本模式命令里，例如：
 *   \raisebox{0.3cm}{\textcolor{#2C2C2E}{\blacktriangleleft}}
 * 真实 LaTeX 会在文本模式里自动补一个 $（同时给一条 Missing $ 警告），
 * 但 KaTeX 的文本模式里 \blacktriangleleft 这类数学符号根本没定义，会直接抛
 * 「Undefined control sequence」，整条公式因此渲染失败、退化成原文。
 *
 * 这里只做「补数学模式」一件事：
 * 1. 找出文本模式命令的内容参数，把里面的数学命令（连同参数、上下标）包成
 *    数学岛 $...$；这是 KaTeX 支持的「text 里嵌公式」写法。
 * 2. \left...\right、\begin{...}...\end{...} 这种成对结构整段包成一个数学岛。
 *
 * 不做别的猜测：未知命令、写坏的公式照旧交给 KaTeX 报错，由调用侧回退成原文。
 */
export const prepareLatex = (source: string): string => emit(tokenize(source), 'math')

type Mode = 'math' | 'text'

type Token =
  | { kind: 'chars'; raw: string }
  | { kind: 'command'; raw: string; name: string }
  | { kind: 'group'; raw: string; children: Token[] }
  | { kind: 'bracket'; raw: string; children: Token[] }
  /** 文本模式里用户自己写的 $...$（里面已经是数学，原样保留） */
  | { kind: 'dollar'; raw: string }

/**
 * 内容参数按「文本模式」解析的命令：命令名 -> 内容参数下标（从 0 开始）。
 * KaTeX 里这些参数就是纯文本（\text 系列、\raisebox、\colorbox、\fbox），
 * 美化包正是把数学符号塞在这里才炸的。注意 \raisebox 在 KaTeX 里是 2 个参数
 * （高度 + 内容），不是 LaTeX 的 3 个。
 */
const TEXT_MODE_CONTENT: Record<string, number> = {
  '\\text': 0,
  '\\textnormal': 0,
  '\\textrm': 0,
  '\\textsf': 0,
  '\\texttt': 0,
  '\\textbf': 0,
  '\\textit': 0,
  '\\textsl': 0,
  '\\textsc': 0,
  '\\textup': 0,
  '\\textmd': 0,
  '\\emph': 0,
  '\\fbox': 0,
  '\\raisebox': 1,
  '\\colorbox': 1,
}

/**
 * KaTeX 没定义、但「美化包」常见的美化命令：给个近似实现，别因为一个斜体或
 * 小型大写字母就让整条公式退回原文。只在 KaTeX 首次解析失败后才会用到这些宏
 * （见 MathFormula 的失败重试），不会影响本来就能渲染的公式。
 */
export const KATEX_MACROS: Record<string, string> = {
  '\\textsl': '\\textit{#1}',
  '\\textsc': '\\text{#1}',
  '\\textsuperscript': '^{\\text{#1}}',
  '\\textsubscript': '_{\\text{#1}}',
  '\\hfill': '\\hspace{1em}',
}

/**
 * 只有数学模式里才定义的符号命令（0 参数）。命中后包成 $...$。
 * 列表按「美化包里真的会用到」筛过：图标/箭头/关系符/常用运算符/希腊字母。
 * 文本模式本来就合法的命令不要放进来（比如 \dots、\quad、\checkmark），
 * 包成数学岛反而会改变排版。
 */
const MATH_SYMBOLS = new Set([
  // 图标与几何
  '\\blacktriangleleft',
  '\\blacktriangleright',
  '\\blacktriangle',
  '\\blacktriangledown',
  '\\triangle',
  '\\triangledown',
  '\\triangleleft',
  '\\triangleright',
  '\\blacksquare',
  '\\square',
  '\\blacklozenge',
  '\\lozenge',
  '\\Diamond',
  '\\diamond',
  '\\bigstar',
  '\\star',
  '\\ast',
  '\\bullet',
  '\\circ',
  '\\bigcirc',
  '\\heartsuit',
  '\\clubsuit',
  '\\diamondsuit',
  '\\spadesuit',
  // 箭头
  '\\rightarrow',
  '\\leftarrow',
  '\\leftrightarrow',
  '\\Rightarrow',
  '\\Leftarrow',
  '\\Leftrightarrow',
  '\\longrightarrow',
  '\\longleftarrow',
  '\\longleftrightarrow',
  '\\Longrightarrow',
  '\\Longleftarrow',
  '\\Longleftrightarrow',
  '\\mapsto',
  '\\longmapsto',
  '\\to',
  '\\gets',
  '\\uparrow',
  '\\downarrow',
  '\\updownarrow',
  '\\Uparrow',
  '\\Downarrow',
  '\\nearrow',
  '\\searrow',
  '\\swarrow',
  '\\nwarrow',
  '\\hookrightarrow',
  '\\hookleftarrow',
  '\\rightharpoonup',
  '\\rightharpoondown',
  '\\leftharpoonup',
  '\\leftharpoondown',
  '\\rightleftharpoons',
  // 关系符
  '\\le',
  '\\leq',
  '\\ge',
  '\\geq',
  '\\ne',
  '\\neq',
  '\\approx',
  '\\equiv',
  '\\sim',
  '\\simeq',
  '\\cong',
  '\\propto',
  '\\ll',
  '\\gg',
  '\\asymp',
  '\\doteq',
  '\\subset',
  '\\supset',
  '\\subseteq',
  '\\supseteq',
  '\\subsetneq',
  '\\supsetneq',
  '\\in',
  '\\notin',
  '\\ni',
  '\\mid',
  '\\nmid',
  '\\parallel',
  '\\perp',
  '\\angle',
  '\\therefore',
  '\\because',
  // 运算符
  '\\pm',
  '\\mp',
  '\\times',
  '\\div',
  '\\cdot',
  '\\cdots',
  '\\vdots',
  '\\ddots',
  '\\cup',
  '\\cap',
  '\\setminus',
  '\\uplus',
  '\\sqcup',
  '\\sqcap',
  '\\wedge',
  '\\vee',
  '\\oplus',
  '\\ominus',
  '\\otimes',
  '\\oslash',
  '\\odot',
  '\\infty',
  '\\partial',
  '\\nabla',
  '\\forall',
  '\\exists',
  '\\nexists',
  '\\neg',
  '\\lnot',
  '\\emptyset',
  '\\varnothing',
  '\\hbar',
  '\\ell',
  '\\aleph',
  '\\Re',
  '\\Im',
  '\\wp',
  // 大型运算符
  '\\sum',
  '\\prod',
  '\\coprod',
  '\\int',
  '\\iint',
  '\\iiint',
  '\\oint',
  '\\oiint',
  '\\bigcup',
  '\\bigcap',
  '\\bigoplus',
  '\\bigotimes',
  '\\bigodot',
  '\\biguplus',
  '\\bigvee',
  '\\bigwedge',
  // 函数名（不带参数，后面可能有上下标）
  '\\lim',
  '\\limsup',
  '\\liminf',
  '\\max',
  '\\min',
  '\\sup',
  '\\inf',
  '\\det',
  '\\gcd',
  '\\log',
  '\\ln',
  '\\exp',
  '\\sin',
  '\\cos',
  '\\tan',
  '\\cot',
  '\\sec',
  '\\csc',
  '\\arcsin',
  '\\arccos',
  '\\arctan',
  '\\sinh',
  '\\cosh',
  '\\tanh',
  '\\coth',
  '\\dim',
  '\\hom',
  '\\ker',
  '\\arg',
  '\\deg',
  // 希腊字母（大写也补上）
  '\\alpha',
  '\\beta',
  '\\gamma',
  '\\delta',
  '\\epsilon',
  '\\varepsilon',
  '\\zeta',
  '\\eta',
  '\\theta',
  '\\vartheta',
  '\\iota',
  '\\kappa',
  '\\lambda',
  '\\mu',
  '\\nu',
  '\\xi',
  '\\pi',
  '\\varpi',
  '\\rho',
  '\\varrho',
  '\\sigma',
  '\\varsigma',
  '\\tau',
  '\\upsilon',
  '\\phi',
  '\\varphi',
  '\\chi',
  '\\psi',
  '\\omega',
  '\\Gamma',
  '\\Delta',
  '\\Theta',
  '\\Lambda',
  '\\Xi',
  '\\Pi',
  '\\Sigma',
  '\\Upsilon',
  '\\Phi',
  '\\Psi',
  '\\Omega',
])

/** 带参数的数学命令 -> 必需参数个数（文本模式里命中后连参数一起包成数学岛） */
const MATH_ARG_COMMANDS: Record<string, number> = {
  '\\frac': 2,
  '\\dfrac': 2,
  '\\tfrac': 2,
  '\\cfrac': 2,
  '\\binom': 2,
  '\\dbinom': 2,
  '\\tbinom': 2,
  '\\overset': 2,
  '\\underset': 2,
  '\\stackrel': 2,
  '\\sqrt': 1,
  '\\vec': 1,
  '\\hat': 1,
  '\\widehat': 1,
  '\\bar': 1,
  '\\overline': 1,
  '\\underline': 1,
  '\\tilde': 1,
  '\\widetilde': 1,
  '\\dot': 1,
  '\\ddot': 1,
  '\\dddot': 1,
  '\\check': 1,
  '\\breve': 1,
  '\\acute': 1,
  '\\grave': 1,
  '\\mathring': 1,
  '\\overbrace': 1,
  '\\underbrace': 1,
  '\\substack': 1,
  '\\operatorname': 1,
  '\\mathrm': 1,
  '\\mathbf': 1,
  '\\mathit': 1,
  '\\mathsf': 1,
  '\\mathtt': 1,
  '\\mathcal': 1,
  '\\mathbb': 1,
  '\\mathfrak': 1,
  '\\boldsymbol': 1,
  '\\mathop': 1,
  '\\mathbin': 1,
  '\\mathrel': 1,
  '\\mathord': 1,
  '\\mathopen': 1,
  '\\mathclose': 1,
  '\\mathpunct': 1,
  '\\mathinner': 1,
  '\\boxed': 1,
  '\\pmod': 1,
}

const isLetter = (char: string | undefined): boolean =>
  char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'))

/** 从 open 位置的左括号找到配对右括号之后（跳过 \) 这类转义） */
const findClosing = (source: string, open: number, left: string, right: string): number => {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === left) {
      depth += 1
    } else if (char === right) {
      depth -= 1
      if (depth === 0) {
        return index + 1
      }
    }
  }
  return source.length
}

/** 文本模式里 $...$ 的结束位置；没配对就吃到字符串末尾 */
const findDollarEnd = (source: string, open: number): number => {
  for (let index = open + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
      continue
    }
    if (source[index] === '$') {
      return index + 1
    }
  }
  return source.length
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      let end = index + 1
      if (isLetter(source[end])) {
        while (isLetter(source[end])) {
          end += 1
        }
      } else if (end < source.length) {
        end += 1
      }
      const raw = source.slice(index, end)
      tokens.push({ kind: 'command', raw, name: raw })
      index = end
      continue
    }
    if (char === '{' || char === '[') {
      const right = char === '{' ? '}' : ']'
      const end = findClosing(source, index, char, right)
      tokens.push({
        kind: char === '{' ? 'group' : 'bracket',
        raw: source.slice(index, end),
        children: tokenize(source.slice(index + 1, end - 1)),
      })
      index = end
      continue
    }
    if (char === '$') {
      const end = findDollarEnd(source, index)
      tokens.push({ kind: 'dollar', raw: source.slice(index, end) })
      index = end
      continue
    }
    let end = index + 1
    while (end < source.length && !'\\{[$]'.includes(source[end])) {
      end += 1
    }
    tokens.push({ kind: 'chars', raw: source.slice(index, end) })
    index = end
  }
  return tokens
}

const isSpace = (token: Token | undefined): boolean =>
  token !== undefined && token.kind === 'chars' && token.raw.trim() === ''

/** 从 cursor 起跳过空白，返回第一个有效 token 的下标（越界返回 tokens.length） */
const skipSpaces = (tokens: Token[], cursor: number): number => {
  let index = cursor
  while (index < tokens.length && isSpace(tokens[index])) {
    index += 1
  }
  return index
}

/** 把参数 token 重新拼回字符串；group/bracket 内部内容已按目标模式改写 */
const wrapArg = (token: Token, inner: string): string =>
  token.kind === 'group' ? '{' + inner + '}' : token.kind === 'bracket' ? '[' + inner + ']' : inner

type ArgToken = Extract<Token, { kind: 'group' | 'bracket' }>

type Arg = { token: ArgToken; start: number; end: number }

/** 读一个参数：只接受 {...} / [...]（LaTeX 的无括号写法美化包里基本不会出现） */
const readArg = (tokens: Token[], cursor: number): Arg | null => {
  const start = skipSpaces(tokens, cursor)
  const token = tokens[start]
  if (token === undefined || (token.kind !== 'group' && token.kind !== 'bracket')) {
    return null
  }
  return { token, start, end: start + 1 }
}

/** 命令的文本内容参数改写成文本模式；其它参数（高度/颜色）原样保留 */
const rewriteTextArgs = (
  tokens: Token[],
  cursor: number,
  contentIndex: number,
  mode: Mode
): { raw: string; end: number } => {
  let raw = ''
  for (let index = 0; index <= contentIndex; index += 1) {
    const arg = readArg(tokens, cursor)
    if (arg === null) {
      // 参数还没写完（流式中）：剩余内容按原模式输出，别把半个公式改坏
      return { raw: raw + emit(tokens.slice(cursor), mode), end: tokens.length }
    }
    raw += emit(tokens.slice(cursor, arg.start), mode)
    raw += index === contentIndex
      ? wrapArg(arg.token, emit(arg.token.children, 'text'))
      : arg.token.raw
    cursor = arg.end
  }
  return { raw, end: cursor }
}

/** 文本模式里把数学命令的参数一起收进来，整体包成一个数学岛 */
const collectMathArgs = (
  tokens: Token[],
  cursor: number,
  count: number
): { raw: string; end: number; complete: boolean } => {
  let raw = ''
  // 可选参数（\sqrt[3]{x}）先吃掉，它也是数学模式
  let arg = readArg(tokens, cursor)
  while (arg !== null && arg.token.kind === 'bracket') {
    raw += emit(tokens.slice(cursor, arg.start), 'math') + wrapArg(arg.token, emit(arg.token.children, 'math'))
    cursor = arg.end
    arg = readArg(tokens, cursor)
  }
  for (let index = 0; index < count; index += 1) {
    arg = readArg(tokens, cursor)
    if (arg === null) {
      return { raw, end: cursor, complete: false }
    }
    raw += emit(tokens.slice(cursor, arg.start), 'math')
    raw += wrapArg(arg.token, emit(arg.token.children, 'math'))
    cursor = arg.end
  }
  return { raw, end: cursor, complete: true }
}

/**
 * 吸收紧跟在数学符号后面的上下标（_{...}、^{...}、_1、^n），一起放进数学岛。
 * 只认「一个字符 + 可选参数」的形态：美化包里够用，也不会把后面的正文吞进公式。
 */
const absorbScripts = (tokens: Token[], cursor: number): { raw: string; end: number } => {
  let raw = ''
  for (;;) {
    const start = skipSpaces(tokens, cursor)
    const token = tokens[start]
    if (token === undefined || token.kind !== 'chars') {
      return { raw, end: cursor }
    }
    const first = token.raw[0]
    if (first !== '^' && first !== '_') {
      return { raw, end: cursor }
    }
    // 拆出 ^ / _ 本身，剩下的字符（如 "2"、"1 后续正文"）留在原位置
    const rest = token.raw.slice(1)
    const head: Token = { kind: 'chars', raw: first }
    tokens.splice(start, 1, head, ...(rest.length > 0 ? [{ kind: 'chars' as const, raw: rest }] : []))
    raw += first
    cursor = start + 1
    const arg = readArg(tokens, cursor)
    if (arg !== null) {
      raw += wrapArg(arg.token, emit(arg.token.children, 'math'))
      cursor = arg.end
      continue
    }
    const next = tokens[cursor]
    if (next !== undefined && next.kind === 'chars' && isLetter(next.raw[0])) {
      // 无括号的单个字母/数字：把首字符一起带进公式
      const trailing = next.raw.slice(1)
      raw += next.raw[0]
      const head2: Token = { kind: 'chars', raw: trailing }
      tokens.splice(cursor, 1, ...(trailing.length > 0 ? [head2] : []))
      cursor += trailing.length > 0 ? 0 : 1
    }
  }
}

/** 丢掉命令后面连续 count 个参数，返回下一个位置（KaTeX 不支持的表格命令降级用） */
const dropArgs = (tokens: Token[], cursor: number, count: number): number => {
  let end = cursor
  for (let index = 0; index < count; index += 1) {
    const arg = readArg(tokens, end)
    if (arg === null) {
      return end
    }
    end = arg.end
  }
  return end
}

/** 找 \left 配对的那个 \right（以及它后面的定界符），返回整段结束下标 */
const findRightPair = (tokens: Token[], start: number): number | null => {
  let depth = 0
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== 'command') {
      continue
    }
    if (token.name === '\\left') {
      depth += 1
    } else if (token.name === '\\right') {
      depth -= 1
      if (depth === 0) {
        return Math.min(tokens.length, index + 2)
      }
    }
  }
  return null
}

/** 找 \begin{...} 配对的 \end{...}，返回整段结束下标 */
const findEnvironmentEnd = (tokens: Token[], start: number): number | null => {
  let depth = 0
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== 'command') {
      continue
    }
    if (token.name === '\\begin') {
      depth += 1
    } else if (token.name === '\\end') {
      depth -= 1
      if (depth === 0) {
        return Math.min(tokens.length, index + 2)
      }
    }
  }
  return null
}

const emit = (tokens: Token[], mode: Mode): string => {
  let output = ''
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind === 'chars' || token.kind === 'dollar') {
      output += token.raw
      continue
    }
    if (token.kind === 'group' || token.kind === 'bracket') {
      output += wrapArg(token, emit(token.children, mode))
      continue
    }
    const textContent = TEXT_MODE_CONTENT[token.name]
    if (textContent !== undefined) {
      const args = rewriteTextArgs(tokens, index + 1, textContent, mode)
      output += token.raw + args.raw
      index = args.end - 1
      continue
    }
    if (mode === 'text') {
      if (MATH_SYMBOLS.has(token.name)) {
        const scripts = absorbScripts(tokens, index + 1)
        output += '$' + token.raw + scripts.raw + '$'
        index = scripts.end - 1
        continue
      }
      const argCount = MATH_ARG_COMMANDS[token.name]
      if (argCount !== undefined) {
        const args = collectMathArgs(tokens, index + 1, argCount)
        // 参数没收集全（流式中）就先别包，等下一次渲染；包半截只会让整条公式报错
        if (args.complete) {
          output += '$' + token.raw + args.raw + '$'
          index = args.end - 1
        } else {
          output += token.raw
        }
        continue
      }
      if (token.name === '\\left') {
        const end = findRightPair(tokens, index)
        if (end !== null) {
          output += '$' + emit(tokens.slice(index, end), 'math') + '$'
          index = end - 1
          continue
        }
      }
      if (token.name === '\\begin') {
        const end = findEnvironmentEnd(tokens, index)
        if (end !== null) {
          output += '$' + emit(tokens.slice(index, end), 'math') + '$'
          index = end - 1
          continue
        }
      }
    }
    // KaTeX 不支持的表格装饰命令：美化包爱用 \multicolumn / \multirow 跨行列、
    // 用 booktabs 的 \toprule 画线；KaTeX 遇到它们会让整条公式报错。
    // 这里降级：booktabs 的线换成它支持的 \hline，跨行列只保留内容。
    // （\hline 本身 KaTeX 支持，别动它。）
    if (
      token.name === '\\toprule' ||
      token.name === '\\midrule' ||
      token.name === '\\bottomrule' ||
      token.name === '\\cline'
    ) {
      if (token.name === '\\cline') {
        index = dropArgs(tokens, index + 1, 1) - 1
      }
      output += '\\hline'
      continue
    }
    if (token.name === '\\multicolumn' || token.name === '\\multirow') {
      const arg = readArg(tokens, dropArgs(tokens, index + 1, 2))
      if (arg !== null) {
        output += wrapArg(arg.token, emit(arg.token.children, 'math'))
        index = arg.end - 1
        continue
      }
      continue
    }
    output += token.raw
  }
  return output
}
