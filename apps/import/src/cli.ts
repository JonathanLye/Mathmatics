import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

import { checkCategories } from './checks.ts';
import { loadConceptsFile } from './concepts.ts';
import { stageDraft } from './db.ts';
import { twoDrafts } from './draft.ts';
import { copyFixturePages, readOcrPages, writeOcrPages } from './ocr.ts';
import { renderPdf } from './pdf.ts';
import { writeDraftOutputs, writeJobReport } from './report.ts';
import { createQwenOcrProvider } from './providers/qwen.ts';
import { createSimpleTexOcrProvider } from './providers/simpletex.ts';
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

  const provider = optional(parsed, 'ocr-provider') ?? 'fixture';
  if (provider === 'fixture') {
    const fixture = optional(parsed, 'ocr-fixture');
    if (fixture === undefined) {
      throw new Error('fixture OCR 需要 --ocr-fixture <dir>；真实 OCR 用 --ocr-provider simpletex|qwen');
    }
    copyFixturePages(dir, fixture);
    manifest.stages.ocr = true;
    manifest.stages.ocrProvider = 'fixture';
  } else if (provider === 'simpletex' || provider === 'qwen') {
    if (parsed.flags.has('skip-render') === true) {
      throw new Error(`${provider} OCR 需要渲染后的页面图（不能 --skip-render）`);
    }
    const pagesDir = join(dir, 'pages');
    const images = readdirSync(pagesDir)
      .map((name) => /^page-(\d+)(?:-\d+)?\.png$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ page: Number(match[1]), file: join(pagesDir, match[0]) }))
      .sort((a, b) => a.page - b.page);
    if (images.length === 0) throw new Error(`没有找到渲染页面（${pagesDir}/page-*.png）`);
    const ocrProvider =
      provider === 'simpletex'
        ? createSimpleTexOcrProvider({ apiKey: process.env.SIMPLETEX_API_KEY ?? '' })
        : createQwenOcrProvider({ apiKey: process.env.DASHSCOPE_API_KEY ?? '' });
    const ocrPages = await ocrProvider.recognize(images);
    writeOcrPages(dir, ocrPages);
    manifest.stages.ocr = true;
    manifest.stages.ocrProvider = provider;
  } else {
    throw new Error(`未知 OCR provider：${provider}（fixture | simpletex | qwen）`);
  }
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

  const conceptsPath = optional(parsed, 'concepts');
  const checkOptions = conceptsPath === undefined ? {} : { concepts: loadConceptsFile(conceptsPath) };
  const outputs = [];
  for (const item of selected) {
    const drafts = await twoDrafts(item, { fixtureA, fixtureB });
    const out = writeDraftOutputs(dir, item, drafts.a, drafts.b, checkOptions);
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

// 一条龙：S1（登记/渲染/OCR）→ S4（切条目）→ S6/S7/S8（起草/仲裁/校验）→ 可选 S9 前的 DB 暂存。
// 复用四条命令的实现，保证行为一致；job 目录/报告仍由各步骤落盘。
async function commandRun(parsed: ParsedArgs): Promise<void> {
  const jobId = optional(parsed, 'job') === undefined ? newJobId() : assertJobId(optional(parsed, 'job') as string);
  const withJob = (): ParsedArgs => {
    const flags = new Map(parsed.flags);
    flags.set('job', jobId);
    return { positionals: [], flags };
  };

  await commandPdf(withJob());
  commandItems(withJob());
  await commandDraft(withJob());

  const job = readJob(jobId);
  const drafts = job.stages.drafts ?? [];
  const dir = jobDir(jobId);
  const databaseUrl = optional(parsed, 'database-url') ?? process.env.DATABASE_URL;

  if (parsed.flags.has('submit') !== true) {
    console.log(JSON.stringify({ jobId, dir, drafts, submitted: false }, null, 2));
    console.log('未加 --submit：草稿留在 imports/ 下，教师端审核前可先人工检查 report.md。');
    return;
  }
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    console.log(JSON.stringify({ jobId, dir, drafts, submitted: false, reason: 'no DATABASE_URL' }, null, 2));
    console.log('--submit 需要 --database-url / DATABASE_URL；本次只生成草稿与报告。');
    return;
  }

  const { stageDraft } = await import('./db.ts');
  const { Client } = await import('pg');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(dir).filter(
    (name) => name.endsWith('.json') && name !== 'job.json' && name !== 'items.json' && !name.endsWith('.report.json'),
  );
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const staged: unknown[] = [];
  try {
    await client.query('BEGIN');
    for (const name of files) {
      const pkg = readJson<import('@proof-gym/engine').ProblemPackage>(join(dir, name));
      if (!drafts.includes(pkg.id)) continue;
      staged.push(await stageDraft(pkg, client));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ jobId, dir, drafts, submitted: true, staged }, null, 2));
}

