/** 统一的日期格式：页面只用这里的函数，无效值一律返回空串，由调用方决定占位。 */

const pad = (n: number) => String(n).padStart(2, '0')

function toDate(value?: string | number | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 2026-11-03（本地时区）。 */
export function formatDate(value?: string | number | Date | null): string {
  const date = toDate(value)
  if (!date) return ''
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** 11-03 08:30（本地时区；批注时间、开放时间）。 */
export function formatDateTime(value?: string | number | Date | null): string {
  const date = toDate(value)
  if (!date) return ''
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}
