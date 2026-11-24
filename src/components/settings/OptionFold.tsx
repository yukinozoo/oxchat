import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '../base/icons.js'
import styles from './OptionFold.module.css'

/**
 * 「选项」折叠行：标题 + 当前状态摘要 + 箭头。
 *
 * 导入/导出弹窗里的小勾选项以前各占一大块，把对话列表挤得只剩一两行；
 * 现在统一收进这一行，默认收起，标题右侧直接写出现在生效的选项，
 * 不展开也能确认状态。三处弹窗共用，避免样式各写一套。
 */
export const OptionFold = ({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  /** 收起时显示的状态摘要，一般由调用方按当前开关拼好 */
  summary: string
  defaultOpen?: boolean
  children: ReactNode
}) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.fold}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.title}>{title}</span>
        <span className={styles.summary}>{summary}</span>
        <span className={clsx(styles.chevron, open && styles.chevronOpen)}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open ? <div className={styles.body}>{children}</div> : null}
    </div>
  )
}
