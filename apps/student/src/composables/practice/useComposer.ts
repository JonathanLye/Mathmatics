/**
 * 写证明的输入：行编辑器、手写、拍照识别的开关与流程（#15/#21/#25）。
 * 识别结果只是候选，学生确认后才进入提交；来源（provenance）随提交带给服务端。
 */
import { computed, ref } from 'vue'
import {
  addLine,
  confirmRecognition,
  isMockMode,
  photoRecognitionErrorMessage,
  recognizeInk,
  recognizePhoto,
} from '@/api/client'
import { isApiError } from '@/api/http'
import { useToast } from '@/components/ui/useToast'
import { uuidv7 } from '@/integrity/ids'
import { compressImage, loadImageBlobFromPath } from '@/utils/imageCompress'
import type { LineDraft, Recognition } from '@/types/attempt'
import type { AttemptSession } from './useAttemptSession'
import type { DraftsHandle } from './useDrafts'

/**
 * H5 选图：优先 uni.chooseImage（返回 tempFilePath）；若运行环境未注册该 API（本构建的 H5 运行时按需注册），
 * 退回原生 <input type=file>（返回 File）。两条路都支持相机/相册：camera 带 capture=environment。
 * 取消选择返回 null（不弹错误）。
 */
function pickImageWithDomInput(source: 'camera' | 'album'): Promise<File | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不支持拍照，请用键盘或手写'))
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (source === 'camera') input.setAttribute('capture', 'environment')
    input.setAttribute('data-testid', 'photo-file-input')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.opacity = '0'
    document.body.appendChild(input)
    let settled = false
    const cleanup = (): void => {
      if (input.parentNode) input.parentNode.removeChild(input)
    }
    input.addEventListener('change', () => {
      if (settled) return
      settled = true
      const file = input.files && input.files[0] ? input.files[0] : null
      cleanup()
      resolve(file)
    })
    input.addEventListener('cancel', () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    })
    input.click()
  })
}

function choosePhotoFile(source: 'camera' | 'album'): Promise<File | string | null> {
  const uniApi = (typeof uni !== 'undefined' ? uni : undefined) as
    | { chooseImage?: (options: Record<string, unknown>) => void }
    | undefined
  if (typeof uniApi?.chooseImage !== 'function') {
    return pickImageWithDomInput(source)
  }
  return new Promise((resolve, reject) => {
    uniApi.chooseImage?.({
      count: 1,
      sizeType: ['compressed'],
      sourceType: [source],
      success: (result: { tempFilePaths?: string[] }) => {
        const path = result?.tempFilePaths?.[0]
        resolve(typeof path === 'string' && path.length > 0 ? path : null)
      },
      fail: (error: { errMsg?: string } | undefined) => {
        const message = String(error?.errMsg ?? error ?? '')
        if (/cancel/i.test(message)) {
          resolve(null)
          return
        }
        reject(new Error(message || '选择图片失败'))
      },
    })
  })
}

/** 手写识别错误 → 学生可读文案（真实服务端语义；不暗示对错，给出键盘兜底）。 */
export function inkRecognitionErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    if (err.code === 'RATE_LIMITED' || err.status === 429) {
      return err.message.trim() === '' ? '识别太频繁或今天的次数用完了，可以先用键盘' : err.message
    }
    if (err.code === 'UPSTREAM_UNAVAILABLE' || err.status === 503) return '没认出来，再写一次，或者用键盘'
    if (err.code === 'PAYLOAD_TOO_LARGE' || err.status === 413) return '这一行写得太满了，分两行写或用键盘'
    if (err.status === 404 || err.code === 'NOT_FOUND') return '识别记录或作答不存在，请重新手写或改用键盘'
    if (err.code === 'CONSENT_REQUIRED') return '请先阅读并签署知情同意书，再使用手写识别'
    if (err.code === 'AGE_BAND_REQUIRED') return '请先选择年龄段，再使用手写识别'
    if (err.code === 'AGE_RESTRICTED') return '本服务暂未向 14 岁以下学生开放'
    if (err.code === 'FORBIDDEN') return '当前账号不能使用手写识别，请用键盘'
    if (err.code === 'ATTEMPT_LOCKED') return '本题已锁定，请联系老师'
    if (err.code === 'RECOG_NOT_CONFIRMED') return '识别结果还没确认，请先确认再加入'
    if (err.code === 'VALIDATION_FAILED') return '手写数据无效，请重新写一次或用键盘'
    if (err.code === 'NETWORK' || err.status === 0) return '网络不稳定，手写识别暂不可用；可以稍后重试或用键盘'
  }
  return '手写识别暂不可用，请用键盘'
}