async function commandSubmit(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positionals[0] ?? optional(parsed, 'file');
  if (file === undefined) throw new Error('用法：pnpm import:submit <imports/.../problem.json> [--database-url …]');
  const pkg = readJson<import('@proof-gym/engine').ProblemPackage>(file);
  const conceptsPath = optional(parsed, 'concepts');
  const options = conceptsPath === undefined ? {} : { concepts: loadConceptsFile(conceptsPath) };
  const databaseUrl = optional(parsed, 'database-url') ?? process.env.DATABASE_URL;
  const checks = checkCategories(pkg, options);

  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    console.log(JSON.stringify({ mode: 'dry-run', problemId: pkg.id, autoChecks: checks.categories, issues: checks.issues.length }, null, 2));
    console.log('dry-run：设置 --database-url / DATABASE_URL 后会把草稿写入 content.problem_versions(review_status=draft) 等待教师审核。');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const staged = await stageDraft(pkg, client, options);
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode: 'db', ...staged }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function commandPublish(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positionals[0] ?? optional(parsed, 'file');
  if (file === undefined) throw new Error('用法：pnpm import:publish <imports/.../problem.json> --reviewer T-01 --minutes 90');
  const result = await publishPackage(file, {
    reviewer: required(parsed, 'reviewer'),
    minutes: intOption(parsed, 'minutes', 0, 0, 100000),
    databaseUrl: process.env.DATABASE_URL,
    ...(optional(parsed, 'concepts') === undefined ? {} : { concepts: loadConceptsFile(optional(parsed, 'concepts') as string) }),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  else if (result.mode === 'dry-run') console.log('dry-run：设置 DATABASE_URL 后会写入 content.problem_versions / vault.* / review_records。');
}

async function commandBatch(parsed: ParsedArgs): Promise<void> {
  const dir = parsed.positionals[0];
  if (dir === undefined) throw new Error('用法：pnpm import:batch <dir> [--out imports/batch-<id>] [--dry-run] [--max N] [--concurrency 3] [--budget-cny X] [--resume]');
  const { runBatch, ALL_STAGES } = await import('./batch/run.ts');
  const pagesSpec = optional(parsed, 'pages');
  const maxRaw = optional(parsed, 'max');
  const result = await runBatch({
    dir,
    out: optional(parsed, 'out') ?? join('imports', `batch-${newJobId()}`),
    dryRun: parsed.flags.has('dry-run'),
    resume: parsed.flags.has('resume'),
    concurrency: intOption(parsed, 'concurrency', 3, 1, 64),
    budgetCny: Number(optional(parsed, 'budget-cny') ?? '150'),
    stages: optional(parsed, 'stages')?.split(',').map((stage) => stage.trim()) ?? ALL_STAGES,
    log: (line) => console.log(line),
    ...(maxRaw === undefined ? {} : { max: intOption(parsed, 'max', 0, 1, 100000) }),
    ...(optional(parsed, 'verify-max') === undefined ? {} : { verifyMax: intOption(parsed, 'verify-max', 0, 1, 100000) }),
    ...(optional(parsed, 'draft-model') === undefined ? {} : { draftModel: optional(parsed, 'draft-model') as string }),
    ...(optional(parsed, 'variation-rate') === undefined ? {} : { variationRate: Number(optional(parsed, 'variation-rate')) }),
    ...(optional(parsed, 'book-titles') === undefined
      ? {}
      : {
          bookTitles: Object.fromEntries(
            (optional(parsed, 'book-titles') as string).split(';').map((pair) => pair.split('=', 2) as [string, string]),
          ),
        }),
    ...(pagesSpec === undefined ? {} : { pages: parsePageRange(pagesSpec) }),
  });
  if (result.dryRun !== undefined) console.log(JSON.stringify(result.dryRun, null, 2));
  if (result.budgetStopped) process.exitCode = 3;
}

// 只重新打包：不调模型，读 drafts/ 里通过门禁的题，写 bundle.jsonl.gz、failed.json、report.json。
async function commandBundle(parsed: ParsedArgs): Promise<void> {
  const out = optional(parsed, 'out');
  if (out === undefined) throw new Error('用法：pnpm import:bundle --out imports/batch-<id>');
  const { runBatch } = await import('./batch/run.ts');
  await runBatch({
    dir: parsed.positionals[0] ?? join(out, 'sources'),
    out,
    dryRun: false,
    resume: true,
    concurrency: 1,
    budgetCny: Number(optional(parsed, 'budget-cny') ?? '150'),
    stages: ['bundle'],
    log: (line) => console.log(line),
  });
}

function usage(): void {
  console.log(`证明陪练场 · 题库导入 CLI（10 §6）

  pnpm import:pdf --file <pdf> --pages 27-58 [--ocr-fixture <dir>|--ocr-provider simpletex|qwen] [--skip-render]
  pnpm import:items --job <jobId> [--chapter 2] [--proof-only]
  pnpm import:draft --job <jobId> [--items id1,id2] [--max 4] [--concepts concepts.json] [--draft-fixture-a a.json --draft-fixture-b b.json]
  pnpm import:publish imports/<jobId>/<problemId>.json --reviewer T-01 --minutes 90 [--concepts concepts.json]
  pnpm import:submit imports/<jobId>/<problemId>.json [--database-url postgres://…] [--concepts concepts.json]
  pnpm import:run --file <pdf> --pages 27-58 --ocr-fixture <dir> [--max 4] [--draft-fixture-a/b …] [--submit]
  pnpm import:batch <dir> [--out imports/batch-<id>] [--dry-run] [--max N] [--verify-max N] [--variation-rate 0.1] [--concurrency 3] [--budget-cny X] [--resume] [--stages a,b] [--pages 1-20] [--draft-model m] [--book-titles 'id=书名;id=书名']
  pnpm import:bundle --out imports/batch-<id>

仓库内自带的最小 fixtures：apps/import/fixtures/ch2（OCR）、fixtures/epsN.json 与 epsN-alt.json（两稿）。
离线模式：OCR 用 --ocr-fixture，起草用 --draft-fixture-a/b；真实 OCR 需 SIMPLETEX_API_KEY / DASHSCOPE_API_KEY 并渲染页面；起草需 DEEPSEEK_API_KEY。`);
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
    case 'submit':
      await commandSubmit(parsed);
      break;
    case 'run':
      await commandRun(parsed);
      break;
    case 'batch':
      await commandBatch(parsed);
      break;
    case 'bundle':
      await commandBundle(parsed);
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
