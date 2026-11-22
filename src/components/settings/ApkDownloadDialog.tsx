import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  ANDROID_APK_DIRECT_URL,
  ANDROID_APK_URL,
  openApkLink,
} from '../../services/androidDownload.js'
import { fetchApkFile, saveApkFile, type ApkProgress } from '../../services/apkDownload.js'
import { formatSize } from '../../services/update.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './ApkDownload.module.css'

type Stage = 'downloading' | 'failed'

/** 速度按量级换单位：几十 KB/s 显示成 0.0 MB/s 就白做了 */
const formatSpeed = (bytesPerSecond: number): string => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '—'
  }
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB`
  }
  if (bytesPerSecond >= 1024) {
    return `${Math.round(bytesPerSecond / 1024)} KB`
  }
  return `${Math.round(bytesPerSecond)} B`
}

/** 剩余时间：只给个粗量级，别做倒计时那种假精度 */
const formatRemaining = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return ''
  }
  if (seconds < 60) {
    return `${Math.ceil(seconds)} 秒`
  }
  const minutes = Math.floor(seconds / 60)
  const rest = Math.ceil(seconds - minutes * 60)
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

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

  /** 第三方镜像：只用于整包跳转下载（它们不给跨域头，没法在这里分片） */
  const MIRRORS = [
    'https://ghproxy.net/https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk',
    'https://ghfast.top/https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk',
  ]

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : 0
  const downloading = stage === 'downloading'
  // 已经下了一会儿还是慢：给两条整包下载的镜像，别让用户干等
  const slow =
    progress !== null &&
    progress.received > 512 * 1024 &&
    progress.bytesPerSecond > 0 &&
    progress.bytesPerSecond < 60 * 1024

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
            <>
              <div className={styles.hint}>
                {t('apkDownloadSpeed', { speed: formatSpeed(progress.bytesPerSecond) })}
                {progress.parts > 1 ? t('apkDownloadParts', { count: progress.parts }) : ''}
                {progress.total > 0 && progress.bytesPerSecond > 0
                  ? t('apkDownloadRemaining', {
                      time: formatRemaining(
                        (progress.total - progress.received) / progress.bytesPerSecond
                      ),
                    })
                  : ''}
              </div>
              {slow ? (
                <div className={styles.hint}>
                  {t('apkDownloadSlowHint')}
                  <a href={MIRRORS[0]} target="_blank" rel="noreferrer">
                    ghproxy.net
                  </a>
                  {' · '}
                  <a href={MIRRORS[1]} target="_blank" rel="noreferrer">
                    ghfast.top
                  </a>
                </div>
              ) : null}
            </>
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
