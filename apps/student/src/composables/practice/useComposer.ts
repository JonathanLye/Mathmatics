/**
 * 写下一行的输入器（#15/#21/#25）：一个入口、一个面板，手写 / 键盘 / 拍照切换，三个方式共用「这一行」和「依据」。
 * 识别结果只是候选，学生确认后才进入提交；来源（provenance）随提交带给服务端。
 * 学生写的内容在这里，切方式、识别失败都不丢。
 */
import { computed, ref } from 'vue'
import {
  addLine,
  confirmRecognition,
  editLine,
  fetchSettings,
  isMockMode,
  photoRecognitionErrorMessage,
  recognizeInk,
  recognizePhoto,
  updateSettings,
} from '@/api/client'
import { isApiError } from '@/api/http'
import { buildLineDraft } from '@/components/lineDrafts'
import {
  photoFailureOf,
  photoFailureOfResult,
  withRecognitionTimeout,
  type RecognitionFailure,
} from '@/components/practice/recognitionFailure'
import { useToast } from '@/components/ui/useToast'
import { uuidv7 } from '@/integrity/ids'
import { compressImage, loadImageBlobFromPath } from '@/utils/imageCompress'
import type { LineDraft, ProofLine, Recognition, SettingsView } from '@/types/attempt'
import type { AttemptSession } from './useAttemptSession'
import type { DraftsHandle } from './useDrafts'

export type ComposerTab = SettingsView['defaultInput']
export type PhotoSource = 'camera' | 'album'

/**
 * H5 选图：优先 uni.chooseImage（返回 tempFilePath）；若运行环境未注册该 API（本构建的 H5 运行时按需注册），
 * 退回原生 <input type=file>（返回 File）。两条路都支持相机/相册：camera 带 capture=environment。
 * 取消选择返回 null（不弹错误）。
 */