export function useComposer(session: Pick<AttemptSession, 'state' | 'error' | 'apply' | 'run'>, drafts: DraftsHandle) {
  const { state, error, apply, run } = session
  const toast = useToast()

  const editorOpen = ref(false)
  /** #15 拍照识别确认：识别中 → 确认面板；确认后的文本进入「草稿」并回填行编辑器 */
  const recogOpen = ref(false)
  const recogBusy = ref(false)
  const recognition = ref<Recognition | null>(null)
  const recogDraft = ref<{ text: string; recogId: string; at: string; source?: 'ink' | 'photo'; draftId?: string } | null>(null)
  /** #21 手写：全屏手写面板（InkCanvas）；写完一行 → /recognitions/ink → 确认卡 → 确认 → 行编辑器 → 以 ink 来源提交。 */
  const inkOpen = ref(false)
  const inkValue = ref('')
  /** 本次识别结果的来源：手写（单行确认卡）或拍照（逐行面板）；影响加载文案与「重写」行为。 */
  const recogSource = ref<'ink' | 'photo'>('photo')
  /** 一行一个 draftId（03 §1）：识别请求与随后提交这一行复用同一个。 */
  let inkDraftId = ''
  /** #25 拍照：压缩/识别进度文案；photoAdding=正在把选中的行加入证明。 */
  const photoProgress = ref('')
  const photoAdding = ref(false)
  /** 本次识别结果是否进入「逐行确认」面板（整页拍照；即便加到只剩 1 行也保持该面板，不回退到单行卡）。 */
  const photoPanelActive = ref(false)
  /** 最近一次压缩后的图片：重新识别时复用（不重拍、不再压缩）。 */
  let lastPhoto: { image: Blob; source: 'camera' | 'album' } | null = null
  /** 取消/重开时忽略在途识别结果。 */
  let recogSeq = 0

  /** #27：打开行编辑器时的初始值 —— 识别确认的文本优先（#15 行为），否则用本机未提交草稿。 */
  const editorInitialStatement = computed(() => recogDraft.value?.text ?? drafts.lineDraftInitial.value.statement)
  const editorInitialJustification = computed(() => drafts.lineDraftInitial.value.justification)

  /** 手写确认过的文字原样提交 → 来源记为 ink（带 recogId）；改过就按键盘（学生已经自己动了笔）。 */
  function withInkProvenance(draft: LineDraft): LineDraft {
    const rd = recogDraft.value
    if (!rd || rd.source !== 'ink' || !rd.recogId) return draft
    if (draft.statement.trim() !== rd.text.trim()) return draft
    return { ...draft, input: { provenance: 'ink', draftId: rd.draftId || draft.input.draftId, recogId: rd.recogId } }
  }

  async function submitLine(draft: LineDraft): Promise<void> {
    const attemptId = state.value.attemptId
    const toSend = withInkProvenance(draft)
    const next = await run(() => addLine(state.value, toSend))
    if (next) {
      apply(next)
      editorOpen.value = false
      recogDraft.value = null
      // #27：加行成功后清除这一行的本机草稿（失败时保留，便于重试）。
      await drafts.clearLine(attemptId)
    } else {
      // 失败不关编辑器：本地草稿与 draftId 保留，重试复用（PR #90 复审建议）。
      toast.show(error.value || '加入证明失败，请重试；你写的内容还在编辑器里')
    }
  }

  function openInkSheet(): void {
    inkValue.value = ''
    inkDraftId = uuidv7()
    inkOpen.value = true
  }

  function startInk(): void {
    // 手写与拍照一样用于第 3 层写证明行（其他层的输入框先用键盘）。
    if (state.value.currentLayer !== 'L3') {
      toast.show('手写用于第 3 层写证明行；这一层先用键盘')
      return
    }
    if (recogBusy.value) return
    openInkSheet()
  }

  function cancelInk(): void {
    inkOpen.value = false
  }

  /** 「写完这一行」：InkCanvas 给出 gzip(ink-v1) 的 base64，调 /recognitions/ink，结果进确认卡。 */
  async function finishInk(base64: string): Promise<void> {
    inkOpen.value = false
    if (!base64) return
    const seq = ++recogSeq
    recogSource.value = 'ink'
    recogBusy.value = true
    recogOpen.value = true
    recognition.value = null
    photoPanelActive.value = false
    photoProgress.value = '正在识别这一行…'
    try {
      const result = await recognizeInk({
        attemptId: state.value.attemptId,
        draftId: inkDraftId || uuidv7(),
        target: 'line_statement',
        ink: base64,
      })
      if (seq !== recogSeq) return
      if (result.status === 'empty' || !result.text) {
        recogOpen.value = false
        toast.show('没有识别到内容，请再写一次，或者用键盘')
        return
      }
      recognition.value = result
      recogOpen.value = false
    } catch (err) {
      if (seq !== recogSeq) return
      recogOpen.value = false
      toast.show(inkRecognitionErrorMessage(err))
    } finally {
      if (seq === recogSeq) {
        recogBusy.value = false
        photoProgress.value = ''
      }
    }
  }

  function openKeyboardEditor(): void {
    editorOpen.value = true
  }

  /**
   * #25 拍照识别：选择图片 → 压缩（长边≤2000/≤2MB/去 EXIF）→ POST /recognitions/photo → 逐行确认。
   * - 真实后端已上线；404 表示作答/识别记录不存在，提示重新拍照或改用键盘，不伪造结果；
   * - 测验模式 photo 已禁用；取消选择不提示错误；
   * - 取消/重新打开时用 recogSeq 忽略在途结果。
   */
  async function startPhoto(): Promise<void> {
    if (recogBusy.value) return
    if (state.value.integrity.mode === 'test') {
      toast.show('测验模式下拍照不可用')
      return
    }
    // 拍照识别用于整页切行后加入第 3 层证明行（复用 addLine；其他层没有行列表落点）。
    if (state.value.currentLayer !== 'L3') {
      toast.show('拍照识别用于第 3 层写证明行；请先完成前两层')
      return
    }
    const seq = ++recogSeq
    recogSource.value = 'photo'
    recogBusy.value = true
    recogOpen.value = true
    recognition.value = null
    photoPanelActive.value = false
    photoProgress.value = '正在打开相机…'
    try {
      const picked = await choosePhotoFile('camera')
      if (seq !== recogSeq) return
      if (!picked) {
        closeRecogLoading()
        return
      }
      photoProgress.value = '正在压缩图片…'
      const sourceBlob = typeof picked === 'string' ? await loadImageBlobFromPath(picked) : picked
      const compressed = await compressImage(sourceBlob, { maxEdge: 2000, maxBytes: 2 * 1024 * 1024 })
      if (seq !== recogSeq) return
      lastPhoto = { image: compressed.blob, source: 'camera' }
      photoProgress.value = '正在识别…'
      const result = await recognizePhoto({
        attemptId: state.value.attemptId,
        draftId: uuidv7(),
        target: 'line_statement',
        source: 'camera',
        image: compressed.blob,
      })
      if (seq !== recogSeq) return
      recognition.value = result
      photoPanelActive.value = true
      recogOpen.value = false
    } catch (err) {
      if (seq !== recogSeq) return
      recogOpen.value = false
      toast.show(photoRecognitionErrorMessage(err))
    } finally {
      if (seq === recogSeq) {
        recogBusy.value = false
        photoProgress.value = ''
      }
    }
  }

  /** 逐行确认面板：加入勾选行/单行 → 走既有 addLine（provenance=photo + recogId）→ 调 confirm。 */
  async function addPhotoLines(payload: { texts: string[]; indices: number[] }): Promise<void> {
    const current = recognition.value
    if (!current || photoAdding.value) return
    if (payload.texts.length === 0) {
      toast.show('没有可加入的行')
      return
    }
    photoAdding.value = true
    recogBusy.value = true
    const recogId = current.recogId
    const added: string[] = []
    try {
      // 03 §3.2：只有确认过的识别结果才能用于提交——先 confirm（服务端记下确认的各行），再逐行加入。
      const toAdd = payload.texts.map((text) => text.trim()).filter((text) => text !== '')
      try {
        await confirmRecognition(recogId, toAdd.join('\n'), toAdd)
      } catch (err) {
        toast.show(photoRecognitionErrorMessage(err))
        return
      }
      for (const trimmed of toAdd) {
        const draft: LineDraft = {
          statement: trimmed,
          input: { provenance: 'photo', draftId: uuidv7(), recogId },
        }
        const next = await run(() => addLine(state.value, draft))
        if (!next) {
          toast.show(error.value || '加入行失败，请重试')
          return
        }
        apply(next)
        added.push(trimmed)
      }
      if (added.length === 0) {
        toast.show('没有可加入的行')
        return
      }
      const remainingLines = (current.lines ?? []).filter((_, index) => !payload.indices.includes(index))
      if (remainingLines.length > 0) {
        recognition.value = {
          ...current,
          lines: remainingLines,
          text: remainingLines.map((line) => line.text).join('\n'),
        }
      } else {
        recognition.value = null
        photoPanelActive.value = false
      }
      toast.show('已加入 ' + added.length + ' 行（拍照识别）')
    } finally {
      photoAdding.value = false
      recogBusy.value = false
    }
  }

  /** 忽略整次拍照识别。 */
  function ignoreRecognition(): void {
    recogSeq += 1
    recognition.value = null
    photoPanelActive.value = false
    recogOpen.value = false
    toast.show('已忽略这次拍照识别，可以继续写')
  }

  /** 「重新识别」：单行结果（#15 卡）重新跑一次；多行面板暂不提供重识别按钮。 */
  async function rewriteRecognition(): Promise<void> {
    if (recogSource.value === 'ink') {
      // 手写：放弃这次结果，回到画布重写一遍（不重复识别同一份笔迹）。
      recogSeq += 1
      recognition.value = null
      recogOpen.value = false
      recogBusy.value = false
      openInkSheet()
      return
    }
    // 拍照：丢弃当前结果并重新走 /recognitions/photo；有压缩图时复用（不再重拍/压缩），
    // 没有压缩图则重新打开拍照选择。绝不能调用 recognizeInk（那会把照片当手写发）。
    recogSeq += 1
    recognition.value = null
    photoPanelActive.value = false
    recogOpen.value = false
    recogBusy.value = false
    const previous = lastPhoto
    if (previous === null) {
      void startPhoto()
      return
    }
    const retrySeq = recogSeq
    recogSource.value = 'photo'
    recogBusy.value = true
    recogOpen.value = true
    photoProgress.value = '正在重新识别…'
    try {
      const result = await recognizePhoto({
        attemptId: state.value.attemptId,
        draftId: uuidv7(),
        target: 'line_statement',
        source: previous.source,
        image: previous.image,
      })
      if (retrySeq !== recogSeq) return
      recognition.value = result
      photoPanelActive.value = true
      recogOpen.value = false
    } catch (err) {
      if (retrySeq !== recogSeq) return
      recogOpen.value = false
      toast.show(photoRecognitionErrorMessage(err))
    } finally {
      if (retrySeq === recogSeq) {
        recogBusy.value = false
        photoProgress.value = ''
      }
    }
  }

  /** 确认加入：识别结果进入草稿（mock 下页面能看到结果文本），并回填行编辑器 */
  async function confirmRecognized(text: string): Promise<void> {
    const current = recognition.value
    const recogId = current?.recogId ?? ''
    const fromInk = recogSource.value === 'ink'
    if (fromInk && current && !isMockMode()) {
      // 先 confirm，之后才能以手写来源提交（服务端核对提交文字与确认文字一致）。失败则留在确认卡里，学生可重试。
      recogBusy.value = true
      try {
        await confirmRecognition(recogId, text)
      } catch (err) {
        toast.show(inkRecognitionErrorMessage(err))
        return
      } finally {
        recogBusy.value = false
      }
    }
    photoPanelActive.value = false
    recogOpen.value = false
    recognition.value = null
    recogDraft.value = {
      text,
      recogId,
      at: new Date().toISOString(),
      source: fromInk ? 'ink' : 'photo',
      draftId: fromInk ? inkDraftId : undefined,
    }
    if (fromInk) {
      // 手写确认后直接进行编辑器：补依据后提交；文字不改则按 ink 来源提交。
      editorOpen.value = true
      toast.show('已确认，补上依据后加入证明')
    } else {
      toast.show('识别结果已放入草稿，继续写这一行')
    }
  }

  /** 放弃重写：关掉面板，不采用这次识别 */
  function discardRecognition(): void {
    recogOpen.value = false
    recognition.value = null
    toast.show('已放弃这次识别，可以重新写')
  }

  function closeRecogLoading(): void {
    recogSeq += 1
    recogOpen.value = false
    recognition.value = null
    recogBusy.value = false
    photoProgress.value = ''
  }

  function clearRecogDraft(): void {
    recogDraft.value = null
  }

  /** 切换 mock 状态时收起编辑器。 */
  function reset(): void {
    editorOpen.value = false
  }

  return {
    editorOpen,
    recogOpen,
    recogBusy,
    recognition,
    recogDraft,
    inkOpen,
    inkValue,
    recogSource,
    photoProgress,
    photoAdding,
    photoPanelActive,
    editorInitialStatement,
    editorInitialJustification,
    submitLine,
    startInk,
    cancelInk,
    finishInk,
    openKeyboardEditor,
    startPhoto,
    addPhotoLines,
    ignoreRecognition,
    rewriteRecognition,
    confirmRecognized,
    discardRecognition,
    closeRecogLoading,
    clearRecogDraft,
    reset,
  }
}

export type ComposerHandle = ReturnType<typeof useComposer>
