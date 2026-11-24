import clsx from 'clsx'
import styles from './CharacterAvatar.module.css'

/**
 * 角色头像：有图就用图，没图用「灰底 + 名字第一个字」。
 * 顶栏胶囊、选择弹窗、角色管理列表共用这一个组件，尺寸靠 style 传。
 */
export const CharacterAvatar = ({
  avatar,
  name,
  size,
  rounded = false,
}: {
  avatar?: string
  name: string
  size: number
  rounded?: boolean
}) => {
  const className = clsx(styles.avatar, rounded ? styles.rounded : styles.circle)
  const style = { width: size, height: size }
  if (avatar) {
    return (
      <img className={clsx(className, styles.image)} src={avatar} alt="" style={style} />
    )
  }
  const initial = Array.from(name.trim())[0] ?? '?'
  return (
    <span
      className={clsx(className, styles.fallback)}
      style={{ ...style, fontSize: Math.round(size * 0.44) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}
