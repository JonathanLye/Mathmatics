import type { OcrPage } from './ocr.ts';

export interface ImportItem {
  itemId: string;
  page: number;
  chapter: string;
  label: string;
  body: string;
  proofLike: boolean;
}

// 10 §2 S4：规则为主、模型辅助。P0 CLI 用题目起始行切条目（例/习题/练习/证明题/数字编号）。
const ITEM_START = /^\s*(?:例\s*\d+|例题\s*\d*|习题\s*\d+|练习\s*\d+|证明题\s*\d*|\d+[.、])\s*/;
const CHAPTER = /第[一二三四五六七八九十0-9]+章[^\n]*/;
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function chapterOf(text: string): string {
  return CHAPTER.exec(text)?.[0]?.trim() ?? '';
}

function chapterMatches(chapter: string, wanted: string): boolean {
  if (chapter === '') return true; // 识别不出章节时不过滤，避免误删
  const asNumber = Number(wanted);
  const cn = Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 10 ? CN_NUM[asNumber] : null;
  return chapter.includes(`第${wanted}章`) || (cn !== null && chapter.includes(`第${cn}章`));
}

export function splitItems(pages: OcrPage[], options: { chapter?: string; proofOnly?: boolean } = {}): ImportItem[] {
  const items: ImportItem[] = [];
  for (const page of pages) {
    const pageChapter = chapterOf(page.text);
    const lines = page.text.split(/\r?\n/);
    let label = '';
    let body = '';
    let index = 0;
    const flush = (): void => {
      if (body.trim() === '') return;
      const full = `${label}\n${body}`.trim();
      const proofLike = /证明|试证|求证|prove|verify/i.test(full);
      items.push({
        itemId: `p${page.page}-i${index}`,
        page: page.page,
        chapter: chapterOf(full) || pageChapter,
        label: label.trim(),
        body: full,
        proofLike,
      });
      index += 1;
      label = '';
      body = '';
    };

    for (const line of lines) {
      if (ITEM_START.test(line) && body.trim() !== '') flush();
      if (ITEM_START.test(line) && label === '' && body.trim() === '') label = line;
      else body += `${line}\n`;
    }
    flush();
  }

  return items.filter((item) => {
    if (options.proofOnly === true && !item.proofLike) return false;
    if (options.chapter !== undefined && !chapterMatches(item.chapter, options.chapter)) return false;
    return true;
  });
}
