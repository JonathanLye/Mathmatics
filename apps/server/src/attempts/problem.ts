import type { ConceptsFile, Context, ProblemPackage } from '@proof-gym/engine';

import type { Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

export interface LoadedProblem {
  ctx: Context;
  // 题面与公开配置：PublicProblemView 与层配置的来源。
  public: ProblemPackage['public'];
}

// 作答用的题目包：public 来自 content.problem_versions，secret 来自 vault.problem_secrets（入库时已剥离参考证明）。
// 已发布版本不可修改（content.freeze_published），所以按开题时的版本加载即可。
//
// redo：重做不再走第 5 层（迁移题在父作答时已经做过）。这里把第 5 层在内存里置为未启用，引擎的层路径、
// createAttempt 的 disabled 标记与响应里的 layers 都随之一致；库里的题目包不变。
export async function loadProblem(
  db: Queryable,
  problemId: string,
  version: number,
  opts: { redo?: boolean } = {},
): Promise<LoadedProblem> {
  const row = (
    await db.query<{ public: ProblemPackage['public']; secret: ProblemPackage['secret'] }>(
      `select pv.public, ps.secret
         from content.problem_versions pv
         join vault.problem_secrets ps on ps.problem_id = pv.problem_id and ps.version = pv.version
        where pv.problem_id = $1 and pv.version = $2`,
      [problemId, version],
    )
  ).rows[0];
  if (!row) throw new AppError('INTERNAL', 500, `题目版本缺失：${problemId} v${version}`);

  // 只读这道题用到的概念（引擎只按 def.conceptId 查边界答案；微课另走 /lesson）：题库上千题时不必每次读全部概念。
  const wanted = [
    ...new Set(
      [row.public.def?.conceptId, row.public.frame?.lessonId, ...(row.public.concepts ?? [])].filter(
        (id): id is string => typeof id === 'string' && id !== '',
      ),
    ),
  ];
  const concepts = await db.query<{ body: unknown }>(
    `select distinct on (id) body from content.concepts where id = any($1::text[]) order by id, version desc`,
    [wanted],
  );
  const pub: ProblemPackage['public'] = opts.redo
    ? { ...row.public, layers: { ...row.public.layers, L5: { ...row.public.layers.L5, enabled: false } } }
    : row.public;
  return {
    ctx: {
      pkg: { public: pub, secret: row.secret } as ProblemPackage,
      concepts: { concepts: concepts.rows.map((c) => c.body) } as ConceptsFile,
    },
    public: pub,
  };
}
