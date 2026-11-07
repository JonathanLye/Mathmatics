/**
 * 全局错误处理。
 * - 页面 setup/render 崩了：跳到兜底页，带上原路由，学生可以再试一次；
 * - 其余（点击回调、异步）：弹一条轻提示，不砸掉页面。
 * 错误详情只进控制台，不给学生看。401 由鉴权任务统一处理，这里不管。
 */
import type { App } from 'vue'
import { useToast } from '@/components/ui/useToast'
import { isFatalVueError, retryRoute } from '@/components/ui/uiLogic'
import { FBBOX_COPY } from '@/copy/feedbackbox'
import { pageKeyOf } from '@/feedbackbox/logic'
import { recordError } from '@/feedbackbox/probe'
import { openFeedbackSheet } from '@/feedbackbox/store'
import { useSession } from '@/stores/session'

function currentRoute(): string | null {
  if (typeof window === 'undefined') return null
  return retryRoute(window.location.hash.replace(/^#/, ''))
}

export function installGlobalErrorHandler(app: App): void {
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[pg] 未捕获的错误', info, error)
    recordError(error, info)
    if (!isFatalVueError(info)) {
      // 登录并签了同意书的同学，提示上多一个「告诉小方」，一点就能带着刚才的情况去反馈（15 §6）。
      const { loggedIn, consented } = useSession()
      const here = typeof window === 'undefined' ? '' : pageKeyOf(window.location.hash.replace(/^#/, ''))
      const canReport = loggedIn.value && consented.value && here !== '' && here !== 'practice'
      useToast().show('出了点小问题，再试一次', {
        tone: 'warn',
        ...(canReport ? { action: { label: FBBOX_COPY.toastReport, run: () => openFeedbackSheet({ kind: 'bug' }) } } : {}),
      })
      return
    }
    const from = currentRoute()
    // 兜底页自己崩了就停在原地，不进死循环。
    if (typeof window !== 'undefined' && window.location.hash.includes('/pages/not-found/')) return
    uni.reLaunch({ url: '/pages/not-found/index?kind=error' + (from ? '&from=' + encodeURIComponent(from) : '') })
  }
}
