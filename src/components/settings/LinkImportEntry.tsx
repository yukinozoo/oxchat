import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadArchiveFromUrl } from '../../services/chat/linkImport.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { ArchiveImportDialog } from './ArchiveImportDialog.js'
import styles from './Settings.module.css'

/**
 * 链接导入：粘贴官网导出的下载链接（预签名地址，7 天有效），
 * 下载后走与本地备份包相同的勾选导入流程。
 */
export const LinkImportEntry = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [archive, setArchive] = useState<File | null>(null)
  const trimmed = url.trim()

  const submit = async () => {
    if (!/^https?:\/\//i.test(trimmed)) {
      showToast(t('websiteLinkInvalid'))
      return
    }
    setBusy(true)
    try {
      const file = await loadArchiveFromUrl(trimmed)
      setArchive(file)
      setUrl('')
    } catch (error) {
      showToast(
        t('websiteLinkFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={`${styles.cell} ${styles.linkImport}`}>
        <div className={styles.label}>{t('websitePasteLink')}</div>
        <div className={styles.linkRow}>
          <input
            className={styles.linkInput}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('websitePastePlaceholder')}
            aria-label={t('websitePastePlaceholder')}
            value={url}
            disabled={disabled || busy}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed && !busy) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled || busy || trimmed === ''}
            onClick={() => void submit()}
          >
            {busy ? t('websiteLinkDownloading') : t('websiteImportFromLink')}
          </Button>
        </div>
        <div className={styles.description}>{t('websiteLinkImportDesc')}</div>
      </div>
      {archive ? (
        <ArchiveImportDialog
          file={archive}
          onClose={() => setArchive(null)}
          onDone={({ imported }) => {
            showToast(
              t(imported === 1 ? 'historyImportedOne' : 'historyImported', { count: imported })
            )
            setArchive(null)
          }}
        />
      ) : null}
    </>
  )
}
