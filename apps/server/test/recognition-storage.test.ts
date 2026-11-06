import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { probeStorageDir } from '../src/recognition/storage.ts';

describe('probeStorageDir', () => {
  it('目录不存在时创建并返回 ok', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pg-storage-')), 'a', 'b');
    expect(await probeStorageDir(dir)).toEqual({ ok: true });
  });

  it('路径被普通文件挡住：ok=false 并带原因', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pg-storage-'));
    writeFileSync(join(base, 'file'), 'x');
    const result = await probeStorageDir(join(base, 'file', 'photos'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe('');
  });

  it.skipIf(process.getuid?.() === 0)('目录存在但不可写（只读，非 root）：ok=false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-storage-'));
    chmodSync(dir, 0o500);
    try {
      expect((await probeStorageDir(dir)).ok).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
