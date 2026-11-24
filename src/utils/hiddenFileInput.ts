import type { CSSProperties } from 'react'

/**
 * 隐藏的 `<input type="file">` 的标准写法：**不要用 `hidden` / `display:none`**。
 *
 * iOS Safari 对被 `display:none` 掉的文件输入，程序化 `click()` 常常不弹选择器
 * （网页版表现为「点了上传没反应」）。这里改成「移出可视区但仍在布局树里」：
 * 位置放到屏幕外、尺寸 1px、`opacity: 0`、不接指针事件，既看不见也点不到，
 * 但浏览器仍认为它是可用的文件输入。
 *
 * 参考 ds-lite（同一个坑，他们踩过并修好了）。
 */
export const HIDDEN_FILE_INPUT_STYLE: CSSProperties = {
  position: 'absolute',
  left: -9999,
  top: 0,
  width: 1,
  height: 1,
  opacity: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
}
