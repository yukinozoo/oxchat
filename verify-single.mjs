// 用 jsdom 加载单文件版，验证 React 是否能挂载、内联 chunk 是否能取到
import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'

const file = process.argv[2] ?? 'single/index.html'
const html = readFileSync(file, 'utf8')

const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`))
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`))

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///tmp/single/index.html',
  virtualConsole: vc,
  beforeParse(window) {
    // 补齐 jsdom 缺的浏览器 API
    window.matchMedia ??= (q) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver ??= RO
    window.IntersectionObserver ??= RO
    window.scrollTo ??= () => {}
    window.HTMLCanvasElement.prototype.getContext ??= () => null
    window.HTMLMediaElement.prototype.play ??= () => Promise.resolve()
    window.HTMLMediaElement.prototype.pause ??= () => {}
  },
})

await new Promise((r) => setTimeout(r, 3000))

const root = dom.window.document.getElementById('root')
const body = root?.innerHTML ?? ''
const text = (root?.textContent ?? '').replace(/\s+/g, ' ').trim()

console.log('=== 结果 ===')
console.log(`#root 子节点数: ${root?.children.length ?? 0}`)
console.log(`#root HTML 长度: ${body.length} 字符`)
console.log(`可见文本前 200 字: ${text.slice(0, 200) || '(空)'}`)
console.log(
  `异步 chunk 是否内联成功: ${errors.some((e) => e.includes('inline chunk failed')) ? '❌ 有失败' : '✅ 无失败'}`
)
console.log(`错误/警告 ${errors.length} 条`)
for (const e of errors.slice(0, 6)) console.log('  - ' + e.slice(0, 200))

dom.window.close()
process.exit(body.length > 0 ? 0 : 1)
