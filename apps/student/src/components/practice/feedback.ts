/**
 * 提交后的反馈：只比较前后两份服务端 state，算出该说什么。不判对错，不读学生写的内容（08 §8 AI 规则 3）。
 *
 * - 关键步骤多了一个 → 衔接上了（绿）；
 * - 这一行多了一条助教的问题 → 问题原样显示（蓝，不是判错）；
 * - 提示额度用多了 → 提示（金）；
 * - 其余只是记下了这一行（蓝，没有音效）。
 *
 * 测验模式什么都不返回：没有反馈面板、音效和奖励（01 §L3）。层变了不走这里，走 computeInterstitial。
 */
import { LAYER_DONE, LAYER_INTRO, layerName, layerNumber } from '@/copy'
import type { AttemptState, LayerId, Note, ProofLine, RewardsView } from '@/types/attempt'

export type FeedbackTone = 'ok' | 'sea' | 'bee'
export type FeedbackSfx = 'correct' | 'gentle-question' | 'hint'

export interface FeedbackView {
  tone: FeedbackTone
  title: string
  body: string
  sfx: FeedbackSfx | null
  /** 这次得到的经验；0 不显示。 */
  xp: number
  /** 反馈说的是哪一行（用来把这一行滚到面板上方）。 */
  lineId: string | null
}

export interface InterstitialView {
  from: LayerId
  to: LayerId
  did: string
  nextName: string
  nextIntro: string
  xp: number
}

function isTestMode(state: AttemptState): boolean {
  return state.mode === 'test' || state.integrity?.mode === 'test'
}

/** 同一次作答向前走了一步才算：换题、重连、第一次加载都不反馈。 */
function isStepForward(prev: AttemptState, next: AttemptState): boolean {
  return Boolean(prev.attemptId) && prev.attemptId === next.attemptId && next.stateVersion > prev.stateVersion
}

function newNotes(prev: AttemptState, next: AttemptState): Note[] {
  const seen = new Set((prev.notes ?? []).map((note) => note.noteId))
  return (next.notes ?? []).filter((note) => !seen.has(note.noteId))
}

function newLine(prev: AttemptState, next: AttemptState): ProofLine | null {
  const seen = new Set((prev.steps?.lines ?? []).map((line) => line.lineId))
  const added = (next.steps?.lines ?? []).filter((line) => !seen.has(line.lineId))
  return added.at(-1) ?? null
}

/** 第 1、2 层核对没通过：服务端说缺了什么，这里只把它搬上来。 */
function checkFeedback(prev: AttemptState, next: AttemptState): string | null {
  if (next.currentLayer === 'L1' && (next.def?.submissions ?? 0) > (prev.def?.submissions ?? 0)) return next.def?.feedback ?? null
  if (next.currentLayer === 'L2') {
    // 看通用骨架也会让版本前进，但不是一次核对。
    if (next.frame?.templateShown && !prev.frame?.templateShown) return null
    return next.frame?.feedback ?? null
  }
  return null
}

function keysSentence(next: AttemptState): string {
  const { keysOwn, keysTotal } = next.budget
  if (keysTotal > 0 && keysOwn >= keysTotal) return '关键步骤都写到了。'
  return '关键步骤 ' + keysOwn + '/' + keysTotal + '，接着写下一步。'
}

export function computeFeedback(prev: AttemptState, next: AttemptState, rewards: RewardsView | null = null): FeedbackView | null {
  if (isTestMode(next) || !isStepForward(prev, next)) return null
  if (next.status === 'completed' || next.currentLayer !== prev.currentLayer) return null
  const xp = rewards?.xp ?? 0

  const notes = newNotes(prev, next)
  const revealDelta = next.budget.revealUsed - prev.budget.revealUsed
  if (revealDelta > 0) {
    const hint = notes.find((note) => note.kind === 'hint')
    return {
      tone: 'bee',
      title: '提示来了 · 用掉 ' + revealDelta + ' 提示额度',
      body: hint?.text ?? '提示放在这一行下面了。',
      sfx: 'hint',
      xp: 0,
      lineId: hint?.lineId ?? null,
    }
  }

  const check = checkFeedback(prev, next)
  if (check) return { tone: 'sea', title: '再想想这一点', body: check, sfx: 'gentle-question', xp: 0, lineId: null }

  const line = newLine(prev, next)
  const keysGained = next.budget.keysOwn - prev.budget.keysOwn
  if (keysGained > 0) {
    const linked = notes.find((note) => note.kind === 'annotation' && note.lineId === line?.lineId)
    return {
      tone: 'ok',
      title: '衔接上了',
      body: linked?.text ?? keysSentence(next),
      sfx: 'correct',
      xp,
      lineId: line?.lineId ?? null,
    }
  }

  const summaryFollowup = next.summary?.followup && next.summary.followup !== prev.summary?.followup ? next.summary.followup : null
  if (summaryFollowup) return { tone: 'sea', title: '再补一句', body: summaryFollowup, sfx: 'gentle-question', xp: 0, lineId: null }

  const selfcheck = selfcheckChange(prev, next)
  if (selfcheck) return { ...selfcheck, xp }

  if (!line) return null
  const question = notes.find((note) => note.kind === 'annotation' && note.lineId === line.lineId)
  if (question) return { tone: 'sea', title: '助教想问', body: question.text, sfx: 'gentle-question', xp: 0, lineId: line.lineId }
  return { tone: 'sea', title: '记下了', body: '这一行放进证明了。接下来想写哪一步？', sfx: null, xp, lineId: line.lineId }
}

function selfcheckChange(prev: AttemptState, next: AttemptState): Omit<FeedbackView, 'xp'> | null {
  const before = new Map((prev.selfcheck?.items ?? []).map((item) => [item.itemId, item.status]))
  for (const item of next.selfcheck?.items ?? []) {
    if (item.status === before.get(item.itemId)) continue
    if (item.status === 'accepted') return { tone: 'ok', title: '答到点上了', body: '这一题过了，接着看下一题。', sfx: 'correct', lineId: null }
    if (item.status === 'followup') return { tone: 'sea', title: '再补一句', body: '再具体一点：这条依据是从哪一步、用什么运算得到的？', sfx: 'gentle-question', lineId: null }
  }
  return null
}

/** 一层做完（或跳过）后的过场。测验模式、完成页、换题的子作答都不出现。 */
export function computeInterstitial(prev: AttemptState, next: AttemptState, rewards: RewardsView | null = null): InterstitialView | null {
  if (isTestMode(next) || !isStepForward(prev, next)) return null
  if (next.status === 'completed' || next.kind === 'transfer') return null
  const from = prev.currentLayer
  const to = next.currentLayer
  if (!from || !to || from === to || layerNumber(to) < layerNumber(from)) return null
  const left = next.layers.find((layer) => layer.layer === from)
  const skipped = left?.status === 'skipped'
  return {
    from,
    to,
    did: skipped ? '这一层先跳过了，随时可以回头再看。' : LAYER_DONE[from],
    nextName: layerName(to),
    nextIntro: LAYER_INTRO[to],
    xp: rewards?.xp ?? 0,
  }
}
