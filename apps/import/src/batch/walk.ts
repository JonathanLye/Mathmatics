import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

// 目录遍历：PDF（逐页渲染）、图片（每张一页）、Markdown/文本（跳过 OCR）。
// 跟随软链，方便用一个只放软链的目录指向教辅 PDF，而不把 PDF 复制进任何可能被提交的位置。
export type SourceKind = 'pdf' | 'image' | 'text';

export interface SourceFile {
  id: string;
  path: string;
  relPath: string;
  kind: SourceKind;
  pages: number;
  skipped?: string;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const TEXT_EXT = new Set(['.md', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

// 文件名本身是 ASCII 短名时直接当书目 ID（缓存目录更好认），否则用路径哈希。
export function sourceIdOf(relPath: string): string {
  const stem = basename(relPath, extname(relPath));
  if (/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(stem)) return stem;
  return `src-${createHash('sha256').update(relPath).digest('hex').slice(0, 8)}`;
}

export interface PdfProbe {
  pages: number;
  error?: string;
}

// 加密 PDF：只识别并跳过，绝不尝试绕过密码。
export function probePdf(file: string): PdfProbe {
  if (basename(file).startsWith('-')) return { pages: 0, error: '文件名以 - 开头' };
  const result = spawnSync('pdfinfo', [file], { encoding: 'utf8', timeout: 60_000 });
  if (result.error !== undefined) return { pages: 0, error: '未找到 pdfinfo（poppler-utils）' };
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/Incorrect password|password/i.test(output)) return { pages: 0, error: '受密码保护，已跳过（不尝试绕过）' };
  const match = /^Pages:\s+(\d+)/m.exec(output);
  if (match === null) return { pages: 0, error: 'pdfinfo 读不出页数' };
  return { pages: Number(match[1]) };
}

export function walkSources(
  dir: string,
  options: { probe?: (file: string) => PdfProbe; ids?: Record<string, string> } = {},
): SourceFile[] {
  const probe = options.probe ?? probePdf;
  const out: SourceFile[] = [];
  const visit = (current: string): void => {
    const names = readdirSync(current).sort();
    for (const name of names) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        visit(full);
        continue;
      }
      const ext = extname(name).toLowerCase();
      const relPath = relative(dir, full);
      const id = options.ids?.[relPath] ?? sourceIdOf(relPath);
      if (ext === '.pdf') {
        const info = probe(full);
        out.push({
          id,
          path: full,
          relPath,
          kind: 'pdf',
          pages: info.pages,
          ...(info.error === undefined ? {} : { skipped: info.error }),
        });
      } else if (IMAGE_EXT.has(ext)) {
        out.push({ id, path: full, relPath, kind: 'image', pages: 1 });
      } else if (TEXT_EXT.has(ext)) {
        out.push({ id, path: full, relPath, kind: 'text', pages: 1 });
      }
    }
  };
  visit(dir);
  return out;
}

export function readTextSource(file: SourceFile): string {
  return readFileSync(file.path, 'utf8');
}
