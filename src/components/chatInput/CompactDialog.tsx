import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getCompactPlan } from '../../services/chat/compact.js'
import { compactSession, useChatStore } from '../../services/chat/store.js'
import { compactProgress, subscribeCompactProgress } from '../../services/chat/compactProgress.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './CompactDialog.module.css'

/**
 * 压缩当前对话：先确认要压缩多少条，确认后调用模型总结，
 * 期间可取消；结果以轻提示反馈，完成后自动关闭。
 */
export const CompactDialog = ({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    Object.hasOwn(state.sessionCache, sessionId) ? state.sessionCache[sessionId] : undefined
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 历史太长时先拿到段数，等用户确认再真跑 */
  const [pending, setPending] = useState<{ chunks: number; tokens: number } | null>(null)
  const progress = useSyncExternalStore(subscribeCompactProgress, compactProgress, compactProgress)
  const abortRef = useRef<AbortController | null>(null)
  const count = session ? getCompactPlan(session).head.length : 0

  // 关闭弹窗（含被上层移除）时中止尚未完成的请求
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (confirmed = false) => {
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setError(null)
    const result = await compactSession(
      sessionId,
      controller.signal,
      confirmed ? { confirmed: true } : {}
    )
    abortRef.current = null
    setRunning(false)
    switch (result.status) {
      case 'done':
        showToast(t('compactDone', { count: result.messages }))
        onClose()
        return
      case 'cancelled':
        return
      case 'short':
        showToast(t('compactShort'))
        onClose()
        return
      case 'busy':
        showToast(t('compactBusy'))
        return
      case 'missing':
        showToast(t('sessionLoadFailed'))
        onClose()
        return
      case 'confirm':
        setPending({ chunks: result.chunks, tokens: result.tokens })
        return
      default:
        setError(result.message)
    }
  }

  return (
    <Modal
      title={t('compactTitle')}
      overlayClassName={styles.overlay}
      closable={!running}
      onClose={() => {
        if (!running) {
          onClose()
        }
      }}
      footer={
        <>
          <Button
            variant="outlined"
            onClick={() => (running ? abortRef.current?.abort() : onClose())}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={running}
            onClick={() => void run(pending !== null)}
          >
            {running
              ? progress.total > 1
                ? t('compactRunningStep', { done: progress.done, total: progress.total })
                : t('compactRunning')
              : pending
                ? t('compactLargeConfirm')
                : t('compactEntry')}
          </Button>
        </>
      }
    >
      <p className={styles.text}>{t('compactDescription')}</p>
      <p className={styles.note}>{t('compactNote', { count })}</p>
      {pending ? (
        <p className={styles.error}>
          {t('compactLargeWarn', { chunks: pending.chunks, tokens: Math.round(pending.tokens / 1000) })}
        </p>
      ) : null}
      {error ? <p className={styles.error}>{t('compactFailed', { message: error })}</p> : null}
    </Modal>
  )
}
