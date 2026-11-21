/**
 * 设置表的记录形状。
 * 新库用 `createObjectStore('settings', { keyPath: 'id' })`，只能存对象；
 * 旧库是外置键（put(value, key)）。这里给出内置键的记录，供写入与冒烟复用。
 */
export type SettingRecord = { id: string; value: string }

export const toSettingRecord = (key: string, value: string): SettingRecord => ({
  id: key,
  value,
})

/** 读到的东西可能是字符串（旧库）或记录（新库），统一取出字符串值 */
export const fromSettingRecord = (record: unknown): string | undefined => {
  if (typeof record === 'string') {
    return record
  }
  if (
    record !== null &&
    typeof record === 'object' &&
    typeof (record as { value?: unknown }).value === 'string'
  ) {
    return (record as { value: string }).value
  }
  return undefined
}
