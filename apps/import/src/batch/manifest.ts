import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SourceFile } from './walk.ts';

// manifest.json：断点续传的总账。真正的缓存是每页/每题的文件；这里记录状态、成本与错误，
// 让 --resume 与报告不用重新扫一遍缓存。写入走“临时文件 + rename”，崩溃不会留下半个文件。
export type Status = 'pending' | 'done' | 'failed' | 'skipped';

export interface ItemRecord {
  status: Status;
  stage?: string;
  reason?: string;
  cost?: number;
  // 这道题是哪个模型写的、哪个模型查的。第二模型核验暂停期间靠它找出以后要补查的题。
  writtenBy?: string;
  checkedBy?: string;
  source?: string;
  pages?: number[];
}

export interface PageRecord {
  status: Status;
  cost?: number;
  error?: string;
}

export interface ManifestData {
  version: 1;
  createdAt: string;
  updatedAt: string;
  files: Record<string, Omit<SourceFile, 'path'> & { status: Status }>;
  pages: Record<string, Record<string, PageRecord>>;
  items: Record<string, ItemRecord>;
  stages: Record<string, { finishedAt?: string; note?: string }>;
}

export function emptyManifest(now: Date = new Date()): ManifestData {
  return {
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    files: {},
    pages: {},
    items: {},
    stages: {},
  };
}

export class Manifest {
  readonly path: string;
  data: ManifestData;
  private dirty = 0;

  constructor(outDir: string) {
    this.path = join(outDir, 'manifest.json');
    mkdirSync(dirname(this.path), { recursive: true });
    this.data = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, 'utf8')) as ManifestData)
      : emptyManifest();
  }

  registerFile(file: SourceFile): void {
    const previous = this.data.files[file.id];
    this.data.files[file.id] = {
      id: file.id,
      relPath: file.relPath,
      kind: file.kind,
      pages: file.pages,
      ...(file.skipped === undefined ? {} : { skipped: file.skipped }),
      status: file.skipped !== undefined ? 'skipped' : (previous?.status ?? 'pending'),
    };
    this.touch();
  }

  setPage(fileId: string, page: number, record: PageRecord): void {
    const pages = (this.data.pages[fileId] ??= {});
    pages[String(page)] = record;
    this.touch();
  }

  setItem(itemId: string, record: ItemRecord): void {
    this.data.items[itemId] = { ...this.data.items[itemId], ...record };
    this.touch();
  }

  stageDone(stage: string, note?: string): void {
    this.data.stages[stage] = { finishedAt: new Date().toISOString(), ...(note === undefined ? {} : { note }) };
    this.save();
  }

  private touch(): void {
    this.dirty += 1;
    if (this.dirty >= 25) this.save();
  }

  save(): void {
    this.data.updatedAt = new Date().toISOString();
    const temp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(this.data, null, 1)}\n`);
    renameSync(temp, this.path);
    this.dirty = 0;
  }
}
