import { Inflate } from 'fflate'

/**
 * ZIP 解压 Worker：把 deflate 解压从主线程挪走，避免大归档导入时界面卡住。
 * 每个条目一个 Inflate 实例，按 (id, 分片) 流式喂入，边解边把结果传回主线程。
 */

type Push = {
  id: string
  data: Uint8Array
  final: boolean
}

const inflates = new Map<string, Inflate>()
let out: Uint8Array[] = []

self.onmessage = (event: MessageEvent<Push>) => {
  const { id, data, final } = event.data
  out = []
  let inflate = inflates.get(id)
  if (!inflate) {
    inflate = new Inflate((chunk) => {
      out.push(chunk)
    })
    inflates.set(id, inflate)
  }
  try {
    inflate.push(data, final)
    const chunks = out
    ;(
      self as unknown as { postMessage: (message: unknown, transfer: Transferable[]) => void }
    ).postMessage(
      { id, chunks },
      chunks.map((chunk) => chunk.buffer)
    )
    if (final) {
      inflates.delete(id)
    }
  } catch (error) {
    inflates.delete(id)
    ;(self as unknown as { postMessage: (message: unknown) => void }).postMessage({
      id,
      error: error instanceof Error ? error.message : 'inflate failed',
    })
  }
}
