import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

// tools/sync-contracts.mjs 的回归测试（#63）：副本目录里出现 node_modules（任意层级）时，
// --check 不能把依赖文件当成「多余」而失败；它们不是契约源的一部分。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACTS = path.join(repoRoot, 'packages', 'contracts');
const FIXTURE_DIR = '__sync_contracts_fixture__';

// 记录需要清理的 (containingDir, nodeModulesExistedBefore)。
const created: Array<{ dir: string; keepNodeModules: boolean }> = [];

function addNodeModulesFixture(rel: string): void {
  const dir = rel === '.' ? CONTRACTS : path.join(CONTRACTS, rel);
  const nodeModules = path.join(dir, 'node_modules');
  const existed = existsSync(nodeModules);
  mkdirSync(path.join(nodeModules, FIXTURE_DIR), { recursive: true });
  writeFileSync(path.join(nodeModules, FIXTURE_DIR, 'junk.txt'), '// test fixture\n');
  created.push({ dir, keepNodeModules: existed });
}

afterEach(() => {
  for (const { dir, keepNodeModules } of created.splice(0)) {
    const nodeModules = path.join(dir, 'node_modules');
    rmSync(path.join(nodeModules, FIXTURE_DIR), { recursive: true, force: true });
    if (!keepNodeModules) rmSync(nodeModules, { recursive: true, force: true });
  }
});

function runCheck(): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, ['tools/sync-contracts.mjs', '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('tools/sync-contracts.mjs --check（#63）', () => {
  it('基线：工作区同步时通过', () => {
    const result = runCheck();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('顶层 packages/contracts/node_modules 存在时仍通过', () => {
    addNodeModulesFixture('.');
    const result = runCheck();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('子目录里的 node_modules 存在时仍通过', () => {
    addNodeModulesFixture('seed');
    const result = runCheck();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
