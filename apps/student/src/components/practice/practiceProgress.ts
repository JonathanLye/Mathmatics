/**
 * 顶部进度条的纯计算：一条连续的条，加上每层之间的刻度。
 * 只读服务端下发的层状态；不启用的层（导入题只有写证明和总结）不占位置。
 */
import type { LayerId, LayerStatus } from '@/types/attempt'

export interface LayersProgress {
  /** 0–1。 */
  value: number
  /** 层与层之间的刻度位置（0–1），不含两端。 */
  ticks: number[]
}

/**
 * 还在做的那一层：第一个没完成、没跳过的启用层（和引擎的 frontier 同一个定义）。全做完是 null。
 * 只用来决定层列表里哪一行可点、要不要显示「回到」；能不能去最终由 /layers/{layer}/enter 决定。
 */
export function frontierLayer(layers: readonly LayerStatus[]): LayerId | null {
  return layers.find((layer) => layer.enabled !== false && layer.status !== 'done' && layer.status !== 'skipped' && layer.status !== 'disabled')?.layer ?? null
}

export function layersProgress(layers: readonly LayerStatus[], completed = false): LayersProgress {
  const enabled = layers.filter((layer) => layer.status !== 'disabled')
  const total = enabled.length
  if (total === 0) return { value: completed ? 1 : 0, ticks: [] }
  const ticks = Array.from({ length: total - 1 }, (_, i) => (i + 1) / total)
  if (completed) return { value: 1, ticks }
  const passed = enabled.filter((layer) => layer.status === 'done' || layer.status === 'skipped').length
  const active = enabled.some((layer) => layer.status === 'active') ? 0.5 : 0
  return { value: Math.min(1, (passed + active) / total), ticks }
}
