#!/usr/bin/env node
/**
 * 生成在线更新清单：读已构建的 APK，算出体积与 SHA-256，
 * 版本号取自 android/app/build.gradle，写入 src/update.json（随站点发布）。
 *
 * 用法：node scripts/make-update.mjs <apk 路径> "更新说明"
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const apk = process.argv[2]
const notes = process.argv[3] ?? ''
if (!apk) {
  console.error('用法: node scripts/make-update.mjs <apk 路径> "更新说明"')
  process.exit(1)
}

const gradle = readFileSync(
  path.resolve('../oxchat-app/android/app/build.gradle'),
  'utf8'
)
const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0)
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? ''
if (!versionCode || !versionName) {
  console.error('没在 build.gradle 里找到 versionCode / versionName')
  process.exit(1)
}

const bytes = readFileSync(apk)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const size = statSync(apk).size

const manifest = {
  versionCode,
  versionName,
  size,
  sha256,
  notes,
  sources: [
    'https://gh-proxy.com/https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk',
    'https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk',
  ],
}

writeFileSync(path.resolve('src/update.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`已写入 src/update.json：${versionName}（${versionCode}），${(size / 1024 / 1024).toFixed(2)} MB`)
console.log(`sha256 ${sha256}`)
console.log('\n下一步（需要 gh 已登录）：')
console.log(`  gh release create v${versionName} "${apk}#OxChat-latest.apk" --title "OxChat ${versionName}" --notes "${notes || '更新'}"`)
console.log('  然后重新构建网页并部署，让 update.json 生效：pnpm build && ./deploy.sh yukinozoo oxchat')
