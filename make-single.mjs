// 把 dist/ 打成一个完全自包含的 index.html：JS/CSS/字体全部内联，异步 chunk 用运行时 hook 注入
// 用法: node make-single.mjs <dist目录> <输出html>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const dist = process.argv[2] ?? 'dist'
const out = process.argv[3] ?? 'single/index.html'

const read = (p) => readFileSync(path.join(dist, p), 'utf8')
const safe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<\/style/gi, '<\\/style')

// ---- 1. 收集异步 chunk ----
const chunkMap = {} // url 片段 -> 代码
const cssMap = {}
const asyncJsDir = path.join(dist, 'static/js/async')
const asyncCssDir = path.join(dist, 'static/css/async')

if (existsSync(asyncJsDir)) {
  for (const f of readdirSync(asyncJsDir).filter((f) => f.endsWith('.js'))) {
    chunkMap[`static/js/async/${f}`] = readFileSync(path.join(asyncJsDir, f), 'utf8')
  }
}
if (existsSync(asyncCssDir)) {
  for (const f of readdirSync(asyncCssDir).filter((f) => f.endsWith('.css'))) {
    cssMap[`static/css/async/${f}`] = readFileSync(path.join(asyncCssDir, f), 'utf8')
  }
}

// ---- 2. 字体内联（只留 woff2，其余 src 项删掉）----
const mediaDir = path.join(dist, 'static/media')
const fontCache = {}
const fontDataUri = (file) => {
  if (!fontCache[file]) {
    const b = readFileSync(path.join(mediaDir, file))
    fontCache[file] = `data:font/woff2;base64,${b.toString('base64')}`
  }
  return fontCache[file]
}

const inlineCss = (css) => {
  let s = css.replace(/url\(([^)]*?\.woff2)\)/g, (m, p) => {
    const file = path.basename(p.replace(/["']/g, ''))
    try {
      return `url(${fontDataUri(file)})`
    } catch {
      return m
    }
  })
  // 去掉 woff / ttf 备选源，避免多余的外链请求
  s = s.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]?woff['"]?\)/g, '')
  s = s.replace(/,\s*url\([^)]*\.ttf\)\s*format\(['"]?truetype['"]?\)/g, '')
  return s
}

// ---- 3. 主 HTML 里的 JS / CSS ----
let html = read('index.html')
const jsMatch = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)
const cssMatch = html.match(/<link[^>]*href="([^"]+\.css)"[^>]*>/)
if (!jsMatch) {
  console.error('没在 index.html 里找到主脚本标签')
  process.exit(1)
}
const mainJs = read(jsMatch[1])
const mainCss = cssMatch ? inlineCss(read(cssMatch[1])) : ''

// 异步 CSS 也全部内联成 <style>，避免额外请求
const asyncStyles = Object.values(cssMap)
  .map((c) => `<style>${safe(inlineCss(c))}</style>`)
  .join('\n')

// ---- 4. 运行时 hook：拦截 script/link 插入，从内联表里取代码 ----
const hook = `
(function(){
  var CHUNKS = ${JSON.stringify(chunkMap)};
  var CSSES = ${JSON.stringify(cssMap)};
  var pick = function(map, url){
    if(!url) return null;
    var u = String(url).replace(/\\\\/g,'/');
    for (var k in map) if (u.indexOf(k) >= 0) return k;
    return null;
  };
  var origCreate = Document.prototype.createElement;
  var origAppend = Node.prototype.appendChild;
  var origInsert = Node.prototype.insertBefore;
  var srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  var hrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
  var setNative = function(el, prop, v){
    var d = prop === 'src' ? srcDesc : hrefDesc;
    if (d && d.set) d.set.call(el, v);
    else el.setAttribute(prop, v);
  };

  Document.prototype.createElement = function(tag){
    var el = origCreate.apply(this, arguments);
    var t = String(tag).toLowerCase();
    if (t !== 'script' && t !== 'link') return el;
    var st = { real: '' };
    var prop = t === 'script' ? 'src' : 'href';
    try {
      Object.defineProperty(el, prop, {
        configurable: true,
        enumerable: true,
        get: function(){ return st.real; },
        set: function(v){ st.real = v; }
      });
    } catch (e) {}
    var origSetAttr = el.setAttribute;
    el.setAttribute = function(name, v){
      if (String(name).toLowerCase() === prop) { st.real = v; return; }
      return origSetAttr.call(this, name, v);
    };
    el.__inlineHook = st;
    return el;
  };

  // 返回 true 表示已内联处理（不插入真实标签）；false 表示要按真实外链加载
  var tryInline = function(el){
    var st = el.__inlineHook;
    if (!st) return false;
    var isScript = el.tagName === 'SCRIPT';
    var map = isScript ? CHUNKS : CSSES;
    var k = pick(map, st.real);
    if (!k) {
      // 不是打包产物里的 chunk：还原真实地址，交回浏览器正常加载
      setNative(el, isScript ? 'src' : 'href', st.real);
      return false;
    }
    if (isScript) {
      try { (0, eval)(CHUNKS[k]); }
      catch (e) { console.error('inline chunk failed: ' + k, e); }
    } else {
      var style = origCreate.call(document, 'style');
      style.textContent = CSSES[k];
      origAppend.call(document.head, style);
    }
    setTimeout(function(){ if (el.onload) el.onload({ type: 'load', target: el }); }, 0);
    return true;
  };

  Node.prototype.appendChild = function(node){
    if (node && node.__inlineHook && tryInline(node)) return node;
    return origAppend.apply(this, arguments);
  };
  Node.prototype.insertBefore = function(node, ref){
    if (node && node.__inlineHook && tryInline(node)) {
      return node;
    }
    return origInsert.apply(this, arguments);
  };
})();
`

// ---- 5. 组装 ----
const head = `<style>${safe(mainCss)}</style>\n${asyncStyles}`
// 内联脚本没有 defer 语义，必须放到 </body> 前，否则执行时 #root 还没解析出来
const body = `<script>${safe(hook)}</script>\n<script>${safe(mainJs)}</script>`
html = cssMatch ? html.replace(cssMatch[0], () => head) : html
html = html.replace(jsMatch[0], () => '')
html = html.replace('</body>', () => `${body}\n</body>`)

if (!/<meta[^>]*charset/i.test(html)) {
  html = html.replace('<head>', () => '<head><meta charset="utf-8">')
}

writeFileSync(out, html, 'utf8')

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`输出: ${out}`)
console.log(`单文件大小: ${kb(Buffer.byteLength(html))}`)
console.log(
  `内联异步 chunk: ${Object.keys(chunkMap).length} 个 JS / ${Object.keys(cssMap).length} 个 CSS`
)
console.log(`内联字体: ${Object.keys(fontCache).length} 个 woff2`)
const leftover =
  html.match(/<(?:script|link|img|iframe|source)[^>]{0,200}?(?:src|href)="(?!data:)[^"]+"/gi) ?? []
console.log(
  `剩余标签级外链: ${leftover.length}${leftover.length ? ' -> ' + leftover.join(', ') : '（无）'}`
)
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
const cssUrls = styleBlocks.match(/url\((?!data:)[^)]+\)/g) ?? []
console.log(
  `剩余 CSS 外链: ${cssUrls.length}${cssUrls.length ? ' -> ' + cssUrls.slice(0, 5).join(', ') : '（无）'}`
)
