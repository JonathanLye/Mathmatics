import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { twoDrafts } from './draft.ts';
import { copyFixturePages, readOcrPages } from './ocr.ts';
import { renderPdf } from './pdf.ts';
import { writeDraftOutputs, writeJobReport } from './report.ts';
import { splitItems, type ImportItem } from './split.ts';
import { assertJobId, jobDir, newJobId, parsePageRange, readJob, sha256File, writeJob, type JobManifest } from './workspace.ts';
import { publishPackage } from './publish.ts';

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) flags.set(body.slice(0, eq), body.slice(eq + 1));
      else if (i + 1 < argv.length && !(argv[i + 1] as string).startsWith('--')) {
        flags.set(body, argv[i + 1] as string);
        i += 1;
      } else flags.set(body, true);
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

function required(parsed: ParsedArgs, name: string): string {
  const value = parsed.flags.get(name);
  if (typeof value !== 'string' || value === '') throw new Error(`缺少参数 --${name}`);
  return value;
}

function optional(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function intOption(parsed: ParsedArgs, name: string, fallback: number, min: number, max: number): number {
  const raw = optional(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} 需要 ${min}–${max} 的整数，收到：${raw}`);
  }
  return value;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

async function commandPdf(parsed: ParsedArgs): Promise<void> {
  const file = required(parsed, 'file');
  if (file.startsWith('-')) throw new Error('PDF 路径不能以 - 开头（避免被 pdftoppm 当作选项）');
  const pages = parsePageRange(required(parsed, 'pages'));
  const jobId = optional(parsed, 'job') === undefined ? newJobId() : assertJobId(optional(parsed, 'job') as string);
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });

  const manifest: JobManifest = {
    jobId,
    file,
    sha256: sha256File(file),
    pages,
    createdAt: new Date().toISOString(),
    stages: { register: true, render: false, ocr: false },
  };

  if (parsed.flags.has('skip-render') !== true) {
    const render = renderPdf(file, pages, dir);
    manifest.stages.render = render.rendered;
    if (render.reason !== undefined) manifest.stages.renderNote = render.reason;
  }

  const fixture = optional(parsed, 'ocr-fixture');
  if (fixture === undefined) {
    throw new Error('P0 CLI 的 OCR 目前只支持离线 fixture（--ocr-fixture <dir>）；真实 SimpleTex/Qwen provider 属 P1，见 10 §2 S3 / 09 §2');
  }
  copyFixturePages(dir, fixture);
  manifest.stages.ocr = true;
  manifest.stages.ocrProvider = 'fixture';
  writeJob(manifest);
  console.log(JSON.stringify({ jobId, dir, pages: pages.length, stages: manifest.stages }, null, 2));
}

function commandItems(parsed: ParsedArgs): void {
  const jobId = assertJobId(required(parsed, 'job'));
  const job = readJob(jobId);
  const pages = readOcrPages(jobDir(jobId));
  const items = splitItems(pages, {
    chapter: optional(parsed, 'chapter'),
    proofOnly: parsed.flags.has('proof-only') === true,
  });
  writeFileSync(join(jobDir(jobId), 'items.json'), `${JSON.stringify(items, null, 2)}\n`);
  job.stages.items = true;
  writeJob(job);
  console.log(`条目 ${items.length} 个（items.json 已写入 ${jobDir(jobId)}）`);
  for (const item of items) {
    console.log(`- ${item.itemId} p${item.page} ${item.chapter} ${item.proofLike ? '[证明题]' : ''} ${item.label.slice(0, 60)}`);
  }
}

async function commandDraft(parsed: ParsedArgs): Promise<void> {
  const jobId = assertJobId(required(parsed, 'job'));
  const job = readJob(jobId);
  const dir = jobDir(jobId);
  const all = readJson<ImportItem[]>(join(dir, 'items.json'));
  const wanted = optional(parsed, 'items')?.split(',').map((id) => id.trim());
  const max = intOption(parsed, 'max', 10, 1, 50);
  const selected = (wanted === undefined ? all : all.filter((item) => wanted.includes(item.itemId))).slice(0, max);
  if (selected.length === 0) throw new Error('没有可起草的条目（检查 --items 或先跑 import:items）');

  const fixtureA = optional(parsed, 'draft-fixture-a');
  const fixtureB = optional(parsed, 'draft-fixture-b');
  if ((fixtureA === undefined) !== (fixtureB === undefined)) {
    throw new Error('--draft-fixture-a / --draft-fixture-b 必须成对提供（或都不提供走 DeepSeek）');
  }

  const outputs = [];
  for (const item of selected) {
    const drafts = await twoDrafts(item, { fixtureA, fixtureB });
    const out = writeDraftOutputs(dir, item, drafts.a, drafts.b);
    outputs.push({ itemId: item.itemId, ...out, provider: drafts.provider });
    console.log(
      `- ${item.itemId} → ${out.problemId}（采用 ${out.chosen}，${out.ok ? '校验通过' : '校验未通过，见单条报告'}）`,
    );
  }
  job.stages.drafts = outputs.map((out) => out.problemId);
  writeJob(job);
  const jobReport = writeJobReport(dir, outputs);
  console.log(JSON.stringify({ jobReport, outputs: outputs.map(({ itemId, problemId, reportPath, ok }) => ({ itemId, problemId, reportPath, ok })) }, null, 2));
  if (outputs.some((out) => !out.ok)) process.exitCode = 1;
}

async function commandPublish(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positionals[0] ?? optional(parsed, 'file');
  if (file === undefined) throw new Error('用法：pnpm import:publish <imports/.../problem.json> --reviewer T-01 --minutes 90');
  const result = await publishPackage(file, {
    reviewer: required(parsed, 'reviewer'),
    minutes: intOption(parsed, 'minutes', 0, 0, 100000),
    databaseUrl: process.env.DATABASE_URL,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  else if (result.mode === 'dry-run') console.log('dry-run：设置 DATABASE_URL 后会写入 content.problem_versions / vault.* / review_records。');
}

function usage(): void {
  console.log(`证明陪练场 · 题库导入 CLI（10 §6）

  pnpm import:pdf --file <pdf> --pages 27-58 [--ocr-fixture <dir>] [--skip-render]
  pnpm import:items --job <jobId> [--chapter 2] [--proof-only]
  pnpm import:draft --job <jobId> [--items id1,id2] [--max 4] [--draft-fixture-a a.json --draft-fixture-b b.json]
  pnpm import:publish imports/<jobId>/<problemId>.json --reviewer T-01 --minutes 90

仓库内自带的最小 fixtures：apps/import/fixtures/ch2（OCR）、fixtures/epsN.json 与 epsN-alt.json（两稿）。
离线模式：OCR 用 --ocr-fixture，起草用 --draft-fixture-a/b；真实 OCR 与 DeepSeek 起草为 P1 provider 接口。`);
}

export async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const parsed = parseArgs(rest);
  if (command === undefined || parsed.flags.has('help') === true) {
    usage();
    return;
  }
  switch (command) {
    case 'pdf':
      await commandPdf(parsed);
      break;
    case 'items':
      commandItems(parsed);
      break;
    case 'draft':
      await commandDraft(parsed);
      break;
    case 'publish':
      await commandPublish(parsed);
      break;
    default:
      usage();
      throw new Error(`未知命令：${command}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
