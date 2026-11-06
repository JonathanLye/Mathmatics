/**
 * 会话/登录/同意（issue #24：真实接口；mock 模式保留本地 fallback）。
 *
 * - 登录：POST /auth/student/login（#18 已完成），响应设置 HttpOnly Cookie，返回 Me；
 * - 同意书：GET /consents 取服务端文本与本人签署状态，POST /consents 提交 {version, items}；
 *   必选三段（service / crossBorderHosting / monitoring）未同意时不允许开始练习（13 §2）。
 * - 页面只渲染本 store；不在前端判断是否需要同意（以 Me.consentRequired 为准）。
 * - #145 年龄分档：Me.ageBand 由本 store 解析；null → 路由守卫去年龄选择页（登录后、同意/练习前）；
 *   14–17 的 guardianNotice 只读、不参与签署；lt14 由选择页展示「暂不开通」（合规判定以服务端为准）。
 */
import { computed, ref } from 'vue'

import {
  errorMessage,
  getConsents,
  getMe,
  isMockMode,
  login as apiLogin,
  logout as apiLogout,
  mockConsentDoc,
  setStudentAgeBand,
  submitConsents,
} from '@/api/client'
import { setAuthLostHandler } from '@/api/http'
import { ageGateFor, isReadOnlyConsentSection, type AgeGateDecision } from '@/auth/ageBand'
import type { AgeBand, ConsentChoices, ConsentDoc, ConsentKey, ConsentSectionKey, MeAgeBand, MeView } from '@/types/attempt'

export interface ConsentItem {
  id: ConsentSectionKey
  title: string
  required: boolean
  summary: string
  detail: string
  value: boolean
  /** guardianNotice 等只读说明段：不渲染开关、不参与 signed choices（#131）。 */
  readOnly: boolean
}

function toItems(doc: ConsentDoc): ConsentItem[] {
  return doc.sections.map((section) => {
    const readOnly = isReadOnlyConsentSection(section.key)
    const signedValue = readOnly ? undefined : doc.signed?.items?.[section.key as ConsentKey]
    return {
      id: section.key,
      title: section.title,
      required: section.required,
      summary: section.body,
      detail: section.body,
      // 必选项目前固定开（UI 不允许取消）；可选项恢复本人上次签署的值；只读说明段永远不勾选。
      value: readOnly ? false : section.required ? true : signedValue === true,
      readOnly,
    }
  })
}

const items = ref<ConsentItem[]>(toItems(mockConsentDoc))
const docVersion = ref(mockConsentDoc.version)
const signed = ref<ConsentDoc['signed']>(null)
const me = ref<MeView | null>(null)
const inviteCode = ref('')
const studentNo = ref('')
const loggedIn = ref(false)
const consented = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
/** 年龄守卫记录的「原目标」（成功后回跳；只存应用内页面路径）。 */
const pendingRoute = ref('')

function applyDoc(doc: ConsentDoc): void {
  docVersion.value = doc.version
  signed.value = doc.signed
  items.value = toItems(doc)
}

function choices(): ConsentChoices {
  const result: ConsentChoices = {
    service: false,
    crossBorderHosting: false,
    crossBorderModel: false,
    monitoring: false,
    research: false,
  }
  for (const item of items.value) {
    // guardianNotice 只读说明不签署；POST /consents 的 items 只发契约的 5 个可签键。
    if (item.readOnly || isReadOnlyConsentSection(item.id)) continue
    result[item.id as ConsentKey] = item.value
  }
  return result
}

const requiredOk = computed(() => items.value.filter((item) => item.required).every((item) => item.value))

const mockSleep = (ms = 80) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 登录已失效的统一提示文案（401 / wrong_app 403）。 */
export const AUTH_EXPIRED_TOAST = '登录已过期，请重新登录'
const LOGIN_PAGE = 'pages/login/index'
/** 登录页与镜像页（令牌访问，没有会话）不跳。 */
const NO_REDIRECT_PAGES = [LOGIN_PAGE, 'pages/mirror/index']
let lastAuthRedirectAt = 0

function currentPageRoute(): string {
  if (typeof getCurrentPages !== 'function') return ''
  const pages = getCurrentPages()
  return (pages[pages.length - 1] as { route?: string } | undefined)?.route ?? ''
}

/**
 * 非登录类接口返回 401（或浏览器里只有教师端会话的 403 wrong_app）：清掉本地会话，提示后回登录页。
 * 并发的多个请求同时失败时只跳一次；mock 模式不走 http，不会到这里。
 */
