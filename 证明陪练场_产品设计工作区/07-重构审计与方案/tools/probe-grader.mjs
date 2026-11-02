const root = process.argv[2];
const { gradeStep } = await import(root + '/server/ai.mjs');
const seed = await import(root + '/server/seed.mjs');
const db = seed.buildSeed ? seed.buildSeed() : null;
const mod = Object.keys(seed);
let problems = (db && db.problems) || null;
if (!problems) { for (const k of mod) { const v = seed[k]; if (typeof v === 'function') { try { const r = v(); if (r && r.problems) { problems = r.problems; break; } } catch {} } } }
const p = problems.find((x) => x.id === 'p-cond-series');
const cases = [
  ['step3 WRONG claim, keywords present', 3, '莱布尼茨判别法不适用，所以原级数发散', '因为不满足莱布尼茨条件'],
  ['step3 valid alt (Dirichlet test)', 3, '由狄利克雷判别法，原级数收敛', '部分和 Σ(-1)^{n-1} 有界，1/√n 单调趋于 0'],
  ['step1 WRONG direction', 1, 'u_n=1/√n 单调递增，因为 n+1>n', '因为 n+1>n，所以 1/√(n+1) > 1/√n'],
];
for (const [name, step, c, e] of cases) {
  const r = gradeStep({ stepIndex: step }, c, e, p);
  console.log(name, '=>', r.diagnosis.verdict, '|', r.ai.judge, '|', r.ai.hint);
}
