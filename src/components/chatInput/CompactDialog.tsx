import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getCompactPlan } from '../../services/chat/compact.js'
import { compactSession, useChatStore } from '../../services/chat/store.js'
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
  const abortRef = useRef<AbortController | null>(null)
  const count = session ? getCompactPlan(session).head.length : 0

  // 关闭弹窗（含被上层移除）时中止尚未完成的请求
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setError(null)
    const result = await compactSession(sessionId, controller.signal)
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
          <Button disabled={running} onClick={() => void run()}>
            {running ? t('compactRunning') : t('compactEntry')}
          </Button>
        </>
      }
    >
      <p className={styles.text}>{t('compactDescription')}</p>
      <p className={styles.note}>{t('compactNote', { count })}</p>
      {error ? <p className={styles.error}>{t('compactFailed', { message: error })}</p> : null}
    </Modal>
  )
}
