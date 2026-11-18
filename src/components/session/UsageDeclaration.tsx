import { useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './UsageDeclaration.module.css'

const ACCEPTED_KEY = 'oxchat:usage-declaration-accepted'
const UPSTREAM_URL = 'https://github.com/deepseek-ai/chat-demo'

const hasAccepted = () => {
  try {
    return localStorage.getItem(ACCEPTED_KEY) === '1'
  } catch {
    return false
  }
}

/** 首次启动时展示使用声明；确认状态仅保存在本机。 */
export const UsageDeclaration = () => {
  const [open, setOpen] = useState(() => !hasAccepted())

  if (!open) {
    return null
  }

  const accept = () => {
    try {
      localStorage.setItem(ACCEPTED_KEY, '1')
    } catch {
      // 存储不可用时仍允许进入应用，下次启动会再次展示声明。
    }
    setOpen(false)
  }

  return (
    <Modal
      title="使用前请了解"
      className={styles.dialog}
      mainClassName={styles.main}
      overlayClassName={styles.overlay}
      onClose={() => undefined}
      footer={
        <Button autoFocus className={styles.confirm} onClick={accept}>
          我已了解
        </Button>
      }
    >
      <p className={styles.intro}>OxChat 是一个非官方的 API 客户端，请先确认以下几点：</p>
      <ul className={styles.list}>
        <li>
          本应用基于 DeepSeek 官方开源前端 chat-demo（MIT
          License）进行适配与分发，属非官方发布，与深度求索公司无任何关联，未获其授权或背书。
        </li>
        <li>
          本应用不提供模型服务、不内置 API Key、不代理或转发任何请求。所有对话均由你自己的 DeepSeek
          账号与官方服务产生，费用由官方按量结算。
        </li>
        <li>
          模型输出由官方服务产生，请自行判断并承担使用后果；请遵守官方服务条款及你所在地的法律法规。
        </li>
        <li>你的 API Key 与对话记录只保存在本设备，不会上传给任何第三方。</li>
        <li>
          本应用是个人非商业项目：完全免费，无广告、无内购、不收取任何费用，也不接受捐赠或赞助，不收集任何用户数据。所有模型调用费用由你自己的
          DeepSeek 账号承担。
        </li>
      </ul>
      <div className={styles.meta}>
        <div>OxChat · upstream chat-demo 0.1.1 · MIT</div>
        <a href={UPSTREAM_URL} target="_blank" rel="noreferrer">
          {UPSTREAM_URL}
        </a>
      </div>
    </Modal>
  )
}
