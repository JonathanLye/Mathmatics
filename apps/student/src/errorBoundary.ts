/**
 * 全局错误处理。
 * - 页面 setup/render 崩了：跳到兜底页，带上原路由，学生可以再试一次；
 * - 其余（点击回调、异步）：弹一条轻提示，不砸掉页面。
 * 错误详情只进控制台，不给学生看。401 由鉴权任务统一处理，这里不管。
 */
import type { App } from 'vue'
import { useToast } from '@/components/ui/useToast'
import { isFatalVueError, retryRoute } from '@/components/ui/uiLogic'

function currentRoute(): string | null {
  if (typeof window === 'undefined') return null
  return retryRoute(window.location.hash.replace(/^#/, ''))
}

export function installGlobalErrorHandler(app: App): void {
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[pg] 未捕获的错误', info, error)
    if (!isFatalVueError(info)) {
      useToast().show('出了点小问题，再试一次', { tone: 'warn' })
      return
    }
    const from = currentRoute()
    // 兜底页自己崩了就停在原地，不进死循环。
    if (typeof window !== 'undefined' && window.location.hash.includes('/pages/not-found/')) return
    uni.reLaunch({ url: '/pages/not-found/index?kind=error' + (from ? '&from=' + encodeURIComponent(from) : '') })
  }
}