export function handleAuthLost(): void {
  me.value = null
  loggedIn.value = false
  consented.value = false
  const route = currentPageRoute().replace(/^\//, '')
  if (NO_REDIRECT_PAGES.includes(route)) return
  const now = Date.now()
  if (now - lastAuthRedirectAt < 2000) return
  lastAuthRedirectAt = now
  if (typeof uni === 'undefined') return
  uni.showToast({ title: AUTH_EXPIRED_TOAST, icon: 'none' })
  uni.reLaunch({ url: `/${LOGIN_PAGE}` })
}

setAuthLostHandler(handleAuthLost)

export function useSession() {
  /** GET /consents：加载服务端同意书文本；mock 模式回落到内置占位（正文只从 GET /consents 取）。 */
  async function loadConsentDoc(): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      applyDoc(await getConsents())
      return true
    } catch (e) {
      error.value = errorMessage(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /** 年龄分档（Me.ageBand；null=尚未选择）。 */
  const ageBand = computed<MeAgeBand>(() => me.value?.ageBand ?? null)

  /** 用服务端返回的 Me 更新会话（登录/提交同意/设置年龄共用）。 */
  function applyMe(next: MeView): void {
    me.value = next
    loggedIn.value = true
    consented.value = !next.consentRequired
  }

  /**
   * 主动刷新 Me（GET /me；mock 模式读 mock 年龄覆盖）。
   * 与 restore() 的区别：mock 模式也生效、不改变「未登录是否跳转」的既有语义，供年龄守卫/选择页用。
   */
  async function refreshMe(): Promise<MeView | null> {
    try {
      const next = await getMe()
      applyMe(next)
      return next
    } catch (e) {
      error.value = errorMessage(e)
      return null
    }
  }

  /**
   * 年龄门守卫（页面 onLoad 调用）：
   * - 还没有 Me 时先 GET /me（mock 读 mockMe）；null → need-age；lt14 → blocked；
   * - 字段缺失/旧服务端 → unknown（不拦截，以服务端实际错误为准）。
   * 不做合规判定、不自行决定能不能用；只决定是否先把学生送去选择页。
   */
  async function ensureAgeBand(): Promise<AgeGateDecision> {
    if (!me.value) await refreshMe()
    return ageGateFor(me.value?.ageBand)
  }

  /**
   * POST /auth/student/age-band：成功后 applyMe + 刷新一次 Me（以服务端为准），返回最新 Me。
   * 失败时抛出 ApiError（调用页按 code/errorMessage 展示；不伪造成功）。
   */
  async function submitAgeBand(band: AgeBand): Promise<MeView> {
    loading.value = true
    error.value = null
    try {
      const next = await setStudentAgeBand(band)
      applyMe(next)
      // 「成功后刷新 me 再继续原目标」：再 GET /me 一次，失败就沿用 POST 返回的 Me。
      const refreshed = await refreshMe()
      return refreshed ?? next
    } catch (e) {
      error.value = errorMessage(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function setPendingRoute(route: string): void {
    pendingRoute.value = route
  }

  function takePendingRoute(): string {
    const route = pendingRoute.value
    pendingRoute.value = ''
    return route
  }

  /** 刷新页面后恢复会话：GET /me；未登录返回 false（mock 模式没有服务端会话）。 */
  async function restore(): Promise<boolean> {
    if (isMockMode()) return false
    loading.value = true
    error.value = null
    try {
      const restored = await getMe()
      // 学生端只认学生身份：服务端若给出别的角色（旧服务端、配置错误），当作没有会话，留在登录页。
      if (restored.role !== 'student') {
        me.value = null
        loggedIn.value = false
        consented.value = false
        return false
      }
      me.value = restored
      loggedIn.value = true
      consented.value = !restored.consentRequired
      return true
    } catch {
      loggedIn.value = false
      return false
    } finally {
      loading.value = false
    }
  }

  /** POST /auth/student/login。返回是否登录成功；错误文案放在 error。 */
  async function login(invite: string, no: string): Promise<boolean> {
    inviteCode.value = invite
    studentNo.value = no
    if (!invite || !no) {
      loggedIn.value = false
      return false
    }
    loading.value = true
    error.value = null
    try {
      me.value = await apiLogin(invite, no)
      loggedIn.value = true
      consented.value = !me.value.consentRequired
      return true
    } catch (e) {
      loggedIn.value = false
      error.value = errorMessage(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /** POST /consents：提交五段选择；返回是否可以进入练习页。 */
  async function submitConsent(): Promise<boolean> {
    if (!requiredOk.value) return false
    loading.value = true
    error.value = null
    try {
      if (isMockMode()) {
        await mockSleep()
        consented.value = true
      } else {
        applyMe(await submitConsents(docVersion.value, choices()))
      }
      return consented.value
    } catch (e) {
      error.value = errorMessage(e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiLogout()
    } finally {
      me.value = null
      loggedIn.value = false
      consented.value = false
    }
  }

  return {
    items,
    docVersion,
    /** 兼容旧页面的名字：当前同意书版本。 */
    consentVersion: docVersion,
    signed,
    me,
    /** 年龄分档：null=尚未选择（#145 路由守卫会引导去选择页）。 */
    ageBand,
    pendingRoute,
    inviteCode,
    studentNo,
    loggedIn,
    consented,
    loading,
    error,
    requiredOk,
    loadConsentDoc,
    restore,
    login,
    submitConsent,
    logout,
    // #145：Me 刷新 / 年龄守卫 / 提交年龄分档 / 原目标交接
    refreshMe,
    ensureAgeBand,
    submitAgeBand,
    setPendingRoute,
    takePendingRoute,
  }
}

/** 测试隔离：恢复到初始状态（mock 文案、未登录）。 */
export function __resetSessionForTests(): void {
  lastAuthRedirectAt = 0
  items.value = toItems(mockConsentDoc)
  docVersion.value = mockConsentDoc.version
  signed.value = null
  me.value = null
  inviteCode.value = ''
  studentNo.value = ''
  loggedIn.value = false
  consented.value = false
  loading.value = false
  error.value = null
  pendingRoute.value = ''
}

export function maskStudentNo(no: string): string {
  const s = no || 'S-7K2Q9M'
  return s.slice(0, 4) + '-****'
}
