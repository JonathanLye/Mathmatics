/**
 * H5 路由兼容（issue #43 / 04 §5.1）：C 的 mirror-token 返回路径式 URL
 * `/s/mirror?attempt=…&token=…`，而学生 H5 是 hash 路由。
 *
 * 页面加载时若命中 /s/mirror，就 replace 到 `#/pages/mirror/index` 并原样保留查询参数。
 * 纯函数便于单测；main.ts 只做浏览器判断后调用。
 */
export const MIRROR_PATH_SUFFIX = '/s/mirror'
export const MIRROR_HASH_ROUTE = '#/pages/mirror/index'

/** 去掉末尾斜杠，得到规范化路径（根路径保留 '/'）。 */
function normalizePathname(pathname: string): string {
  if (typeof pathname !== 'string' || pathname.length === 0) return '/'
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed.length === 0 ? '/' : trimmed
}

/**
 * 若 pathname 命中 /s/mirror（支持子路径部署与末尾斜杠），返回应跳转到的 hash URL；
 * 否则返回 null。查询参数原样保留（token 功能必需，但只在浏览器地址栏/请求里，不写日志）。
 */
export function hashMirrorRedirect(pathname: string, search = ''): string | null {
  const path = normalizePathname(pathname)
  if (!path.endsWith(MIRROR_PATH_SUFFIX)) return null
  const base = path.slice(0, -MIRROR_PATH_SUFFIX.length)
  const query = typeof search === 'string' && search.startsWith('?') ? search : ''
  return (base || '') + '/' + MIRROR_HASH_ROUTE + query
}
