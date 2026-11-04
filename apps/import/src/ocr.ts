import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OcrPage {
  page: number;
  text: string;
}

const PAGE_FILE = /^(?:page-?)?(\d+)\.(?:md|txt)$/i;

// 离线 OCR：fixture 目录下放 page-027.md / 27.txt 等；真实 SimpleTex/Qwen provider 属 P1（10 §2 S3）。
export function readFixturePages(dir: string): OcrPage[] {
  if (!existsSync(dir)) throw new Error(`OCR fixture 目录不存在：${dir}`);
  const pages: OcrPage[] = [];
  for (const name of readdirSync(dir)) {
    const match = PAGE_FILE.exec(name);
    if (!match) continue;
    pages.push({ page: Number(match[1]), text: readFileSync(join(dir, name), 'utf8') });
  }
  pages.sort((a, b) => a.page - b.page);
  if (pages.length === 0) throw new Error(`OCR fixture 目录里没有 page-*.md/txt：${dir}`);
  return pages;
}

export function writeOcrPages(dir: string, pages: OcrPage[]): void {
  const target = join(dir, 'ocr');
  mkdirSync(target, { recursive: true });
  for (const page of pages) {
    writeFileSync(join(target, `page-${String(page.page).padStart(3, '0')}.md`), page.text);
  }
}

export function copyFixturePages(dir: string, fixtureDir: string): OcrPage[] {
  const pages = readFixturePages(fixtureDir);
  writeOcrPages(dir, pages);
  cpSync(fixtureDir, join(dir, 'ocr-fixture'), { recursive: true });
  return pages;
}

export function readOcrPages(dir: string): OcrPage[] {
  const ocrDir = join(dir, 'ocr');
  if (!existsSync(ocrDir)) throw new Error(`任务缺少 OCR 输出：${ocrDir}`);
  const pages: OcrPage[] = [];
  for (const name of readdirSync(ocrDir)) {
    const match = /^page-(\d+)\.md$/.exec(name);
    if (!match) continue;
    pages.push({ page: Number(match[1]), text: readFileSync(join(ocrDir, name), 'utf8') });
  }
  pages.sort((a, b) => a.page - b.page);
  return pages;
}
