/**
 * 事件信封的身份字段（08 §2）：sessionId 每次打开应用新建；deviceId 首次生成后持久化。
 * 只存随机 uuid，不含任何 PII（无姓名/学号/匿名码）。
 */
import { readUniStorage, writeUniStorage } from '@/storage/uni'
import type { EventContext } from './events'
import { isUuid, uuidv7 } from './ids'

export const DEVICE_ID_KEY = 'pg_device_id'

export function createIdentity(): EventContext {
  const cached = readUniStorage<string>(DEVICE_ID_KEY)
  const deviceId = isUuid(cached) ? cached : uuidv7()
  if (cached !== deviceId) writeUniStorage(DEVICE_ID_KEY, deviceId)
  return { sessionId: uuidv7(), deviceId }
}
