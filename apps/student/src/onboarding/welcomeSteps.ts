/** 欢迎页的三屏顺序（纯函数）。 */
export type WelcomeStep = 'name' | 'goal' | 'input'

const ORDER: readonly WelcomeStep[] = ['name', 'goal', 'input']

/** 下一屏；最后一屏之后没有下一屏（返回 null，调用方保存并庆祝）。 */
export function nextWelcomeStep(step: WelcomeStep): WelcomeStep | null {
  return ORDER[ORDER.indexOf(step) + 1] ?? null
}

export function previousWelcomeStep(step: WelcomeStep): WelcomeStep | null {
  return ORDER[ORDER.indexOf(step) - 1] ?? null
}
