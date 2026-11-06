import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConceptsFile, ProblemPackage } from '@proof-gym/engine';

import { buildBundle, encodeBundle } from './bundle.ts';
import { canonicalChapters, selectCandidates } from './candidate.ts';
import { DRAFT_MODEL, draftPart, drafterOf, type DraftOutcome } from './draft-stage.ts';
import { BudgetExceededError, CostLedger } from './ledger.ts';
import { createChatClient, mapPool, type ChatClient } from './llm.ts';
import { Manifest } from './manifest.ts';
import { normalizeOcrText, ocrSource, OCR_MODEL, readPage, writeAtomic } from './ocr-stage.ts';
import { segmentBook, type SegmentedItem } from './segment.ts';
import { selectForDraft, spreadByChapter } from './select.ts';
import { runVariation, sampleForVariation, summarizeVariation, type VariationResult } from './variation.ts';
import { bandOf, checkerOf, normalizeItem, verifyPart, VERIFY_MODEL, type VerifiedPart } from './verify.ts';
import { readTextSource, walkSources, type PdfProbe, type SourceFile } from './walk.ts';

// pnpm import:batch 的编排：目录遍历 → OCR → 切条目 → 过滤 → 校验 → 起草 + 门禁 → 变式测试 → 打包。
// 每一步都按文件缓存，可以单独重跑；--resume 继续上次的进度，已经花过钱的结果不会重做。
export interface BatchOptions {
  dir: string;
  out: string;
  dryRun: boolean;
  resume: boolean;
  // 最多起草多少题（试跑用 --max 20）；校验量默认是它的 3 倍。不给就处理全部候选。
  max?: number;
  verifyMax?: number;
  concurrency: number;
  budgetCny: number;
  stages: string[];
  pages?: number[];
  variationRate?: number;
  batchId?: string;
  ids?: Record<string, string>;
  useSegmentModel?: boolean;
  draftModel?: string;
  // { 书目 ID: 书名 }，写进题目包的 source.book。
  bookTitles?: Record<string, string>;
  log?: (line: string) => void;
  client?: ChatClient;
  probe?: (file: string) => PdfProbe;
  concepts?: ConceptsFile;
}

export const ALL_STAGES = ['ocr', 'segment', 'candidates', 'verify', 'draft', 'variation', 'bundle'];

export interface DryRunReport {
  files: Array<{ id: string; relPath: string; kind: string; pages: number; skipped?: string }>;
  ocrPages: number;
  estimatedOcrCny: number;
  estimatedModelCny: number;
}

const OCR_CNY_PER_PAGE = 0.013;
const MODEL_CNY_PER_PAGE = 0.06;

export function dryRunReport(files: readonly SourceFile[], pages?: number[]): DryRunReport {
  const usable = files.filter((file) => file.skipped === undefined);
  const ocrPages = usable.filter((file) => file.kind !== 'text').reduce((sum, file) => sum + (pages?.length ?? file.pages), 0);
  const totalPages = usable.reduce((sum, file) => sum + (pages?.length ?? file.pages), 0);
  return {
    files: files.map((file) => ({
      id: file.id,
      relPath: file.relPath,
      kind: file.kind,
      pages: file.pages,
      ...(file.skipped === undefined ? {} : { skipped: file.skipped }),
    })),
    ocrPages,
    estimatedOcrCny: Number((ocrPages * OCR_CNY_PER_PAGE).toFixed(2)),
    estimatedModelCny: Number((totalPages * MODEL_CNY_PER_PAGE).toFixed(2)),
  };
}

interface BatchContext {
  options: BatchOptions;
  out: string;
  batchId: string;
  files: SourceFile[];
  manifest: Manifest;
  ledger: CostLedger;
  client: ChatClient;
  concepts: ConceptsFile;
  log: (line: string) => void;
}

export interface BatchResult {
  dryRun?: DryRunReport;
  spent: number;
  budgetStopped: boolean;
}

