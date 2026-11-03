import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// 10 §2 S2：pdftoppm -r 200 -png。本机没有 poppler 时不阻塞流水线（fixture 模式可跳过渲染）。
export interface RenderResult {
  rendered: boolean;
  reason?: string;
}

function hasPdftoppm(): boolean {
  const probe = spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' });
  return probe.error === undefined;
}

export function renderPdf(file: string, pages: number[], dir: string): RenderResult {
  if (file.startsWith('-')) throw new Error('PDF 路径不能以 - 开头（避免被 pdftoppm 当作选项）');
  if (!hasPdftoppm()) {
    return { rendered: false, reason: '未找到 pdftoppm（poppler-utils）；请安装后重试，或用 --skip-render / OCR fixture 模式' };
  }
  const pagesDir = join(dir, 'pages');
  mkdirSync(pagesDir, { recursive: true });
  for (const page of pages) {
    const out = join(pagesDir, `page-${String(page).padStart(3, '0')}`);
    const result = spawnSync(
      'pdftoppm',
      ['-f', String(page), '-l', String(page), '-r', '200', '-png', '-singlefile', file, out],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) return { rendered: false, reason: `pdftoppm 失败（第 ${page} 页）：${result.stderr}` };
  }
  return { rendered: true };
}
