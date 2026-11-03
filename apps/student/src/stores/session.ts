/**
 * 会话/登录/同意（P0 本地模拟；真实登录由 B 的 #18 提供后替换）。
 * 同意书五段口径见 13-合规与运营.md §2 与 10-开发文档/00-README M11。
 */
import { computed, ref } from 'vue'

export interface ConsentItem {
  id: string
  title: string
  required: boolean
  summary: string
  detail: string
  value: boolean
}

const CONSENT_ITEMS: ConsentItem[] = [
  { id: 'service', title: '服务所需', required: true, summary: '记录你的作答过程，才能给你分层提示和给老师看卡点。', detail: '我们会保存你的作答内容、提示领取记录与操作事件，用于提供练习服务与教师端过程查看。', value: true },
  { id: 'crossBorderHosting', title: '香港服务器存储', required: true, summary: '你的数据存放在中国香港的服务器上（目前部署方案）。', detail: '服务器位于中国香港，数据存储与处理均在境外；我们按最小必要原则收集，并设置访问控制与保留期限。', value: true },
  { id: 'monitoring', title: '过程监测', required: true, summary: '练习/测验期间会记录离开页面等过程信号，只提示老师，不自动处罚。', detail: '会记录页面可见性、全屏状态、复制粘贴等信号，作为诚信提示；是否处理由老师判断。', value: true },
  { id: 'crossBorderModel', title: '境外决策模型（可选）', required: false, summary: '可不同意；不同意时用规则化提示，不影响你做题。', detail: 'Jev 与部分模型服务位于境外，发送前会做去标识化处理；你可以随时关闭。', value: false },
  { id: 'research', title: '教研使用（可选）', required: false, summary: '可不同意；不同意不影响任何功能。', detail: '去标识化后的作答与事件可用于教学研究；不会公开你的身份信息。', value: false },
]

const inviteCode = ref('')
const studentNo = ref('')
const loggedIn = ref(false)
const consented = ref(false)
const consentVersion = ref('p0-v1')

export function useSession() {
  const requiredOk = computed(() => CONSENT_ITEMS.filter((i) => i.required).every((i) => i.value))
  function login(invite: string, no: string) {
    inviteCode.value = invite
    studentNo.value = no
    loggedIn.value = Boolean(invite && no)
    return loggedIn.value
  }
  function submitConsent() {
    if (!requiredOk.value) return false
    consented.value = true
    return true
  }
  return { items: CONSENT_ITEMS, inviteCode, studentNo, loggedIn, consented, consentVersion, requiredOk, login, submitConsent }
}

export function maskStudentNo(no: string): string {
  const s = no || 'S-7K2Q9M'
  return s.slice(0, 4) + '-****'
}
