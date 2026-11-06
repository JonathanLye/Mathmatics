import { gzipSync } from 'node:zlib';

import { replayReferenceProof, splitProofLines } from '@proof-gym/content-checks';
import { createAttempt, step, type ProblemPackage } from '@proof-gym/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProblem } from '../src/attempts/problem.ts';
import { migrate, openDb, type Db } from '../src/db/index.ts';
import { importBundle, parseBundle, SERVICE_REVIEWER_CODE } from '../src/db/import-bundle.ts';

function hints(texts: string[]): ProblemPackage['secret']['keys'][number]['hints'] {
  const levels = ['H0', 'H1', 'H2', 'H3', 'H4'] as const;
  const costs = [0, 0, 0.5, 1, 1] as const;
  return levels.map((level, index) => ({
    level,
    text: texts[index] as string,
    cost: costs[index] as 0 | 0.5 | 1,
    ...(level === 'H4' ? { handsBack: true } : {}),
  })) as ProblemPackage['secret']['keys'][number]['hints'];
}

function pkg(id: string, title = '用定义证明 a/n 趋于 0'): ProblemPackage {
  const off = { enabled: false };
  return {
    schemaVersion: '1.0',
    id,
    version: 1,
    kind: 'main',
    public: {
      title,
      stem: '设 $a>0$，用定义证明 $\\lim_{n\\to\\infty}\\frac{a}{n}=0$。',
      chapter: '第二章 数列极限',
      difficulty: 2,
      role: 'optional',
      layers: { L1: off, L2: off, L3: { enabled: true }, L4: off, L5: off, L6: { enabled: true } },
      keyCount: 2,
      budget: { reveal: 2 },
    },
    secret: {
      keys: [
        {
          id: 'K1',
          kind: 'core',
          label: '取 N',
          patterns: ['N[=≥].{0,12}a/ε', 'n>a/ε'],
          examples: ['取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$', '只要 $n>\\frac{a}{\\varepsilon}$'],
          leak: ['a/ε'],
          hints: hints(['$N$ 依赖什么？', '$N$ 只依赖 $\\varepsilon$。', '从目标解出 $n$ 的下界。', '解出 $n$。', '取 $N=\\frac{a}{\\varepsilon}$。下一行由你写。']),
        },
        {
          id: 'K2',
          kind: 'formal',
          label: '收尾',
          deps: ['K1'],
          patterns: ['n>N.{0,30}<ε', '当n>N时.{0,30}<ε'],
          examples: ['当 $n>N$ 时，$\\frac{a}{n}<\\varepsilon$', '对 $n>N$ 有 $\\left|\\frac{a}{n}\\right|<\\varepsilon$'],
          leak: [],
          hints: hints(['最后落到哪里？', '写出不等式。', '接成一条链。', '当 $n>N$ 时小于 $\\varepsilon$。', '写出结论。下一行由你写。']),
        },
      ],
      routes: [['K1', 'K2']],
      errors: [],
      allowedTheorems: [],
      forbiddenTheorems: [],
      selfcheckBank: [],
      summaryPoints: [{ id: 'S1', patterns: ['定义'], question: '关键是什么？' }],
      referenceProofs: [
        {
          id: 'P1',
          route: 0,
          text: '任取 $\\varepsilon>0$，取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。\n当 $n>N$ 时，$\\frac{a}{n}<\\varepsilon$。',
          publishable: true,
        },
      ],
      walkthrough: { approach: '让绝对值小于任意给定的 ε，由此解出 N 的取法。', keyIdeas: ['$N$ 只依赖 $\\varepsilon$。'], pitfalls: [] },
    },
    review: { status: 'published' },
    provenance: { importJobId: 'batch-test', draftedBy: ['m'], arbiter: 'v', promptVersion: 'imp' },
  } as ProblemPackage;
}

function problemLine(p: ProblemPackage, hash = `hash-${p.id}`) {
  return { type: 'problem', contentHash: hash, quality: 0.9, band: 'easy', pathEligible: true, unit: { chapterNo: 2, unitNo: 101 }, pkg: p };
}

function unitLine(items: string[]) {
  return { type: 'unit', chapterNo: 2, unitNo: 101, title: '数列极限概念', summary: '本节练习区有 2 道证明题。', conceptIds: [], sort: 2101, items };
}

const HEADER = { type: 'header', batchId: 'batch-test', course: { id: 'math-analysis', title: '数学分析' } };

let db: Db;

