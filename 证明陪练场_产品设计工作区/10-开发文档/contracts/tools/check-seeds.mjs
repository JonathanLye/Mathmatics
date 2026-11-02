// 题目包发布门禁（参考实现）：schema 校验 + KaTeX 可渲染 + 规则自测 + 穷举泄题检查。
// 用法：cd contracts && npm i && node tools/check-seeds.mjs [seed/*.json]
// 服务端的导入流水线发布前必须跑同样的检查（10-题库导入流水线.md §6）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canon, splitMath } from './canon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'seed')).filter(f => f.endsWith('.json') && f !== 'concepts.json' && !f.includes('events')).map(f => path.join('seed', f));

let failures = 0;
const fail = (where, msg) => { failures++; console.log(`  ✗ ${where}: ${msg}`); };

// ---------- 0. canon 回归用例（服务端 packages/engine/canon 必须产出相同结果） ----------
const CANON_CASES = [
  ['$|a_n-3|=\\frac{5}{n+2}$', '|a_n-3|=5/(n+2)'],
  ['|a_n − 3| = 5/(n+2)', '|a_n-3|=5/(n+2)'],
  ['任取 $\\varepsilon>0$，取 $N=\\left\\lceil \\frac{5}{\\varepsilon}\\right\\rceil$', '任取ε>0,取N=⌈5/ε⌉'],
  ['$\\displaystyle\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$', 'lim_(n→∞)(3n+1)/(n+2)=3'],
  ['$\\frac{1}{\\sqrt{n+1}}<\\frac{1}{\\sqrt{n}}$', '1/√(n+1)<1/√n'],
  ['$\\sum_{n=1}^{\\infty}\\frac{(-1)^{n-1}}{\\sqrt n}$', '∑_(n=1)^∞(-1)^(n-1)/√n'],
  ['u_{n+1} ≤ u_n', 'u_(n+1)≤u_n'],
  ['$\\sum|a_n|=\\sum\\frac{1}{n^2}$', '∑|a_n|=∑1/n^2'],
  ['x² 与 $x^{2}$', 'x^2与x^2'],
  ['∀ε>0，∃N，∀n>N，|a_n−A|<ε', '∀ε>0,∃N,∀n>N,|a_n-A|<ε'],
  ['价格 \\$5', '价格$5'],
  ['$5 \\over n+2$', '5/(n+2)'],
  ['$a \\div b$', 'a/b'],
  ['N >= 5/ε', 'N≥5/ε'],
  ['a != b', 'a≠b'],
  ['a -> b', 'a→b'],
];
for (const [inp, out] of CANON_CASES) if (canon(inp) !== out) fail('canon', `${JSON.stringify(inp)} → ${canon(inp)}，应为 ${out}`);

// ---------- 1. schema ----------
const { default: Ajv2020 } = await import('ajv/dist/2020.js');
const { default: addFormats } = await import('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const vPkg = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, 'problem-package.schema.json'), 'utf8')));
const vCon = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, 'concept.schema.json'), 'utf8')));
const concepts = JSON.parse(fs.readFileSync(path.join(root, 'seed/concepts.json'), 'utf8'));
if (!vCon(concepts)) fail('concepts.json', ajv.errorsText(vCon.errors));

