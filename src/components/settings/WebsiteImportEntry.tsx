import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { websiteImportAvailable } from '../../services/chat/websiteImport.js'
import { Button } from '../base/Button.js'
import { WebsiteImportDialog } from './WebsiteImportDialog.js'
import styles from './Settings.module.css'

/**
 * 数据管理页的「从 DeepSeek 官网导入」入口：仅在原生壳里显示，
 * 点击后打开内嵌登录与对话选择流程。
 */
export const WebsiteImportEntry = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  if (!websiteImportAvailable()) {
    return null
  }
  return (
    <>
      <div className={`${styles.cell} ${styles.row}`}>
        <div className={styles.text}>
          <div className={styles.label}>{t('websiteImportLabel')}</div>
          <div className={styles.description}>{t('websiteImportDesc')}</div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {t('websiteImportTitle')}
        </Button>
      </div>
      {open ? <WebsiteImportDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}
