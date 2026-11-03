/**
 * 会话/登录/同意（issue #24：真实接口；mock 模式保留本地 fallback）。
 *
 * - 登录：POST /auth/student/login（#18 已完成），响应设置 HttpOnly Cookie，返回 Me；
 * - 同意书：GET /consents 取服务端文本与本人签署状态，POST /consents 提交 {version, items}；
 *   必选三段（service / crossBorderHosting / monitoring）未同意时不允许开始练习（13 §2）。
 * - 页面只渲染本 store；不在前端判断是否需要同意（以 Me.consentRequired 为准）。
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
  submitConsents,
} from '@/api/client'
import type { ConsentChoices, ConsentDoc, ConsentKey, MeView } from '@/types/attempt'

export interface ConsentItem {
  id: ConsentKey
  title: string
  required: boolean
  summary: string
  detail: string
  value: boolean
}

function toItems(doc: ConsentDoc): ConsentItem[] {
  return doc.sections.map((section) => {
    const signedValue = doc.signed?.items?.[section.key]
    return {
      id: section.key,
      title: section.title,
      required: section.required,
      summary: section.body,
      detail: section.body,
      // 必选项目前固定开（UI 不允许取消）；可选项恢复本人上次签署的值。
      value: section.required ? true : signedValue === true,
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
  for (const item of items.value) result[item.id] = item.value
  return result
}

const requiredOk = computed(() => items.value.filter((item) => item.required).every((item) => item.value))

const mockSleep = (ms = 80) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

  /** 刷新页面后恢复会话：GET /me；未登录返回 false（mock 模式没有服务端会话）。 */
  async function restore(): Promise<boolean> {
    if (isMockMode()) return false
    loading.value = true
    error.value = null
    try {
      me.value = await getMe()
      loggedIn.value = true
      consented.value = !me.value.consentRequired
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
        me.value = await submitConsents(docVersion.value, choices())
        consented.value = !me.value.consentRequired
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
  }
}

/** 测试隔离：恢复到初始状态（mock 文案、未登录）。 */
export function __resetSessionForTests(): void {
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
}

export function maskStudentNo(no: string): string {
  const s = no || 'S-7K2Q9M'
  return s.slice(0, 4) + '-****'
}