// ---------- 2. KaTeX ----------
const { default: katex } = await import('katex');
function katexOk(where, text) {
  splitMath(text).forEach((p, i) => {
    if (!p.math || !p.s.trim()) return;
    try { katex.renderToString(p.s, { throwOnError: true, strict: 'ignore', trust: false }); }
    catch (e) { fail(where, `KaTeX 无法渲染 $${p.s}$：${e.message.split('\n')[0]}`); }
  });
}
function walkStrings(obj, where, fn) {
  if (typeof obj === 'string') return fn(where, obj);
  if (Array.isArray(obj)) return obj.forEach((x, i) => walkStrings(x, `${where}[${i}]`, fn));
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) {
    if (['patterns', 'leak', 'triggers', 'expr', 'jev', 'label', 'code', 'map', 'file', 'id'].includes(k)) continue;
    walkStrings(v, `${where}.${k}`, fn);
  }
}
walkStrings(concepts, 'concepts', katexOk);
// 证明键盘：每个插入片段（占位符换成 x）都必须能被 KaTeX 渲染
const kb = JSON.parse(fs.readFileSync(path.join(root, 'keyboard-layout.json'), 'utf8'));
for (const layer of kb.layers) for (const row of layer.rows) for (const key of row) {
  for (const ins of [key.insert, ...(key.variants ?? [])]) {
    const filled = ins.replace(/#\d/g, 'x');
    katexOk(`keyboard.${layer.id}.${key.label}`, key.mode === 'math' ? `$${filled}$` : filled);
  }
}

// ---------- 3/4. 每个题目包 ----------
const leakHit = (text, frags) => { const c = canon(text); return frags.filter(f => c.includes(f) || c.includes(canon(f))); };
// 回归：\over 等价写法与已 canon 片段都必须被闸门规则层识别（防 canon 盲区/二次 canon）
if (!leakHit('$|a_n-3|={5 \\over n+2}$', ['5/(n+2)']).length) fail('gate-probe', '\\over 等价写法未被识别为泄题');
if (!leakHit('u_{n+1}', ['u_(n+1)']).length) fail('gate-probe', '已 canon 的 leak 片段未被识别');

for (const file of files) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  console.log(`${file}  (${pkg.id} v${pkg.version})`);
  if (!vPkg(pkg)) { fail(file, ajv.errorsText(vPkg.errors)); continue; }
  const S = pkg.secret, P = pkg.public;
  if (P.layers.L1.enabled && (!P.def || !S.def)) fail(file, 'L1 启用但缺 def');
  if (P.layers.L2.enabled && (!P.frame || !S.frame)) fail(file, 'L2 启用但缺 frame');
  if (P.keyCount !== S.keys.length) fail(file, `keyCount=${P.keyCount} 与 keys.length=${S.keys.length} 不一致`);
  walkStrings(P, 'public', katexOk);
  walkStrings(S, 'secret', katexOk);

  const keyIds = new Set(S.keys.map(k => k.id));
  for (const r of S.routes) for (const id of r) if (!keyIds.has(id)) fail(file, `route 引用了不存在的 ${id}`);
  for (const k of S.keys) {
    const lv = k.hints.map(h => h.level).join(',');
    if (lv !== 'H0,H1,H2,H3,H4') fail(`${k.id}`, `提示级别应为 H0..H4，实际 ${lv}`);
    const cost = k.hints.map(h => h.cost).join(',');
    if (cost !== '0,0,0.5,1,1') fail(`${k.id}`, `透露量应为 0,0,0.5,1,1，实际 ${cost}`);
    for (const p of k.patterns) { try { new RegExp(p, 'u'); } catch (e) { fail(`${k.id}.pattern`, e.message); } }
    // 规则自测：样例必须命中本步骤、不得命中任何错误类型
    for (const ex of k.examples ?? []) {
      const c = canon(ex);
      if (!k.patterns.some(p => new RegExp(p, 'u').test(c))) fail(`${k.id}.examples`, `样例未命中本步骤：${ex}  →  ${c}`);
      const err = S.errors.find(e => e.patterns.some(p => new RegExp(p, 'u').test(c)));
      if (err) fail(`${k.id}.examples`, `样例被错误类型 ${err.id} 截走：${ex}`);
    }
  }

  // 片段不得是题面的子串：否则闸门会拦下引用题面的提示，DTO 泄露扫描也会误报
  const stemC = canon(P.stem);
  for (const k of S.keys) for (const f of k.leak) if (stemC.includes(canon(f))) fail(`${k.id}.leak`, `片段 "${f}" 是题面的一部分，不能作为泄题片段`);
  // 穷举泄题：按"文本可能出现的时刻"计算当时允许出现的片段
  const allLeaks = S.keys.flatMap(k => k.leak.map(f => ({ key: k.id, f })));
  const check = (where, text, matched = new Set(), allow = []) => {
    const frags = allLeaks.filter(x => !matched.has(x.key) && !allow.includes(x.key)).map(x => x.f);
    const hit = leakHit(text, frags);
    if (hit.length) fail(where, `泄题片段 ${JSON.stringify(hit)} 出现在：${text}`);
  };
  // (a) 第 3 层之前或随时可能出现的文本：一个关键步骤都没写出
  const early = [];
  if (P.def) early.push(['public.def.task', P.def.task]);
  if (P.frame) early.push(['public.frame.task', P.frame.task], ['public.frame.template', P.frame.template]);
  (P.askChips ?? []).forEach((t, i) => early.push([`askChips[${i}]`, t]));
  (S.def?.components ?? []).forEach(c => early.push([`def.${c.id}.missing`, c.missing]));
  if (S.def?.orderQuestion) early.push(['def.orderQuestion', S.def.orderQuestion]);
  (S.frame?.checks ?? []).forEach(c => early.push([`frame.${c.id}.missing`, c.missing]));
  S.errors.forEach(e => early.push([`errors.${e.id}.question`, e.question]));
  const conceptIds = new Set([...(P.concepts ?? []), P.def?.conceptId, P.frame?.lessonId].filter(Boolean));
  for (const con of concepts.concepts.filter(c => conceptIds.has(c.id))) walkStrings({ card: con.card, lesson: con.lesson }, `concept:${con.id}`, (w, t) => early.push([w, t]));
  concepts.glossary.forEach(g => early.push([`glossary.${g.id}`, g.answer]));
  for (const [w, t] of early) check(w, t);
  // (b) 提示：按每条路线的顺序，前面的关键步骤视为已写出；H3/H4 允许出现本步骤片段
  for (const route of S.routes) route.forEach((id, i) => {
    const k = S.keys.find(x => x.id === id);
    const matched = new Set(route.slice(0, i));
    k.hints.forEach(h => check(`${id}.${h.level}`, h.text, matched, h.cost === 1 ? [id] : []));   // 只有 H3/H4（透露量 1）可以出现本步骤的片段；H2 只指方向
  });
  // (c) 自检、总结：链条已闭合，任一路线全部写出（只要求不出现路线外步骤的片段）
  for (const route of S.routes) {
    const all = new Set(route);
    S.selfcheckBank.forEach(q => check(`selfcheck.${q.id}`, q.template, all));
    S.summaryPoints.forEach(q => check(`summary.${q.id}`, q.question, all));
  }
  if (!failures) console.log('  ✓ schema / KaTeX / 规则自测 / 穷举泄题');
}
console.log(failures ? `\n${failures} 处不通过` : '\n全部通过');
process.exit(failures ? 1 : 0);
