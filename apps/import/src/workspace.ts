import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 本地产物目录（不进仓库）：imports/<jobId>/...；教辅 PDF 不入库（AGENTS §3）。
export interface JobManifest {
  jobId: string;
  file: string;
  sha256: string;
  pages: number[];
  createdAt: string;
  stages: {
    register: boolean;
    render: boolean;
    renderNote?: string;
    ocr: boolean;
    ocrProvider?: string;
    items?: boolean;
    drafts?: string[];
  };
}

const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAGES = 2000;

export function importsRoot(): string {
  return process.env.IMPORT_ROOT ?? join(process.cwd(), 'imports');
}

export function assertJobId(jobId: string): string {
  // jobId 会拼进文件路径：必须是白名单字符，避免 ../ 逃出 imports/（A 复审 P3-8）。
  if (!JOB_ID.test(jobId)) throw new Error(`jobId 不合法：${jobId}（只允许字母数字下划线和短横线）`);
  return jobId;
}

export function jobDir(jobId: string): string {
  return join(importsRoot(), assertJobId(jobId));
}

export function newJobId(): string {
  return `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

// 流式哈希：避免整本 PDF 一次性读入内存（A 复审 P3-4）。
export function sha256File(file: string): string {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

// 10 §6：`--pages 27-58`，支持逗号分隔（27-30,35）。
export function parsePageRange(spec: string): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
    if (!match) throw new Error(`页码范围不合法：${trimmed}`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new Error(`页码范围不合法：${trimmed}`);
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  if (pages.size > MAX_PAGES) throw new Error(`页码过多（${pages.size} > ${MAX_PAGES}）`);
  return [...pages].sort((a, b) => a - b);
}

export function writeJob(manifest: JobManifest): void {
  const dir = jobDir(manifest.jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readJob(jobId: string): JobManifest {
  const file = join(jobDir(jobId), 'job.json');
  if (!existsSync(file)) throw new Error(`找不到任务 ${jobId}（${file}）`);
  return JSON.parse(readFileSync(file, 'utf8')) as JobManifest;
}
