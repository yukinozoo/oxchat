import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

const dev = process.env.NODE_ENV !== 'production'
const targets = ['chrome >= 90', 'edge >= 90', 'safari >= 15', 'firefox >= 102']
const root = path.dirname(fileURLToPath(import.meta.url))
/**
 * 版本号来源：优先 src/update.json（每次发布由 make-update.mjs 写入，与 APK 同步），
 * 没有时退回 package.json。网页版「关于 → 当前版本」读的就是这里注入的 meta。
 */
const readVersion = (): string => {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('./src/update.json', import.meta.url), 'utf8')
    ) as { versionName?: string }
    if (manifest.versionName) {
      return manifest.versionName
    }
  } catch {
    // 首次构建还没有清单时退回 package.json
  }
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  return pkg.version
}

const version = readVersion()

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  devServer,
}: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  output: {
    // SINGLE_FILE=1 时产出到 dist-single，并把 publicPath 固定为相对值：
    // 内联脚本没有 src，'auto' 会推导失败并抛错
    path: path.resolve(root, process.env.SINGLE_FILE === '1' ? 'dist-single' : 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: process.env.SINGLE_FILE === '1' ? '' : 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
      // 图片资源：欢迎页的鲸鱼剪影等
      { test: /\.(png|svg|jpe?g|webp)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.DefinePlugin({ __API_ORIGIN__: JSON.stringify(apiOrigin) }),
    new rspack.CopyRspackPlugin({
      patterns: [
        { from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' },
        // 站点图标与 Web App 清单：放在产物根目录，index.html 用相对路径引用
        { from: path.resolve(root, 'src/assets'), to: '.', toType: 'dir' },
        {
          from: path.resolve(root, 'src/manifest.webmanifest'),
          to: 'manifest.webmanifest',
          toType: 'file',
        },
        // 在线更新清单：随站点发布，App 从 Pages 读取
        { from: path.resolve(root, 'src/update.json'), to: 'update.json', toType: 'file' },
      ],
    }),
  ],
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
