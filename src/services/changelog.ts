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