function pickImageWithDomInput(source: PhotoSource): Promise<File | null> {
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

function choosePhotoFile(source: PhotoSource): Promise<File | string | null> {
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

export function useComposer(session: Pick<AttemptSession, 'state' | 'error' | 'apply' | 'run' | 'busy'>, drafts: DraftsHandle) {
  const { state, error, apply, run, busy } = session
  const toast = useToast()

  const editorOpen = ref(false)
  const tab = ref<ComposerTab>('keyboard')
  /** 正在改已有的一行；null 是写新的一行。 */
  const editingLine = ref<ProofLine | null>(null)
  /** 三种方式共用：切方式、识别失败都不丢。 */
  const statement = ref('')
  const justification = ref('')
  /** 一个落点一个 draftId（03 §1）：打开时生成，打开期间的重试复用，重新打开才换新。 */
  let statementDraftId = ''
  let justificationDraftId = ''

  /** 识别结果确认后的来源：文字不改就按这个来源提交。 */
  const recogDraft = ref<{ text: string; recogId: string; source: 'ink' | 'photo'; draftId?: string } | null>(null)
  const recogBusy = ref(false)
  const recognition = ref<Recognition | null>(null)
  const recogSource = ref<'ink' | 'photo'>('photo')
  /** 识别中的文案（拍照：打开相机 → 压缩 → 识别）。 */
  const photoProgress = ref('')
  /** 正在把选中的行加入证明。 */
  const photoAdding = ref(false)
  /** 拍照没拿到结果：显示说明和出口，不显示原始报错。 */
  const photoFailure = ref<RecognitionFailure | null>(null)
  /** 手写没认出来时的一句话。 */
  const inkFailure = ref('')
  const inkValue = ref('')
  /** 手写：识别请求与随后提交这一行复用同一个 draftId（03 §1）。 */
  let inkDraftId = ''
  /** 最近一次压缩后的图片：重新识别时复用（不重拍、不再压缩）。 */
  let lastPhoto: { image: Blob; source: PhotoSource } | null = null
  /** 取消/重开时忽略在途识别结果。 */
  let recogSeq = 0

  let settingsLoaded = false
  let tabChosen = false

  const canSubmit = computed(() => statement.value.trim().length > 0 && !busy.value)
  /** 手写：有识别结果要核对。 */
  const inkConfirming = computed(() => recogSource.value === 'ink' && Boolean(recognition.value))
  /** 拍照：有识别结果要逐行确认。 */
  const photoConfirming = computed(() => recogSource.value === 'photo' && Boolean(recognition.value))

  /** 打开页面时读一次设置里的默认输入方式；读不到就用键盘，不打扰学生。 */
  async function loadDefaultInput(): Promise<void> {
    if (settingsLoaded) return
    settingsLoaded = true
    try {
      const settings = await fetchSettings()
      if (!tabChosen && settings.defaultInput) tab.value = settings.defaultInput
    } catch {
      /* 设置读不到不影响写证明 */
    }
  }

  /** 学生切方式：记下来，下次打开就是它。写不进去也不影响这一次。 */
  function chooseTab(next: ComposerTab): void {
    tabChosen = true
    if (tab.value === next) return
    tab.value = next
    updateSettings({ defaultInput: next }).catch(() => undefined)
  }

  function freshDraftIds(): void {
    statementDraftId = uuidv7()
    justificationDraftId = uuidv7()
    inkDraftId = uuidv7()
  }

  function resetRecognition(): void {
    recogSeq += 1
    recognition.value = null
    recogBusy.value = false
    photoProgress.value = ''
    photoFailure.value = null
    inkFailure.value = ''
  }

  /** 写下一行：恢复本机草稿（#27）。测验模式下不可能落在拍照上。 */
  function openComposer(): void {
    if (busy.value) return
    editingLine.value = null
    statement.value = recogDraft.value?.text ?? drafts.lineDraftInitial.value.statement
    justification.value = drafts.lineDraftInitial.value.justification
    inkValue.value = ''
    resetRecognition()
    freshDraftIds()
    if (tab.value === 'photo' && state.value.integrity.mode === 'test') tab.value = 'keyboard'
    editorOpen.value = true
  }

  /** 改已有的一行：只用键盘，提交走 PATCH。 */
  function openEdit(line: ProofLine): void {
    if (busy.value) return
    editingLine.value = line
    statement.value = line.statement
    justification.value = line.justification ?? ''
    recogDraft.value = null
    resetRecognition()
    freshDraftIds()
    editorOpen.value = true
  }

  function closeComposer(): void {
    if (busy.value) return
    resetRecognition()
    editorOpen.value = false
  }

  /** #27：输入变化写本机草稿（父级防抖）。改已有的行不写草稿：原文还在服务端。 */
  function saveDraft(): void {
    if (!editorOpen.value || editingLine.value) return
    drafts.saveLine({ statement: statement.value, justification: justification.value })
  }

  /** 手写确认过的文字原样提交 → 来源记为 ink（带 recogId）；改过就按键盘（学生已经自己动了笔）。 */
  function withRecogProvenance(draft: LineDraft): LineDraft {
    const rd = recogDraft.value
    if (!rd || !rd.recogId) return draft
    if (draft.statement.trim() !== rd.text.trim()) return draft
    return { ...draft, input: { provenance: rd.source, draftId: rd.draftId || draft.input.draftId, recogId: rd.recogId } }
  }

  async function submit(): Promise<void> {
    if (!canSubmit.value) return
    const attemptId = state.value.attemptId
    const editing = editingLine.value
    const draft = withRecogProvenance(
      buildLineDraft({
        statement: statement.value,
        justification: justification.value,
        statementDraftId,
        justificationDraftId,
        provenance: 'keyboard',
      }),
    )
    const next = await run(() => (editing ? editLine(state.value, editing.lineId, draft) : addLine(state.value, draft)))
    if (next) {
      apply(next)
      editorOpen.value = false
      editingLine.value = null
      recogDraft.value = null
      statement.value = ''
      justification.value = ''
      // #27：成功后清除这一行的本机草稿（失败时保留，便于重试）。
      if (!editing) await drafts.clearLine(attemptId)
    } else {
      // 失败不关面板：内容与 draftId 保留，重试复用（PR #90 复审建议）。
      toast.show(error.value || '这一行没加进去，再试一次；你写的内容还在')
    }
  }

  /** 手写：重写这一行（清掉识别填进来的文字，回到画布）。 */
  function rewriteInk(): void {
    resetRecognition()
    statement.value = ''
    recogDraft.value = null
    inkValue.value = ''
    inkDraftId = uuidv7()
  }

  /** 「写完这一行」：InkCanvas 给出 gzip(ink-v1) 的 base64，调 /recognitions/ink，结果在面板里核对。 */
  async function finishInk(base64: string): Promise<void> {
    if (!base64) return
    const seq = ++recogSeq
    recogSource.value = 'ink'
    recogBusy.value = true
    recognition.value = null
    inkFailure.value = ''
    photoProgress.value = '正在识别这一行…'
    try {
      const result = await withRecognitionTimeout(
        recognizeInk({
          attemptId: state.value.attemptId,
          draftId: inkDraftId || uuidv7(),
          target: 'line_statement',
          ink: base64,
        }),
      )
      if (seq !== recogSeq) return
      if (result.status === 'empty' || !result.text) {
        inkFailure.value = '没有认出内容，再写一次，或者用键盘'
        return
      }
      recognition.value = result
    } catch (err) {
      if (seq !== recogSeq) return
      inkFailure.value = inkRecognitionErrorMessage(err)
    } finally {
      if (seq === recogSeq) {
        recogBusy.value = false
        photoProgress.value = ''
      }
    }
  }

  /** 识别一张压缩好的图片（首次和「再试一次」共用）：失败只进 photoFailure，学生写的内容不动。 */
  async function recognizePhotoBlob(image: Blob, source: PhotoSource, seq = ++recogSeq): Promise<void> {
    recogSource.value = 'photo'
    recogBusy.value = true
    recognition.value = null
    photoFailure.value = null
    photoProgress.value = '正在识别…'
    try {
      const result = await withRecognitionTimeout(
        recognizePhoto({
          attemptId: state.value.attemptId,
          draftId: uuidv7(),
          target: 'line_statement',
          source,
          image,
        }),
      )
      if (seq !== recogSeq) return
      const failure = photoFailureOfResult(result)
      if (failure) photoFailure.value = failure
      else recognition.value = result
    } catch (err) {
      if (seq !== recogSeq) return
      photoFailure.value = photoFailureOf(err)
    } finally {
      if (seq === recogSeq) {
        recogBusy.value = false
        photoProgress.value = ''
      }
    }
  }

  /**
   * #25 拍照识别：选择图片 → 压缩（长边≤2000/≤2MB/去 EXIF）→ POST /recognitions/photo → 逐行确认。
   * 测验模式 photo 已禁用；取消选择不提示错误；取消/重新打开时用 recogSeq 忽略在途结果。
   */
  async function startPhoto(source: PhotoSource = 'camera'): Promise<void> {
    if (recogBusy.value) return
    if (state.value.integrity.mode === 'test') {
      toast.show('测验模式下拍照不可用')
      return
    }
    const seq = ++recogSeq
    recogSource.value = 'photo'
    recogBusy.value = true
    recognition.value = null
    photoFailure.value = null
    photoProgress.value = source === 'camera' ? '正在打开相机…' : '正在打开相册…'
    try {
      const picked = await choosePhotoFile(source)
      if (seq !== recogSeq) return
      if (!picked) {
        cancelRecognition()
        return
      }
      photoProgress.value = '正在压缩图片…'
      const sourceBlob = typeof picked === 'string' ? await loadImageBlobFromPath(picked) : picked
      const compressed = await compressImage(sourceBlob, { maxEdge: 2000, maxBytes: 2 * 1024 * 1024 })
      if (seq !== recogSeq) return
      lastPhoto = { image: compressed.blob, source }
      await recognizePhotoBlob(compressed.blob, source, seq)
    } catch (err) {
      if (seq !== recogSeq) return
      photoFailure.value = photoFailureOf(err)
      recogBusy.value = false
      photoProgress.value = ''
    }
  }

  /** 「再试一次」：有上一张照片就直接再识别（不重拍），服务恢复后马上能用。 */
  function retryPhoto(): void {
    if (recogBusy.value) return
    const previous = lastPhoto
    if (previous) void recognizePhotoBlob(previous.image, previous.source)
    else void startPhoto()
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
          toast.show(error.value || '这一行没加进去，再试一次')
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
        editorOpen.value = false
      }
      toast.show('已加入 ' + added.length + ' 行')
    } finally {
      photoAdding.value = false
      recogBusy.value = false
    }
  }

  /** 忽略整次拍照识别：回到拍照这一屏，学生写的内容不动。 */
  function ignoreRecognition(): void {
    recogSeq += 1
    recognition.value = null
    photoFailure.value = null
  }

  /** 确认手写结果：填进「这一行」，补上依据后加入证明；文字不改就按手写来源提交。 */
  async function confirmRecognized(text: string): Promise<void> {
    const current = recognition.value
    const recogId = current?.recogId ?? ''
    if (current && !isMockMode()) {
      // 先 confirm，之后才能以手写来源提交（服务端核对提交文字与确认文字一致）。失败则留在核对这一步，学生可重试。
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
    recognition.value = null
    statement.value = text
    recogDraft.value = { text, recogId, source: 'ink', draftId: inkDraftId }
    saveDraft()
  }

  /** 核对时点「放弃重写」「重新识别」：回到画布再写一遍（不重复识别同一份笔迹）。 */
  function discardRecognition(): void {
    rewriteInk()
  }

  function cancelRecognition(): void {
    recogSeq += 1
    recognition.value = null
    recogBusy.value = false
    photoProgress.value = ''
  }

  /** 切换 mock 状态时收起面板。 */
  function reset(): void {
    resetRecognition()
    editorOpen.value = false
    editingLine.value = null
    recogDraft.value = null
    statement.value = ''
    justification.value = ''
  }

  return {
    editorOpen,
    tab,
    editingLine,
    statement,
    justification,
    canSubmit,
    recogBusy,
    recognition,
    recogSource,
    inkConfirming,
    photoConfirming,
    photoProgress,
    photoAdding,
    photoFailure,
    inkFailure,
    inkValue,
    loadDefaultInput,
    chooseTab,
    openComposer,
    openEdit,
    closeComposer,
    saveDraft,
    submit,
    rewriteInk,
    finishInk,
    recognizePhotoBlob,
    startPhoto,
    retryPhoto,
    addPhotoLines,
    ignoreRecognition,
    confirmRecognized,
    discardRecognition,
    cancelRecognition,
    reset,
  }
}

export type ComposerHandle = ReturnType<typeof useComposer>
