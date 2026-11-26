/**
 * 版本更新记录（应用内「本版更新了什么」的数据源）。
 *
 * 规则：只写**用户可感知**的变化，一条一句话；新的版本放最前面。
 * 与《OxChat-版本日志.md》同步维护（那边是完整流水，这里是给用户看的摘要）。
 * `versionCode` 要与 `android/app/build.gradle` 对齐，弹窗按它判断「装的是哪一版」。
 */
export type ChangelogEntry = {
  versionCode: number
  versionName: string
  /** YYYY-MM-DD */
  date: string
  items: string[]
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    versionCode: 105,
    versionName: '0.1.105',
    date: '2026-11-26',
    items: [
      '新增「回复篇幅」：设置 → 个性化里选默认 / 详细 / 简略，防止长对话越聊越短',
      '修复 iOS 网页版键盘弹出后输入框被推到屏幕顶部（键盘留白算了两遍）',
    ],
  },
  {
    versionCode: 104,
    versionName: '0.1.104',
    date: '2026-11-25',
    items: [
      '导入报错看得懂了：文件不完整 / 压缩方式不支持 / 链接过期 / 链接返回的是网页，各给一句人话和下一步',
      '修复尾巴被改过的备份包被误判为「不是 ZIP」（改成整文件查找目录）',
      '链接导入会先校验是不是压缩包，避免拿网页去解析',
    ],
  },
  {
    versionCode: 103,
    versionName: '0.1.103',
    date: '2026-11-25',
    items: [
      '新增「接着聊」：从一条很长的旧对话里抽出人设与语气样例，建卡、绑定、压缩一条龙（角色管理 → 接着聊）',
      '角色卡新增剧情时间线、原话样例、锁定模型三项，随卡片导入导出',
      '只有自定义渠道 Key 时，压缩 / 生成笔记 / 接续抽取也能用，不再提示「输入 API Key」',
      '自定义渠道支持 http:// 地址（局域网中转），模型列表拉不到会显示原因，并可手动填模型名',
      '修复别的工具生成的备份包导不进来（宽松解析 ZIP / ZIP64）',
      '键盘弹出时输入框正确顶起，间距不再过大或贴住键盘',
    ],
  },
  {
    versionCode: 102,
    versionName: '0.1.102',
    date: '2026-11-25',
    items: [
      '修复聊天壁纸到不了状态栏后面（WebView 全屏 + 系统栏透明），状态栏图标跟着壁纸明暗翻色',
      '修复侧边栏顶部压到状态栏、底部「设置」贴手势条，首行与对话页汉堡图标对齐',
      '修复「填写 API Key」进去后返回落到设置首页，现在直接回对话页',
      '修复导入大备份时报「transaction has finished」失败',
    ],
  },
  {
    versionCode: 101,
    versionName: '0.1.101',
    date: '2026-11-25',
    items: [
      '网页版主脚本下载卡住时（网络慢/被中转拦）6 秒自动重试一次',
      '白屏兜底页点明「页面还没加载完」，不再笼统说「没渲染出内容」',
    ],
  },
  {
    versionCode: 100,
    versionName: '0.1.100',
    date: '2026-11-25',
    items: ['网页版打开时自动检查更新，有新版本会在顶部提示「刷新」'],
  },
  {
    versionCode: 99,
    versionName: '0.1.99',
    date: '2026-11-25',
    items: [
      '记忆管理可以「显示全部对话」：没有记忆的对话也能直接挑一条开始写笔记',
      '修正「只有资料记忆」时行的状态文案（之前会误写「只折叠过消息」）',
    ],
  },
  {
    versionCode: 98,
    versionName: '0.1.98',
    date: '2026-11-25',
    items: [
      '修复 iOS 上点「上传」没反应（隐藏的文件选择框换了 iOS 兼容写法）',
      '修复 iOS 朗读没声音（音频上下文补 resume）',
      '修复 iOS 聚焦输入框时整页被放大（表单字号不低于 16px）',
    ],
  },
  {
    versionCode: 97,
    versionName: '0.1.97',
    date: '2026-11-25',
    items: [
      '修复 iOS 上网页版偶发白屏：缺 matchMedia / Intl.DisplayNames 时不再启动即崩',
      '白屏兜底页补充诊断信息（地址、存储、缺失 API、控制台报错），并加一个「强制刷新（清缓存）」按钮',
    ],
  },
  {
    versionCode: 96,
    versionName: '0.1.96',
    date: '2026-11-24',
    items: ['修复设置各个子页面背景色'],
  },
  {
    versionCode: 95,
    versionName: '0.1.95',
    date: '2026-11-24',
    items: ['大量优化', '新增角色管理', '新增记忆管理'],
  },
  {
    versionCode: 94,
    versionName: '0.1.94',
    date: '2026-11-22',
    items: [
      '侧栏的分组（文件夹）标题也会吸顶了：滚动时文件夹名与条数停在顶部，往下滚到下一个分组时由下一个标题顶上去',
    ],
  },
]

/** 最新一条（网页版没有原生版本号时用它） */
export const latestEntry = (): ChangelogEntry => CHANGELOG[0]

/**
 * 按安装的 versionCode 找对应记录：取「不高于它」的最新一条。
 * 找不到（装的是比记录更老的版本）时返回 null，不弹空弹窗。
 */
export const entryFor = (versionCode: number | null): ChangelogEntry | null => {
  if (versionCode === null) {
    return latestEntry()
  }
  return CHANGELOG.find((entry) => entry.versionCode <= versionCode) ?? null
}
