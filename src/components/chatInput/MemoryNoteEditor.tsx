import { useTranslate } from '../../i18n/index.js'
import { TextEditPage } from '../base/TextEditPage.js'

/**
 * 笔记编辑页：整屏编辑器 + 笔记自己的标题/占位文案。
 * 长笔记在列表里改不动，所以点「编辑」跳到这一页（见 `MemoryDialog`）。
 */
export const MemoryNoteEditor = ({
  text,
  title,
  onSave,
  onClose,
}: {
  text: string
  /** 不传就是「编辑笔记」；资料记忆传自己的标题 */
  title?: string
  onSave: (next: string) => void
  onClose: () => void
}) => {
  const t = useTranslate()
  return (
    <TextEditPage
      title={title ?? t('memoryNoteEditTitle')}
      initial={text}
      placeholder={t('memoryAddPlaceholder')}
      onSave={onSave}
      onClose={onClose}
    />
  )
}
