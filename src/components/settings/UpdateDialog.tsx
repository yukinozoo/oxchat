import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import {
  downloadUpdate,
  formatSize,
  installUpdate,
  type CurrentVersion,
  type UpdateManifest,
} from '../../services/update.js'
import styles from './Update.module.css'

type Stage = 'idle' | 'downloading' | 'installing'

/** 更新弹窗：说明版本差异，下载带进度，完成后交给系统安装器 */
export const UpdateDialog = ({
  manifest,
  current,
  onClose,
}: {
  manifest: UpdateManifest
  current: CurrentVersion
  onClose: () => void
}) => {
  const t = useTranslate()
  const [stage, setStage] = useState<Stage>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [apkPath, setApkPath] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const run = async () => {
    setError(null)
    setHint(null)
    try {
      let path = apkPath
      if (!path) {
        setStage('downloading')
        setPercent(0)
        path = await downloadUpdate(manifest, setPercent)
        setApkPath(path)
      }
      setStage('installing')
      const result = await installUpdate(path)
      if (result === 'need-permission') {
        setHint(t('updateNeedPermission'))
        setStage('idle')
        return
      }
      showToast(t('updateInstalling'))
      onClose()
    } catch (failure) {
      setStage('idle')
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
    }
  }

  return (
    <Modal
      title={t('updateTitle', { version: manifest.versionName })}
      overlayClassName={styles.overlayLike}
      onClose={stage === 'downloading' ? () => undefined : onClose}
      footer={
        <>
          <Button variant="outlined" disabled={stage === 'downloading'} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={stage === 'downloading'} onClick={() => void run()}>
            {stage === 'downloading'
              ? t('updateDownloading', { percent })
              : apkPath
                ? t('updateInstall')
                : t('updateNow')}
          </Button>
        </>
      }
    >
      <div className={styles.wrap}>
        <div className={styles.versions}>
          <span>{t('updateCurrent')} {current.version}</span>
          <span className={styles.arrow}>→</span>
          <span className={styles.newVersion}>{manifest.versionName}</span>
        </div>
        {manifest.size > 0 ? (
          <div className={styles.meta}>{t('updateSize', { size: formatSize(manifest.size) })}</div>
        ) : null}
        {manifest.notes ? (
          <>
            <div className={styles.meta}>{t('updateNotesLabel')}</div>
            <p className={styles.notes}>{manifest.notes}</p>
          </>
        ) : null}
        {stage === 'downloading' ? (
          <>
            <div className={styles.progress}>
              <div className={styles.progressFill} style={{ width: `${percent}%` }} />
            </div>
            <div className={styles.hint}>{t('updateDownloading', { percent })}</div>
          </>
        ) : null}
        {hint ? <div className={styles.hint}>{hint}</div> : null}
        {error ? <div className={styles.error}>{t('updateFailed', { message: error })}</div> : null}
      </div>
    </Modal>
  )
}
