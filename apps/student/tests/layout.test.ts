import { describe, expect, it } from 'vitest'
import { layoutModeOf } from '@/composables/useViewport'

// #10 DoD：390/768/1280 三档布局；阈值 02 §3（<600 手机 / 600–1023 平板 / ≥1024 桌面）。
describe('三档布局阈值（issue #10）', () => {
  it.each([
    [320, 'mobile'], [390, 'mobile'], [599, 'mobile'],
    [600, 'tablet'], [768, 'tablet'], [1023, 'tablet'],
    [1024, 'desktop'], [1280, 'desktop'], [1920, 'desktop'],
  ])('%i → %s', (px, want) => {
    expect(layoutModeOf(px)).toBe(want)
  })
})
