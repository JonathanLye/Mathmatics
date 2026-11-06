import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// 成本账本：每次模型调用按响应里的实际用量记账（costs.jsonl），重启后从文件恢复累计额。
// 价格单位：元/百万 Token，取自百炼与 DeepSeek 官方价目（2026-11）。未收录的模型按最贵档估算，宁可早停。
export interface Price {
  input: number;
  output: number;
  cached?: number;
}

const DASHSCOPE: Record<string, Price> = {
  'qwen3-vl-plus': { input: 1, output: 10 },
  'qwen3.5-ocr': { input: 0.5, output: 2 },
  'qwen3.8-flash': { input: 0.8, output: 2.7 },
  'qwen3.8-max': { input: 12, output: 36 },
  'qwen3.7-flash': { input: 0.2, output: 0.8 },
  'qwen3.7-plus': { input: 2, output: 8 },
  'qwen3.6-plus': { input: 2, output: 12 },
  'qwen3.6-flash': { input: 1.2, output: 7.2 },
  'qwen3.5-flash': { input: 0.2, output: 2 },
  'qwen3.5-plus': { input: 0.8, output: 4.8 },
  'qwen-plus': { input: 0.8, output: 8 },
  'qwen-flash': { input: 0.15, output: 1.5 },
};
const UNKNOWN_PRICE: Price = { input: 12, output: 36 };

// DeepSeek 分时：北京时间周一至周五 9–12、14–18 为高峰，其余时段半价。
const DEEPSEEK_PEAK: Record<string, Price> = {
  'deepseek-flash': { input: 2, output: 8, cached: 0.04 },
  'deepseek-v4-pro': { input: 9, output: 27, cached: 0.3 },
};

export function isDeepSeekPeak(at: Date): boolean {
  const beijing = new Date(at.getTime() + 8 * 3600 * 1000);
  const day = beijing.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = beijing.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

export function priceOf(model: string, at: Date = new Date()): Price {
  const deepseek = DEEPSEEK_PEAK[model];
  if (deepseek !== undefined) {
    if (isDeepSeekPeak(at)) return deepseek;
    return { input: deepseek.input / 2, output: deepseek.output / 2, cached: (deepseek.cached ?? deepseek.input) / 2 };
  }
  return DASHSCOPE[model] ?? UNKNOWN_PRICE;
}

export interface Usage {
  input: number;
  output: number;
  cached: number;
}

export function costOf(model: string, usage: Usage, at: Date = new Date()): number {
  const price = priceOf(model, at);
  const uncached = Math.max(0, usage.input - usage.cached);
  const cachedPrice = price.cached ?? price.input;
  return (uncached * price.input + usage.cached * cachedPrice + usage.output * price.output) / 1_000_000;
}

export class BudgetExceededError extends Error {
  readonly spent: number;
  readonly budget: number;
  constructor(spent: number, budget: number) {
    super(`已达预算上限：已花 ¥${spent.toFixed(2)} / 上限 ¥${budget.toFixed(2)}`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.budget = budget;
  }
}

export interface LedgerEntry {
  at: string;
  stage: string;
  model: string;
  input: number;
  output: number;
  cached: number;
  cost: number;
  ref?: string;
}

export class CostLedger {
  private readonly file: string | null;
  private readonly byStage = new Map<string, number>();
  private readonly byModel = new Map<string, number>();
  private total = 0;
  private calls = 0;
  readonly budget: number;

  constructor(options: { file?: string; budget: number }) {
    this.file = options.file ?? null;
    this.budget = options.budget;
    if (this.file !== null) {
      mkdirSync(dirname(this.file), { recursive: true });
      if (existsSync(this.file)) {
        for (const line of readFileSync(this.file, 'utf8').split('\n')) {
          if (line.trim() === '') continue;
          try {
            this.tally(JSON.parse(line) as LedgerEntry);
          } catch {
            // 崩溃可能留下半行；少算一行比中止强，但下一步预算判断仍以累计额为准。
          }
        }
      }
    }
  }

  private tally(entry: LedgerEntry): void {
    this.total += entry.cost;
    this.calls += 1;
    this.byStage.set(entry.stage, (this.byStage.get(entry.stage) ?? 0) + entry.cost);
    this.byModel.set(entry.model, (this.byModel.get(entry.model) ?? 0) + entry.cost);
  }

  spent(): number {
    return this.total;
  }

  // 调用前检查：已花费达到上限就不再发起新调用（在途调用的费用会计入，所以留一点余量）。
  assertWithinBudget(): void {
    if (this.total >= this.budget) throw new BudgetExceededError(this.total, this.budget);
  }

  record(entry: Omit<LedgerEntry, 'at' | 'cost'> & { cost?: number; at?: string }): LedgerEntry {
    const at = entry.at === undefined ? new Date() : new Date(entry.at);
    const usage = { input: entry.input, output: entry.output, cached: entry.cached };
    const full: LedgerEntry = {
      ...entry,
      at: at.toISOString(),
      cost: entry.cost ?? costOf(entry.model, usage, at),
    };
    this.tally(full);
    if (this.file !== null) appendFileSync(this.file, `${JSON.stringify(full)}\n`);
    return full;
  }

  summary(): { total: number; calls: number; byStage: Record<string, number>; byModel: Record<string, number> } {
    return {
      total: this.total,
      calls: this.calls,
      byStage: Object.fromEntries(this.byStage),
      byModel: Object.fromEntries(this.byModel),
    };
  }
}
