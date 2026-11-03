import { createSSRApp } from 'vue'
import App from './App.vue'
import { hashMirrorRedirect } from './components/mirror/mirrorRoute'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/base.css'

/**
 * #43 / 04 §5.1：C 的 mirror-token 返回路径式 /s/mirror?attempt=…&token=…，
 * 学生 H5 是 hash 路由；这里在应用启动前把路径式 URL 重定向到 #/pages/mirror/index，
 * 查询参数原样保留（token 只在地址栏/请求里，不打印、不进 DOM 文本）。
 */
function redirectMirrorPathToHash(): void {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return
  const target = hashMirrorRedirect(window.location.pathname, window.location.search)
  if (target) window.location.replace(target)
}

redirectMirrorPathToHash()

export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
