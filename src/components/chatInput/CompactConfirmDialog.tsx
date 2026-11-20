import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { CompactDialog } from './CompactDialog.js'
import {
  closeCompactPrompt,
  forgetCompactPrompt,
  markCompactPromptDismissed,
  useCompactPrompt,
} from './compactPromptState.js'

/**
 * 超长对话的发送前确认：告诉用户现在有多长、会被怎么处理，
 * 把「先压缩还是直接发」的选择权交给用户。
 */
export const CompactConfirmDialog = () => {
  const t = useTranslate()
  const request = useCompactPrompt((state) => state.request)
  const [compacting, setCompacting] = useState(false)

  if (!request) {
    return null
  }
  if (compacting) {
    return (
      <CompactDialog
        sessionId={request.sessionId}
        onClose={() => {
          setCompacting(false)
          // 压缩完长度已变，下一次发送重新判断
          forgetCompactPrompt(request.sessionId)
          closeCompactPrompt()
        }}
      />
    )
  }

  const close = () => {
    setCompacting(false)
    closeCompactPrompt()
  }

  return (
    <Modal
      title={t('compactPromptTitle')}
      closable
      onClose={close}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              markCompactPromptDismissed(request.sessionId, request.tokens)
              const proceed = request.proceed
              close()
              proceed()
            }}
          >
            {t('compactPromptSendAnyway')}
          </Button>
          <Button size="m" onClick={() => setCompacting(true)}>
            {t('compactPromptCompactFirst')}
          </Button>
        </>
      }
    >
      <p>{t('compactPromptBody', { tokens: request.tokens })}</p>
    </Modal>
  )
}