beforeEach(async () => {
  db = await openDb({ pgliteDir: 'memory' });
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

describe('import-bundle（U16）', () => {
  it('写入题目、版本、密钥、审核记录、单元；标 review_source=auto 并发布', async () => {
    const summary = await importBundle(db, [HEADER, unitLine(['imp-a', 'imp-b']), problemLine(pkg('imp-a')), problemLine(pkg('imp-b'))]);
    expect(summary).toMatchObject({ inserted: 2, newVersions: 0, unchanged: 0, rejected: [], units: 1, unitItems: 2 });

    const version = (
      await db.query<{ review_status: string; review_source: string; published_at: unknown; provenance: { contentHash: string }; auto_checks: Record<string, boolean>; reviewed_by: string }>(
        `select review_status, review_source, published_at, provenance, auto_checks, reviewed_by from content.problem_versions where problem_id = 'imp-a'`,
      )
    ).rows[0];
    expect(version?.review_status).toBe('published');
    expect(version?.review_source).toBe('auto');
    expect(version?.published_at).not.toBeNull();
    expect(version?.provenance.contentHash).toBe('hash-imp-a');
    expect(version?.auto_checks).toMatchObject({ schema: true, katex: true, leakExhaustive: true, patternSelfTest: true });

    const problem = (await db.query<{ current_version: number; hidden_at: unknown }>(`select current_version, hidden_at from content.problems where id = 'imp-a'`)).rows[0];
    expect(problem).toEqual({ current_version: 1, hidden_at: null });

    // 解题思路在 secret 里（vault），不在 public 里；参考证明单独存。
    const secret = (await db.query<{ secret: ProblemPackage['secret'] }>(`select secret from vault.problem_secrets where problem_id = 'imp-a'`)).rows[0]?.secret;
    expect(secret?.walkthrough?.keyIdeas.length).toBe(1);
    expect(secret?.referenceProofs).toBeUndefined();
    const publicPart = (await db.query<{ public: Record<string, unknown> }>(`select public from content.problem_versions where problem_id = 'imp-a'`)).rows[0]?.public;
    expect(JSON.stringify(publicPart)).not.toContain('keyIdeas');
    const proofs = await db.query(`select proof_id from vault.reference_proofs where problem_id = 'imp-a'`);
    expect(proofs.rows).toHaveLength(1);

    const reviews = await db.query<{ decision: string }>(`select decision from content.review_records where problem_id = 'imp-a'`);
    expect(reviews.rows).toEqual([{ decision: 'approve' }]);

    const units = await db.query<{ title: string; chapter_no: number; unit_no: number; n: number }>(
      `select u.title, u.chapter_no, u.unit_no, count(i.problem_id)::int as n
         from content.course_units u join content.unit_items i on i.unit_id = u.id
        where u.course_id = 'math-analysis' group by u.id`,
    );
    expect(units.rows).toEqual([{ title: '数列极限概念', chapter_no: 2, unit_no: 101, n: 2 }]);
  });

  it('服务审核账号：教师角色但已禁用，没有登录凭据', async () => {
    await importBundle(db, [HEADER, problemLine(pkg('imp-a'))]);
    const user = (await db.query<{ id: string; role: string; status: string }>(`select id, role, status from app.users where anon_code = $1`, [SERVICE_REVIEWER_CODE])).rows[0];
    expect(user).toMatchObject({ role: 'teacher', status: 'disabled' });
    const accounts = await db.query(`select 1 from app.teacher_accounts where user_id = $1`, [user?.id]);
    expect(accounts.rows).toHaveLength(0);
  });

  it('幂等：同内容重复导入什么都不变', async () => {
    const lines = [HEADER, unitLine(['imp-a']), problemLine(pkg('imp-a'))];
    await importBundle(db, lines);
    const again = await importBundle(db, lines);
    expect(again).toMatchObject({ inserted: 0, newVersions: 0, unchanged: 1, rejected: [] });
    const versions = await db.query(`select version from content.problem_versions where problem_id = 'imp-a'`);
    expect(versions.rows).toHaveLength(1);
    const reviews = await db.query(`select 1 from content.review_records where problem_id = 'imp-a'`);
    expect(reviews.rows).toHaveLength(1);
    const items = await db.query(`select 1 from content.unit_items`);
    expect(items.rows).toHaveLength(1);
  });

  it('内容变了发新版本，旧版本不动；教师下架不被导入覆盖', async () => {
    await importBundle(db, [HEADER, problemLine(pkg('imp-a'))]);
    await db.query(`update content.problems set hidden_at = now() where id = 'imp-a'`);
    const summary = await importBundle(db, [HEADER, problemLine(pkg('imp-a', '换了标题'), 'hash-2')]);
    expect(summary.newVersions).toBe(1);
    const versions = await db.query<{ version: number; title: string }>(
      `select version, public->>'title' as title from content.problem_versions where problem_id = 'imp-a' order by version`,
    );
    expect(versions.rows).toEqual([
      { version: 1, title: '用定义证明 a/n 趋于 0' },
      { version: 2, title: '换了标题' },
    ]);
    const problem = (await db.query<{ current_version: number; hidden_at: unknown }>(`select current_version, hidden_at from content.problems where id = 'imp-a'`)).rows[0];
    expect(problem?.current_version).toBe(2);
    expect(problem?.hidden_at).not.toBeNull();
  });

  it('修 publish.ts 的老坑：同内容的版本还停在草稿时，导入把它发布', async () => {
    await importBundle(db, [HEADER, problemLine(pkg('imp-a'))]);
    await db.query(`update content.problem_versions set review_status = 'draft' where problem_id = 'imp-a'`);
    await importBundle(db, [HEADER, problemLine(pkg('imp-a'))]);
    const row = (await db.query<{ review_status: string; review_source: string }>(`select review_status, review_source from content.problem_versions where problem_id = 'imp-a'`)).rows[0];
    expect(row).toEqual({ review_status: 'published', review_source: 'auto' });
  });

  it('服务端再跑门禁：走不通的题被拒绝且不进单元，其它题不受影响', async () => {
    const bad = pkg('imp-bad');
    (bad.secret.keys[0] as { patterns: string[] }).patterns = ['不可能命中甲', '不可能命中乙'];
    bad.secret.keys[0]!.examples = [];
    const summary = await importBundle(db, [HEADER, unitLine(['imp-a', 'imp-bad']), problemLine(pkg('imp-a')), problemLine(bad)]);
    expect(summary.inserted).toBe(1);
    expect(summary.rejected.map((entry) => entry.problemId)).toEqual(['imp-bad']);
    const rows = await db.query(`select 1 from content.problems where id = 'imp-bad'`);
    expect(rows.rows).toHaveLength(0);
    const items = await db.query<{ problem_id: string }>(`select problem_id from content.unit_items`);
    expect(items.rows).toEqual([{ problem_id: 'imp-a' }]);
  });

  it('重新导入时不再入选的题从路径单元里移除，但题还在练习区', async () => {
    await importBundle(db, [HEADER, unitLine(['imp-a', 'imp-b']), problemLine(pkg('imp-a')), problemLine(pkg('imp-b'))]);
    await importBundle(db, [HEADER, unitLine(['imp-b']), problemLine(pkg('imp-a')), problemLine(pkg('imp-b'))]);
    const items = await db.query<{ problem_id: string }>(`select problem_id from content.unit_items`);
    expect(items.rows).toEqual([{ problem_id: 'imp-b' }]);
    const problem = await db.query(`select 1 from content.problems where id = 'imp-a'`);
    expect(problem.rows).toHaveLength(1);
  });

  it('解析：gzip 与纯文本都认；没有 header 报错', async () => {
    const text = `${JSON.stringify(HEADER)}\n${JSON.stringify(unitLine([]))}\n`;
    expect(parseBundle(Buffer.from(text))).toHaveLength(2);
    expect(parseBundle(gzipSync(text))).toHaveLength(2);
    await expect(importBundle(db, [unitLine([])])).rejects.toThrow('header');
  });

  it('导入后，服务端加载题目包，学生走引擎能开题并做完（只有 L3、L6）', async () => {
    await importBundle(db, [HEADER, problemLine(pkg('imp-a'))]);
    const loaded = await loadProblem(db, 'imp-a', 1);
    const proofRow = (await db.query<{ text: string }>(`select text from vault.reference_proofs where problem_id = 'imp-a'`)).rows[0];
    let state = createAttempt(loaded.ctx, 0);
    expect(state.layer).toBe(3);
    splitProofLines(proofRow?.text ?? '').forEach((line, index) => {
      state = step(loaded.ctx, state, { kind: 'line.submit', lineId: `L${index}`, s: line, j: '', provenance: 'keyboard' }, 1000 * (index + 1)).state;
    });
    state = step(loaded.ctx, state, { kind: 'finish.try' }, 9000).state;
    expect(state.layer).toBe(6);
    const done = step(loaded.ctx, state, { kind: 'summary.submit', answers: ['关键是按定义取 N。'] }, 10_000);
    expect(done.state.done).toBe(true);
  });

  it('路径可见：单元里的题已发布、未下架，能按路径查询方式查到；隐藏后查不到', async () => {
    await importBundle(db, [HEADER, unitLine(['imp-a']), problemLine(pkg('imp-a'))]);
    const visible = (): Promise<{ rows: Array<{ id: string; auto: boolean }> }> =>
      db.query<{ id: string; auto: boolean }>(
        `select p.id, pv.review_source = 'auto' as auto
           from content.unit_items i
           join content.problems p on p.id = i.problem_id and p.hidden_at is null
           join content.problem_versions pv on pv.problem_id = p.id and pv.version = p.current_version and pv.review_status = 'published'`,
      );
    expect((await visible()).rows).toEqual([{ id: 'imp-a', auto: true }]);
    await db.query(`update content.problems set hidden_at = now() where id = 'imp-a'`);
    expect((await visible()).rows).toEqual([]);
  });

  it('fixture 本身过门禁（防止测试数据过期）', () => {
    expect(replayReferenceProof(pkg('imp-a')).issues).toEqual([]);
  });
});
