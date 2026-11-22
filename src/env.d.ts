declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

declare module '*.png' {
  const url: string
  export default url
}

/** 构建时间戳（MM-DD HH:mm），见 rspack.config.ts */
declare const __BUILD_STAMP__: string

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
