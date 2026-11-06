import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BudgetExceededError } from './ledger.ts';
import { mapPool, type ChatClient } from './llm.ts';
import type { Manifest } from './manifest.ts';
import type { SourceFile } from './walk.ts';

// S2/S3：逐页渲染、逐页 OCR，结果缓存在 ocr/<book>/page-NNNN.md；已有缓存的页不再花钱。
export const OCR_MODEL = 'qwen3-vl-plus';

export const OCR_PROMPT = [
  '你是印刷体数学教辅的转写员。把这一页图片逐行转写为 Markdown：中文原样；所有数学式写成 LaTeX，行内用 $...$，独立成行的公式用单独一行的 $...$（不要用 $$）。',
  '规则：只转写看到的内容，不解释、不补全、不改写、不纠错；保留题号（如 ○1.、◎2.、(1)、【例 3】、§2）、“证明”“分析”“解”等栏目词；页眉页脚（书名、章名、页码）放在第一行或最后一行，分别以 [页眉] [页脚] 开头。',
  '看不清的字符写成 ⍰。图形写成一行 [图]。不要输出代码块。',
].join('\n');

export function pageFile(outDir: string, bookId: string, page: number): string {
  return join(outDir, 'ocr', bookId, `page-${String(page).padStart(4, '0')}.md`);
}

export function writeAtomic(file: string, text: string): void {
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

export function renderPage(pdf: string, page: number, outDir: string, bookId: string): string {
  const dir = join(outDir, 'pages', bookId);
  mkdirSync(dir, { recursive: true });
  const stem = join(dir, `page-${String(page).padStart(4, '0')}`);
  const png = `${stem}.png`;
  if (existsSync(png)) return png;
  const result = spawnSync(
    'pdftoppm',
    ['-f', String(page), '-l', String(page), '-r', '200', '-gray', '-png', '-singlefile', pdf, stem],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (result.status !== 0 || !existsSync(png)) throw new Error(`pdftoppm 第 ${page} 页失败`);
  return png;
}

export interface OcrOptions {
  outDir: string;
  client: ChatClient;
  manifest: Manifest;
  concurrency: number;
  model?: string;
  pages?: number[];
  log?: (line: string) => void;
  renderer?: (pdf: string, page: number, outDir: string, bookId: string) => string;
}

export interface OcrSummary {
  total: number;
  cached: number;
  done: number;
  failed: number;
  budgetStopped: boolean;
}

export async function ocrSource(file: SourceFile, options: OcrOptions): Promise<OcrSummary> {
  const dir = join(options.outDir, 'ocr', file.id);
  mkdirSync(dir, { recursive: true });
  const log = options.log ?? (() => undefined);
  const render = options.renderer ?? renderPage;
  const model = options.model ?? OCR_MODEL;
  const wanted = options.pages ?? Array.from({ length: file.pages }, (_, index) => index + 1);
  const summary: OcrSummary = { total: wanted.length, cached: 0, done: 0, failed: 0, budgetStopped: false };
  const todo: number[] = [];
  for (const page of wanted) {
    if (existsSync(pageFile(options.outDir, file.id, page))) summary.cached += 1;
    else todo.push(page);
  }
  log(`[ocr] ${file.id} ${file.relPath}: 共 ${wanted.length} 页，已缓存 ${summary.cached}，待识别 ${todo.length}`);

  await mapPool(
    todo,
    options.concurrency,
    async (page) => {
      try {
        const png = file.kind === 'image' ? file.path : render(file.path, page, options.outDir, file.id);
        const mime = /\.jpe?g$/i.test(png) ? 'image/jpeg' : /\.webp$/i.test(png) ? 'image/webp' : 'image/png';
        const url = `data:${mime};base64,${readFileSync(png).toString('base64')}`;
        const response = await options.client.chat({
          stage: 'ocr',
          ref: `${file.id}:${page}`,
          provider: 'dashscope',
          model,
          temperature: 0,
          maxTokens: 6000,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url } },
                { type: 'text', text: OCR_PROMPT },
              ],
            },
          ],
        });
        if (response.finishReason === 'length') throw new Error('输出被截断');
        writeAtomic(pageFile(options.outDir, file.id, page), response.text);
        options.manifest.setPage(file.id, page, { status: 'done', cost: response.cost });
        summary.done += 1;
        if (summary.done % 20 === 0) {
          log(`[ocr] ${file.id}: 完成 ${summary.done}/${todo.length}（失败 ${summary.failed}）`);
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          summary.budgetStopped = true;
          return;
        }
        summary.failed += 1;
        options.manifest.setPage(file.id, page, { status: 'failed', error: (error as Error).message.slice(0, 200) });
        log(`[ocr] ${file.id} 第 ${page} 页失败：${(error as Error).message.slice(0, 200)}`);
      }
    },
    () => summary.budgetStopped,
  );
  options.manifest.save();
  log(`[ocr] ${file.id} 结束：新增 ${summary.done}，失败 ${summary.failed}，缓存 ${summary.cached}`);
  return summary;
}

// 把模型偶尔输出的 $$…$$（含跨行）压成单行 $…$；MathText 只允许行内公式，切条目也按行工作。
export function normalizeOcrText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').replace(/ /g, ' ');
  text = text.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, body: string) => `$${body.replace(/\s*\n\s*/g, ' ').trim()}$`);
  text = text.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, body: string) => `$${body.replace(/\s*\n\s*/g, ' ').trim()}$`);
  text = text.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_match, body: string) => `$${body.trim()}$`);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');
}

export function readPage(outDir: string, bookId: string, page: number): string | null {
  const file = pageFile(outDir, bookId, page);
  return existsSync(file) ? normalizeOcrText(readFileSync(file, 'utf8')) : null;
}