function loadSeedConcepts(): ConceptsFile {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/concepts.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ConceptsFile;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export async function runBatch(options: BatchOptions): Promise<BatchResult> {
  const out = resolve(options.out);
  const walkOptions = {
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
  };
  const files = walkSources(options.dir, walkOptions);
  if (options.dryRun) return { dryRun: dryRunReport(files, options.pages), spent: 0, budgetStopped: false };
  if (existsSync(join(out, 'manifest.json')) && !options.resume) {
    throw new Error(`${out} 已有 manifest.json：继续请加 --resume，或换一个 --out`);
  }
  mkdirSync(out, { recursive: true });
  const log = (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line}`;
    appendFileSync(join(out, 'progress.log'), `${stamped}\n`);
    options.log?.(stamped);
  };
  const manifest = new Manifest(out);
  const ledger = new CostLedger({ file: join(out, 'costs.jsonl'), budget: options.budgetCny });
  const client = options.client ?? createChatClient({ ledger });
  for (const file of files) {
    manifest.registerFile(file);
    if (file.skipped !== undefined) log(`[walk] 跳过 ${file.relPath}：${file.skipped}`);
  }
  manifest.save();
  const context: BatchContext = {
    options,
    out,
    batchId: options.batchId ?? basename(out),
    files,
    manifest,
    ledger,
    client,
    concepts: options.concepts ?? loadSeedConcepts(),
    log,
  };

  let budgetStopped = false;
  const steps: Array<[string, (context: BatchContext) => Promise<void>]> = [
    ['ocr', stageOcr],
    ['segment', stageSegment],
    ['candidates', stageCandidates],
    ['verify', stageVerify],
    ['draft', stageDraft],
    ['variation', stageVariation],
    ['bundle', stageBundle],
  ];
  try {
    for (const [name, stage] of steps) {
      if (options.stages.includes(name)) await stage(context);
    }
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) throw error;
    budgetStopped = true;
    log(`[stop] ${error.message}`);
  }
  manifest.save();
  writeFileSync(join(out, 'costs-summary.json'), `${JSON.stringify(ledger.summary(), null, 2)}\n`);
  log(`[done] 阶段 ${options.stages.join(',')} 结束；累计 ¥${ledger.spent().toFixed(2)}${budgetStopped ? '（提前停止，原因见上一行）' : ''}`);
  return { spent: ledger.spent(), budgetStopped };
}

async function stageOcr(context: BatchContext): Promise<void> {
  const { options, out, files, manifest, client, log } = context;
  for (const file of files) {
    if (file.skipped !== undefined || file.kind === 'text') continue;
    const summary = await ocrSource(file, {
      outDir: out,
      client,
      manifest,
      concurrency: options.concurrency,
      model: OCR_MODEL,
      log,
      ...(options.pages === undefined ? {} : { pages: options.pages }),
    });
    if (summary.budgetStopped) throw new BudgetExceededError(context.ledger.spent(), context.ledger.budget);
  }
  manifest.stageDone('ocr');
}

function pagesOfSource(context: BatchContext, file: SourceFile): Map<number, string> {
  const pages = new Map<number, string>();
  if (file.kind === 'text') {
    pages.set(1, normalizeOcrText(readTextSource(file)));
    return pages;
  }
  const wanted = context.options.pages ?? Array.from({ length: file.pages }, (_, index) => index + 1);
  for (const page of wanted) {
    const text = readPage(context.out, file.id, page);
    if (text !== null) pages.set(page, text);
  }
  return pages;
}

async function stageSegment(context: BatchContext): Promise<void> {
  const { options, out, files, client, log, manifest } = context;
  mkdirSync(join(out, 'items'), { recursive: true });
  for (const file of files) {
    if (file.skipped !== undefined) continue;
    const pages = pagesOfSource(context, file);
    if (pages.size === 0) {
      log(`[segment] ${file.id}：没有 OCR 结果，跳过`);
      continue;
    }
    const result = await segmentBook({
      outDir: out,
      book: file.id,
      client,
      concurrency: options.concurrency,
      pages,
      log,
      ...(options.useSegmentModel === false ? { useModel: false } : {}),
    });
    if (result.budgetStopped) throw new BudgetExceededError(context.ledger.spent(), context.ledger.budget);
    writeAtomic(join(out, 'items', `${file.id}.json`), `${JSON.stringify(result.items)}\n`);
    log(`[segment] ${file.id}：${result.items.length} 个条目（模型窗口 ${result.modelWindows}，规则窗口 ${result.ruleWindows}）`);
  }
  manifest.stageDone('segment');
}

function allItems(context: BatchContext): SegmentedItem[] {
  const items: SegmentedItem[] = [];
  for (const file of context.files) {
    const path = join(context.out, 'items', `${file.id}.json`);
    if (existsSync(path)) items.push(...readJson<SegmentedItem[]>(path));
  }
  return items;
}

async function stageCandidates(context: BatchContext): Promise<void> {
  const chapters = canonicalChapters(allItems(context));
  const items = allItems(context).map((item) => ({ ...item, chapter: chapters.get(item.chapterNo) ?? item.chapter }));
  const result = selectCandidates(items);
  writeAtomic(join(context.out, 'candidates.json'), `${JSON.stringify(result.kept)}\n`);
  writeAtomic(join(context.out, 'candidates-rejected.json'), `${JSON.stringify(result.rejected)}\n`);
  for (const rejected of result.rejected) {
    context.manifest.setItem(rejected.id, { status: 'skipped', stage: 'candidates', reason: rejected.reason });
  }
  context.log(`[candidates] 共 ${items.length} 条，候选 ${result.kept.length}，规则拒绝 ${result.rejected.length}`);
  context.manifest.stageDone('candidates', `${result.kept.length} kept`);
}

function readCandidates(context: BatchContext): SegmentedItem[] {
  const path = join(context.out, 'candidates.json');
  if (!existsSync(path)) throw new Error('缺少 candidates.json：先跑 candidates 阶段');
  return readJson<SegmentedItem[]>(path);
}

function verifyPool(context: BatchContext, candidates: SegmentedItem[]): SegmentedItem[] {
  const { verifyMax, max } = context.options;
  const limit = verifyMax ?? (max === undefined ? undefined : max * 3);
  return limit === undefined ? candidates : spreadByChapter(candidates, (item) => item.chapterNo, limit);
}

async function stageVerify(context: BatchContext): Promise<void> {
  const { options, out, client, manifest, log } = context;
  const candidates = verifyPool(context, readCandidates(context));
  let done = 0;
  let stopped: BudgetExceededError | undefined;
  await mapPool(
    candidates,
    options.concurrency,
    async (item) => {
      try {
        const normalized = await normalizeItem(item, client, out);
        if (!normalized.usable) {
          manifest.setItem(item.id, { status: 'skipped', stage: 'normalize', reason: normalized.rejectReason ?? 'unusable', pages: item.pages });
          return;
        }
        for (const part of normalized.parts) {
          const verified = await verifyPart(part, item.id, client, out);
          manifest.setItem(part.partId, {
            status: verified.accepted ? 'done' : 'skipped',
            stage: 'verify',
            pages: item.pages,
            ...(verified.reason === undefined ? {} : { reason: verified.reason }),
          });
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          stopped = error;
          return;
        }
        // 单题失败不影响其它题：记下原因，这题下次 --resume 会再试。
        manifest.setItem(item.id, { status: 'failed', stage: 'verify', reason: (error as Error).message.slice(0, 200), pages: item.pages });
        log(`[verify] ${item.id} 失败：${(error as Error).message.slice(0, 200)}`);
      }
      done += 1;
      if (done % 50 === 0) log(`[verify] ${done}/${candidates.length}，累计 ¥${context.ledger.spent().toFixed(2)}`);
    },
    () => stopped !== undefined,
  );
  if (stopped !== undefined) throw stopped;
  manifest.stageDone('verify');
}

function readVerified(context: BatchContext): VerifiedPart[] {
  const dir = join(context.out, 'verify');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson<VerifiedPart>(join(dir, name)));
}

function itemLookup(context: BatchContext): (partId: string) => SegmentedItem {
  const byId = new Map(readCandidates(context).map((item) => [item.id, item]));
  return (partId: string): SegmentedItem => {
    const item = byId.get(partId) ?? byId.get(partId.replace(/-p\d+$/, ''));
    if (item === undefined) throw new Error(`找不到条目 ${partId}`);
    return item;
  };
}

function readOutcomes(context: BatchContext): DraftOutcome[] {
  const dir = join(context.out, 'drafts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson<DraftOutcome>(join(dir, name)));
}

function recordOutcome(manifest: Manifest, outcome: DraftOutcome, part: VerifiedPart | undefined): void {
  manifest.setItem(outcome.partId, {
    status: outcome.ok ? 'done' : 'failed',
    stage: 'draft',
    cost: outcome.cost,
    writtenBy: drafterOf(outcome),
    ...(part === undefined ? {} : { checkedBy: checkerOf(part) }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  });
}

async function stageDraft(context: BatchContext): Promise<void> {
  const { options, out, client, manifest, concepts, batchId, log } = context;
  const itemOf = itemLookup(context);
  const verified = readVerified(context).filter((part) => part.accepted);
  const selected = options.max === undefined ? verified : selectForDraft(verified, itemOf, options.max);
  log(`[draft] 已核验 ${verified.length}，本次起草 ${selected.length}`);
  let done = 0;
  let stopped: BudgetExceededError | undefined;
  await mapPool(
    selected,
    options.concurrency,
    async (part) => {
      try {
        const outcome = await draftPart(part, itemOf(part.partId), {
          outDir: out,
          client,
          concepts,
          batchId,
          model: options.draftModel ?? DRAFT_MODEL,
          verifierModel: VERIFY_MODEL,
          ...(options.bookTitles === undefined ? {} : { bookTitles: options.bookTitles }),
        });
        recordOutcome(manifest, outcome, part);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          stopped = error;
          return;
        }
        manifest.setItem(part.partId, { status: 'failed', stage: 'draft', reason: (error as Error).message.slice(0, 200) });
        log(`[draft] ${part.partId} 失败：${(error as Error).message.slice(0, 200)}`);
      }
      done += 1;
      if (done % 10 === 0) log(`[draft] ${done}/${selected.length}，累计 ¥${context.ledger.spent().toFixed(2)}`);
    },
    () => stopped !== undefined,
  );
  if (stopped !== undefined) throw stopped;
  manifest.stageDone('draft');
}

async function stageVariation(context: BatchContext): Promise<void> {
  const { options, out, client, log, manifest } = context;
  const passing = readOutcomes(context).filter((outcome) => outcome.ok && outcome.pkg !== undefined);
  const byId = new Map(passing.map((outcome) => [outcome.problemId, outcome.pkg as ProblemPackage]));
  const sample = sampleForVariation([...byId.keys()].sort(), options.variationRate ?? 0.1);
  const results: VariationResult[] = [];
  let stopped: BudgetExceededError | undefined;
  await mapPool(
    sample,
    options.concurrency,
    async (id) => {
      try {
        results.push(await runVariation(byId.get(id) as ProblemPackage, client, out));
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          stopped = error;
          return;
        }
        log(`[variation] ${id} 失败：${(error as Error).message.slice(0, 200)}`);
      }
    },
    () => stopped !== undefined,
  );
  if (stopped !== undefined) throw stopped;
  const summary = summarizeVariation(results);
  writeAtomic(join(out, 'variation-summary.json'), `${JSON.stringify({ ...summary, results }, null, 1)}\n`);
  log(`[variation] 抽样 ${summary.sampled}，规则完成率 ${summary.finishRate}，关键步骤命中率 ${summary.keyRate}`);
  manifest.stageDone('variation');
}

interface FailureEntry {
  id: string;
  stage: string;
  reason: string;
  detail?: unknown;
}

// failed.json：所有没进题库的题及其原因。U16：不进人工队列，只进这份报告。
function collectFailures(context: BatchContext, outcomes: readonly DraftOutcome[]): FailureEntry[] {
  const failures: FailureEntry[] = [];
  const rejectedPath = join(context.out, 'candidates-rejected.json');
  if (existsSync(rejectedPath)) {
    for (const rejected of readJson<Array<{ id: string; reason: string; note?: string }>>(rejectedPath)) {
      if (rejected.reason === 'not_proof') continue; // 计算题不是失败，只在直方图里计数。
      failures.push({ id: rejected.id, stage: 'candidates', reason: rejected.reason, ...(rejected.note === undefined ? {} : { detail: rejected.note }) });
    }
  }
  const normDir = join(context.out, 'norm');
  if (existsSync(normDir)) {
    for (const name of readdirSync(normDir).filter((entry) => entry.endsWith('.json'))) {
      const normalized = readJson<{ itemId: string; usable: boolean; rejectReason?: string }>(join(normDir, name));
      if (!normalized.usable) failures.push({ id: normalized.itemId, stage: 'normalize', reason: normalized.rejectReason ?? 'unusable' });
    }
  }
  for (const part of readVerified(context)) {
    if (!part.accepted) {
      failures.push({ id: part.partId, stage: 'verify', reason: part.reason ?? 'rejected', detail: part.verdict.gaps });
    }
  }
  for (const outcome of outcomes) {
    if (!outcome.ok) failures.push({ id: outcome.partId, stage: 'draft', reason: outcome.reason ?? 'failed', detail: outcome.issues.slice(0, 8) });
  }
  return failures;
}

function histogram<T>(values: readonly T[], keyOf: (value: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function stageBundle(context: BatchContext): Promise<void> {
  const { out, batchId, log, manifest, ledger } = context;
  const outcomes = readOutcomes(context);
  const itemOf = itemLookup(context);
  const partById = new Map(readVerified(context).map((part) => [part.partId, part]));
  for (const outcome of outcomes) recordOutcome(manifest, outcome, partById.get(outcome.partId));
  const lines = buildBundle({ batchId, outcomes, itemOf });
  writeFileSync(join(out, 'bundle.jsonl.gz'), encodeBundle(lines));
  const failures = collectFailures(context, outcomes);
  writeAtomic(join(out, 'failed.json'), `${JSON.stringify(failures, null, 1)}\n`);

  const problems = lines.filter((line) => line.type === 'problem');
  const units = lines.filter((line) => line.type === 'unit');
  const items = allItems(context);
  const verified = readVerified(context);
  const rejected = existsSync(join(out, 'candidates-rejected.json'))
    ? readJson<Array<{ reason: string }>>(join(out, 'candidates-rejected.json'))
    : [];
  const variationPath = join(out, 'variation-summary.json');
  const report = {
    batchId,
    generatedAt: new Date().toISOString(),
    sources: context.files.map((file) => ({ id: file.id, pages: file.pages, skipped: file.skipped ?? null })),
    funnel: {
      segmented: items.length,
      candidates: existsSync(join(out, 'candidates.json')) ? readCandidates(context).length : 0,
      verifiedParts: verified.length,
      accepted: verified.filter((part) => part.accepted).length,
      repaired: verified.filter((part) => part.accepted && part.repaired).length,
      drafted: outcomes.length,
      ready: problems.length,
    },
    byDrafter: Object.fromEntries(
      [...new Set(outcomes.map((outcome) => drafterOf(outcome)))].map((model) => {
        const own = outcomes.filter((outcome) => drafterOf(outcome) === model);
        const passed = own.filter((outcome) => outcome.ok);
        return [
          model,
          {
            drafted: own.length,
            passedGates: passed.length,
            gatePassRate: Number((passed.length / own.length).toFixed(3)),
            cost: Number(own.reduce((sum, outcome) => sum + outcome.cost, 0).toFixed(2)),
          },
        ];
      }),
    ),
    readyByBand: histogram(problems, (line) => line.band),
    readyByChapter: histogram(problems, (line) => (line.pkg.public.chapter === '' ? '未识别' : line.pkg.public.chapter)),
    acceptedByBand: histogram(
      verified.filter((part) => part.accepted),
      (part) => bandOf(part.verdict.difficulty),
    ),
    rejections: {
      candidates: histogram(rejected, (entry) => entry.reason),
      failures: histogram(failures, (entry) => `${entry.stage}:${entry.reason.split(':')[0] as string}`),
    },
    pathItems: units.reduce((sum, unit) => sum + unit.items.length, 0),
    units: units.length,
    variation: existsSync(variationPath)
      ? (({ sampled, finishRate, keyRate }) => ({ sampled, finishRate, keyRate }))(readJson<{ sampled: number; finishRate: number; keyRate: number }>(variationPath))
      : null,
    cost: ledger.summary(),
  };
  writeAtomic(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  log(`[bundle] ${problems.length} 题，${units.length} 个单元；失败报告 ${failures.length} 条`);
  manifest.stageDone('bundle', `${problems.length} problems`);
}
