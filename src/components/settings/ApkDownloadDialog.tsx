import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ANDROID_APK_DIRECT_URL, ANDROID_APK_URL, openApkLink } from '../../services/androidDownload.js'
import { fetchApkFile, saveApkFile, type ApkProgress } from '../../services/apkDownload.js'
import { formatSize } from '../../services/update.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './ApkDownload.module.css'

type Stage = 'downloading' | 'failed'

/**
 * 网页版下载安装包：打开即开始下载，显示进度与速度。
 * GitHub Pages 单线程很慢，所以走 services/apkDownload 的分片并行；失败时可退到浏览器直接下载。
 */
export const ApkDownloadDialog = ({
  onClose,
  overlayClassName,
}: {
  onClose: () => void
  /** 必须传入：设置页本身是 z-index 1100 的整屏层，弹窗要用更高层级才看得见 */
  overlayClassName: string
}) => {
  const t = useTranslate()
  const [stage, setStage] = useState<Stage>('downloading')
  const [progress, setProgress] = useState<ApkProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setStage('downloading')
    setError(null)
    setProgress(null)
    try {
      const file = await fetchApkFile(ANDROID_APK_URL, setProgress, current.signal)
      if (current.signal.aborted) {
        return
      }
      saveApkFile(file)
      showToast(t('apkDownloadDone'))
      onClose()
    } catch (failure) {
      if (current.signal.aborted) {
        return
      }
      setStage('failed')
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [onClose, t])

  useEffect(() => {
    void run()
    return () => controller.current?.abort()
  }, [run])

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : 0
  const downloading = stage === 'downloading'

  return (
    <Modal
      title={t('apkDownloadTitle')}
      onClose={() => {
        controller.current?.abort()
        onClose()
      }}
      className={styles.dialog}
      overlayClassName={overlayClassName}
      footer={
        downloading ? (
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              controller.current?.abort()
              onClose()
            }}
          >
            {t('apkDownloadCancel')}
          </Button>
        ) : (
          <>
            <Button
              variant="outlined"
              size="m"
              onClick={() => {
                openApkLink(ANDROID_APK_DIRECT_URL)
                onClose()
              }}
            >
              {t('apkDownloadFallback')}
            </Button>
            <Button variant="primary" size="m" onClick={() => void run()}>
              {t('apkDownloadRetry')}
            </Button>
          </>
        )
      }
    >
      {downloading ? (
        <>
          <div className={styles.progress} role="progressbar" aria-valuenow={percent}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
          <div className={styles.meta}>
            <span>
              {progress
                ? t('apkDownloadProgress', {
                    done: formatSize(progress.received),
                    total: formatSize(progress.total),
                  })
                : t('apkDownloadPreparing')}
            </span>
            {progress && progress.total > 0 ? <span>{percent}%</span> : null}
          </div>
          {progress ? (
            <div className={styles.hint}>
              {t('apkDownloadSpeed', { speed: formatSize(progress.bytesPerSecond) })}
              {progress.parts > 1 ? t('apkDownloadParts', { count: progress.parts }) : ''}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles.error}>{t('apkDownloadFailed', { message: error ?? '' })}</div>
          {/* 分片失败常见于代理/网络中断：说明还能改用浏览器单线程下载 */}
          <div className={styles.hint}>{t('apkDownloadFallbackHint')}</div>
        </>
      )}
    </Modal>
  )
}
