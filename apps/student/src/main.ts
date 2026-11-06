import { createApp as createVueApp, createSSRApp } from 'vue'
import App from './App.vue'
import { hashMirrorRedirect } from './components/mirror/mirrorRoute'
import PgToast from './components/ui/PgToast.vue'
import { installGlobalErrorHandler } from './errorBoundary'
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

/** 轻提示挂在页面之外：换页不丢，任何模块都能 useToast()。这个小应用只用原生标签，不依赖 uni 组件。 */
function mountToastHost(): void {
  if (typeof document === 'undefined') return
  const host = document.createElement('div')
  host.id = 'pg-toast-host'
  document.body.appendChild(host)
  createVueApp(PgToast).mount(host)
}

redirectMirrorPathToHash()

export function createApp() {
  const app = createSSRApp(App)
  installGlobalErrorHandler(app)
  mountToastHost()
  return { app }
}
