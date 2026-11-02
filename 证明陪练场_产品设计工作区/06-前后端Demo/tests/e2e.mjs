/**
 * tests/e2e.mjs —— v2 六层引导 E2E（零依赖；随机端口 + 临时 dbPath）
 * 运行：node tests/e2e.mjs  → 全 PASS 退出码 0
 * 覆盖：基础/鉴权、六层主流程（knowledge→parse→step→final→explain→variant→summary）、
 *       提示预算/软着陆、防泄题、teacher/CSV/events/admin/reset、guard 六规则。
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from '../server/server.mjs';
import { check } from '../server/guard.mjs';

const results = [];
function ok(name, cond, detail) {
  const pass = !!cond;
  results.push({ name, pass });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (pass || detail === undefined ? '' : '   => ' + JSON.stringify(detail)));
  return pass;
}
function section(title) { console.log('\n--- ' + title + ' ---'); }

const tmp = path.join(os.tmpdir(), 'mathproof-v2-e2e-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.json');
const app = createServer({ port: 0, dbPath: tmp });
const { port } = await app.start();
const B = 'http://127.0.0.1:' + port;
let TOKEN = '';
let AID = '';

async function req(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers, text };
}
const GET = (p, t) => req('GET', p, undefined, t);
const POST = (p, b, t) => req('POST', p, b === undefined ? {} : b, t);

const FINAL_TEXT = [
  '① 令 u_n = 1/√n。因为 n+1 > n，所以 1/√(n+1) < 1/√n，即 {u_n} 单调递减。',
  '② 因为 n^{1/2} → +∞，所以 1/√n → 0。',
  '③ 由莱布尼茨判别法，∑(−1)^{n−1}/√n 收敛。',
  '④ 而 ∑1/√n 是 p=1/2 的 p-级数，p≤1 故发散，所以原级数不绝对收敛。因此它是条件收敛。',
].join('\n');
const EXPLAIN_OK = '这道题要判断级数是否收敛，若是，是条件收敛还是绝对收敛。先证原级数收敛，再证绝对值级数发散。关键步骤是：用不等式说明单调递减，说明极限为 0，由莱布尼茨判别法得收敛。因为 p≤1 所以发散。结论是条件收敛。';
const STEP_DATA = [
  { conclusion: '1/√(n+1) < 1/√n，{u_n} 单调递减', evidence: '因为 n+1 > n，所以分母变大，值变小。' },
  { conclusion: 'lim 1/√n = 0', evidence: '因为 n^{1/2} → +∞，所以 1/√n 趋向 0。' },
  { conclusion: '由莱布尼茨判别法，该级数收敛', evidence: '因为前两步满足判别法的条件。' },
  { conclusion: '∑1/√n 是 p=1/2 的 p-级数，故发散', evidence: '因为 p≤1，p 级数发散。' },
  { conclusion: '所以原级数条件收敛', evidence: '因为收敛且不绝对收敛。' },
];
const PARSE_OK = {
  goal: '判断级数是否收敛，若是，是条件收敛还是绝对收敛。',
  parts: '两件：先证收敛，再证绝对值级数发散。',
  keywords: '交错级数、条件收敛、p 级数',
  tools: '莱布尼茨判别法、p 级数判别法',
};
const LEAK_PATTERNS = [/证毕/, /证明如下/, /答案是/, /综上/, /所以[^。！？\n]{0,12}成立/];

function assertNoLeak(label, text) {
  const s = JSON.stringify(text);
  ok(label + '：不含禁用泄题词', !LEAK_PATTERNS.some((re) => re.test(s)), s.slice(0, 160));
  ok(label + '：不含参考证明字段', !s.includes('referenceProof') && !s.includes('参考证明'));
}

try {
  section('一、基础、鉴权与 v2 元信息');
  const health = await GET('/api/health');
  ok('health.ok = true', health.status === 200 && health.data.ok === true, health.data);
  ok('health.version = 2.0.0', health.data.version === '2.0.0', health.data.version);
  ok('health.v2 = true', health.data.v2 === true);
  ok('health.db.students = 36 / problems = 12 / attempts = 60', health.data.db.students === 36 && health.data.db.problems === 12 && health.data.db.attempts === 60, health.data.db);
  ok('health.mode = mock', health.data.mode === 'mock');

  const meta = await GET('/api/meta');
  ok('meta.v2 = true', meta.data.v2 === true);
  ok('meta.layers 六层齐全且顺序正确', Array.isArray(meta.data.layers) && meta.data.layers.length === 6 && meta.data.layers.map((x) => x.label).join('/') === '前置知识点/题目解析/详细步骤/完整讲解/同类题/总结', meta.data.layers);
  ok('meta.budgets 与契约一致', meta.data.budgets.L1 === 3 && meta.data.budgets.L2 === 3 && meta.data.budgets.L3 === 2 && meta.data.budgets.L4 === 1 && meta.data.budgets.L0 === 6 && meta.data.budgets.xiaobai === 2);
  const routes = await GET('/api/admin/routes');
  const routePaths = (routes.data || []).map((r) => r.path);
  ok('admin/routes ≥ 25 条', Array.isArray(routes.data) && routes.data.length >= 25, routes.data && routes.data.length);
  ok('routes 含六层新端点', ['/api/problems/:id/knowledge', '/api/attempts/:id/knowledge', '/api/attempts/:id/parse', '/api/attempts/:id/step', '/api/attempts/:id/explain', '/api/attempts/:id/variant', '/api/attempts/:id/summary'].every((x) => routePaths.includes(x)));

  const badLogin = await POST('/api/login', { inviteCode: 'WRONG', studentId: 'demo' });
  ok('错误邀请码 → 401 INVALID_INVITE', badLogin.status === 401 && badLogin.data.error.code === 'INVALID_INVITE');
  ok('无 token 访问 /api/home → 401', (await GET('/api/home')).status === 401);
  const login = await POST('/api/login', { inviteCode: 'MATH-A-2026', studentId: 'demo' });
  TOKEN = login.data.token;
  ok('登录成功返回 token 与演示学生', login.status === 200 && /^t-/.test(TOKEN) && login.data.student.id === 's-demo');

  section('二、题目白名单与第 1 层：前置知识点');
  const list = await GET('/api/problems', TOKEN);
  ok('/api/problems total = 12', list.data.total === 12);
  const detail = await GET('/api/problems/p-cond-series', TOKEN);
  const detailStr = JSON.stringify(detail.data);
  ok('题目详情不含 keySteps/hints/referenceProof', !detailStr.includes('keySteps') && !detailStr.includes('referenceProof') && !('hints' in detail.data));
  const card = await GET('/api/problems/p-cond-series/knowledge', TOKEN);
  ok('GET 知识点卡：专业/高中/核对问题齐全', card.status === 200 && !!card.data.professional && !!card.data.plain && !!card.data.checkQuestion, Object.keys(card.data));
  assertNoLeak('知识点卡', card.data);

  const created = await POST('/api/attempts', { problemId: 'p-cond-series' }, TOKEN);
  AID = created.data.attemptId;
  const st0 = created.data.state;
  ok('POST /api/attempts → 201 且 state.layer=1', created.status === 201 && st0.layer === 1, created.status);
  ok('六层 layerStatus：1 active，其余 locked', st0.layerStatus && st0.layerStatus['1'] === 'active' && ['2', '3', '4', '5', '6'].every((k) => st0.layerStatus[k] === 'locked'), st0.layerStatus);
  ok('guidance 有 title/instruction/placeholder/submitLabel', !!(st0.guidance.title && st0.guidance.instruction && st0.guidance.placeholder && st0.guidance.submitLabel), st0.guidance);
  ok('第 1 层 guidance.title = 前置知识点', st0.layerLabel === '前置知识点' && /前置知识点/.test(st0.guidance.title));

  const earlyParse = await POST('/api/attempts/' + AID + '/parse', PARSE_OK, TOKEN);
  ok('第 1 层未过就提交解析 → 409 WRONG_PHASE', earlyParse.status === 409 && earlyParse.data.error.code === 'WRONG_PHASE');
  const cardReq = await POST('/api/attempts/' + AID + '/knowledge', { action: 'request-card' }, TOKEN);
  ok('调取知识点卡：requested=true 且仍停在第 1 层', cardReq.status === 200 && cardReq.data.requested === true && cardReq.data.state.layer === 1);
  const kBad = await POST('/api/attempts/' + AID + '/knowledge', { action: 'answer', answer: '不知道。' }, TOKEN);
  ok('复述不合格 → passed=false 且不前进', kBad.status === 200 && kBad.data.passed === false && kBad.data.state.layer === 1, kBad.data.passed);
  const kOk = await POST('/api/attempts/' + AID + '/knowledge', { action: 'answer', answer: '条件收敛就是级数本身收敛，但取绝对值后发散。' }, TOKEN);
  ok('复述合格 → passed=true 且进入第 2 层', kOk.data.passed === true && kOk.data.state.layer === 2, kOk.data.state.layer);
  ok('第 1 层 done / 第 2 层 active', kOk.data.state.layerStatus['1'] === 'done' && kOk.data.state.layerStatus['2'] === 'active', kOk.data.state.layerStatus);
  ok('第 2 层 guidance.title = 题目解析', /题目解析/.test(kOk.data.state.guidance.title));

  section('三、第 2 层：题目解析');
  const pBad = await POST('/api/attempts/' + AID + '/parse', { goal: '判断级数是否收敛', parts: '', keywords: '', tools: '' }, TOKEN);
  ok('解析缺栏 → passed=false + 四栏 feedback', pBad.data.passed === false && pBad.data.feedback.length === 4 && pBad.data.feedback.every((x) => x.field && x.status && x.message), pBad.data.feedback);
  ok('缺栏时明确标 missing', pBad.data.feedback.some((x) => x.status === 'missing'));
  ok('解析不通过不前进（仍第 2 层）', pBad.data.state.layer === 2);
  ok('plainRestatement 存在（只换说法）', typeof pBad.data.plainRestatement === 'string' && pBad.data.plainRestatement.length > 5);
  const pOk = await POST('/api/attempts/' + AID + '/parse', PARSE_OK, TOKEN);
  ok('解析四栏齐全 → passed=true 且进入第 3 层', pOk.data.passed === true && pOk.data.state.layer === 3, pOk.data.state.layer);
  ok('第 2 层 done / 第 3 层 active', pOk.data.state.layerStatus['2'] === 'done' && pOk.data.state.layerStatus['3'] === 'active');
  ok('第 3 层 guidance 显示「写第 1 步」', /第 3 层 · 详细步骤/.test(pOk.data.state.guidance.title) && /第 1 步/.test(pOk.data.state.guidance.instruction), pOk.data.state.guidance.instruction);

  section('四、第 3 层：详细步骤 / 提示 / 主动 offer');
  const lockedHint = await POST('/api/attempts/' + AID + '/hint', { level: 'L2' }, TOKEN);
  ok('未提交步骤就请求 L2 → 409 HINT_LOCKED', lockedHint.status === 409 && lockedHint.data.error.code === 'HINT_LOCKED', lockedHint.data);
  const sBad1 = await POST('/api/attempts/' + AID + '/step', { conclusion: '分母变大', evidence: '' }, TOKEN);
  ok('第 1 次坏提交 → stepPassed=false，诊断指出首处可疑', sBad1.status === 200 && sBad1.data.stepPassed === false && sBad1.data.diagnosis.firstError === 1, sBad1.data.diagnosis);
  ok('第 1 次坏提交不触发 proactive', sBad1.data.proactive == null);
  ok('坏提交进入「我的证明」且状态为 revision', Array.isArray(sBad1.data.state.steps) && sBad1.data.state.steps.length === 1 && sBad1.data.state.steps[0].status === 'revision');
  const sBad2 = await POST('/api/attempts/' + AID + '/step', { conclusion: '分母变大', evidence: '' }, TOKEN);
  ok('连续 2 次失败 → proactive offer(L2)', !!(sBad2.data.proactive && sBad2.data.proactive.offer === true && sBad2.data.proactive.level === 'L2'), sBad2.data.proactive);
  ok('proactive 文案不承诺给答案', /不会给答案/.test(sBad2.data.proactive.text));
  const hint = await POST('/api/attempts/' + AID + '/hint', { level: 'L2' }, TOKEN);
  ok('proactive 对应 L2 可解锁 → 200', hint.status === 200 && hint.data.level === 'L2' && hint.data.state.used.L2 === 1, hint.status);
  ok('提示额外返回 plain（小白版解释）', typeof hint.data.plain === 'string' && hint.data.plain.length > 10, hint.data.plain);
  assertNoLeak('L2 提示', { text: hint.data.text, plain: hint.data.plain });
  const sGood1 = await POST('/api/attempts/' + AID + '/step', { conclusion: STEP_DATA[0].conclusion, evidence: STEP_DATA[0].evidence }, TOKEN);
  ok('写对第 1 步 → stepPassed=true 且步骤数=1', sGood1.data.stepPassed === true && sGood1.data.state.steps.length === 1, sGood1.data.state.steps.length);
  ok('第 1 步 status=passed 且 stepIndex=2', sGood1.data.state.steps[0].status === 'passed' && sGood1.data.state.stepIndex === 2);
  ok('写对后 proactive 清空', sGood1.data.proactive == null);
  assertNoLeak('step 反馈', sGood1.data.ai);
  const aiParts = sGood1.data.ai;
  const aiLen = [...(aiParts.judge + aiParts.hint + aiParts.ask).replace(/\s/g, '')].length;
  ok('三段式 judge ≤25 字、ask 单问句 ≤40 字、合计 ≤130 字', [...aiParts.judge.replace(/\s/g, '')].length <= 25 && (aiParts.ask.match(/[？?]/g) || []).length === 1 && [...aiParts.ask.replace(/\s/g, '')].length <= 40 && aiLen <= 130, { aiLen });
  const refusal = await POST('/api/attempts/' + AID + '/answer-request', {}, TOKEN);
  ok('「我要答案」→ 200 三段式拒绝 + 四选一替代动作', refusal.status === 200 && refusal.data.refusal.alternatives.length >= 4, refusal.data.refusal);
  const xb1 = await POST('/api/attempts/' + AID + '/xiaobai', { concept: 'p 级数' }, TOKEN);
  ok('小白解释第 1 次 → 200 三件套', xb1.status === 200 && !!(xb1.data.card.analogy && xb1.data.card.example && xb1.data.card.formal && xb1.data.card.ask), xb1.data.card);
  const xbCount = xb1.data.state.used.xiaobai;
  for (let i = xbCount; i < 2; i++) await POST('/api/attempts/' + AID + '/xiaobai', { concept: '条件收敛' }, TOKEN);
  const xb3 = await POST('/api/attempts/' + AID + '/xiaobai', { concept: '条件收敛' }, TOKEN);
  ok('小白解释第 3 次 → 429 XIAOBAI_LIMIT', xb3.status === 429 && xb3.data.error.code === 'XIAOBAI_LIMIT');
  for (let i = 1; i < STEP_DATA.length; i++) {
    const r = await POST('/api/attempts/' + AID + '/step', { conclusion: STEP_DATA[i].conclusion, evidence: STEP_DATA[i].evidence }, TOKEN);
    ok('第 ' + (i + 1) + ' 步写对 → passed 且步骤累计 ' + (i + 1), r.data.stepPassed === true && r.data.state.steps.length === i + 1 && r.data.guard.ok === true, { passed: r.data.stepPassed, steps: r.data.state.steps.length, guard: r.data.guard });
  }
  const st5 = await GET('/api/attempts/' + AID, TOKEN);
  ok('五步完成：stepIndex=6、coverage 100%', st5.data.state.stepIndex === 6 && st5.data.state.coverage.percent === 100, { stepIndex: st5.data.state.stepIndex, coverage: st5.data.state.coverage.percent });

  section('五、第 3 层收口 → 第 4 层：完整讲解');
  const fin = await POST('/api/attempts/' + AID + '/final', { text: FINAL_TEXT }, TOKEN);
  ok('终稿覆盖 5/5 → passed 且进入第 4 层', fin.status === 200 && fin.data.passed === true && fin.data.coverage.percent === 100 && fin.data.state.layer === 4, { passed: fin.data.passed, layer: fin.data.state.layer });
  ok('第 3 层 done / 第 4 层 active', fin.data.state.layerStatus['3'] === 'done' && fin.data.state.layerStatus['4'] === 'active');
  const exEarly = await POST('/api/attempts/' + AID + '/explain', { text: '我讲一下。' }, TOKEN);
  ok('第 4 层讲解缺项 → passed=false 且五项 checklist', exEarly.data.passed === false && exEarly.data.feedback.length === 5 && exEarly.data.feedback.map((x) => x.criterion).join('/') === '目标/结构/关键步骤/依据/结论', exEarly.data.feedback);
  ok('缺项时逐项标 missing', exEarly.data.feedback.some((x) => x.status === 'missing'));
  const exOk = await POST('/api/attempts/' + AID + '/explain', { text: EXPLAIN_OK }, TOKEN);
  ok('讲解齐全 → passed 且进入第 5 层', exOk.data.passed === true && exOk.data.state.layer === 5, { passed: exOk.data.passed, layer: exOk.data.state.layer });
  ok('第 4 层 done / 第 5 层 active', exOk.data.state.layerStatus['4'] === 'done' && exOk.data.state.layerStatus['5'] === 'active');

  section('六、第 5 层：同类题');
  const vgEarly = await GET('/api/attempts/' + AID + '/variant', TOKEN);
  ok('进入第 5 层后可取变式题题面', vgEarly.status === 200 && !!vgEarly.data.variant.title && !!vgEarly.data.variant.stem);
  ok('变式题响应不含答案关键词', !JSON.stringify(vgEarly.data).includes('answerKeywords') && !JSON.stringify(vgEarly.data.variant).includes('p=2'));
  const vWrong = await POST('/api/attempts/' + AID + '/variant', { answer: '收敛' }, TOKEN);
  ok('变式题答错 → correct=false 且停在第 5 层', vWrong.data.result.correct === false && vWrong.data.state.layer === 5);
  const vOk = await POST('/api/attempts/' + AID + '/variant', { answer: '绝对收敛，因为 1/n² 是 p=2>1 的 p 级数。' }, TOKEN);
  ok('变式题答对 → correct=true 且进入第 6 层', vOk.data.result.correct === true && vOk.data.state.layer === 6, { correct: vOk.data.result.correct, layer: vOk.data.state.layer });
  ok('第 5 层 done / 第 6 层 active', vOk.data.state.layerStatus['5'] === 'done' && vOk.data.state.layerStatus['6'] === 'active');

  section('七、第 6 层：总结与完成');
  const smBad = await POST('/api/attempts/' + AID + '/summary', { knowledge: '条件收敛', difficulty: '', steps: '' }, TOKEN);
  ok('总结三栏不全 → passed=false 且逐栏反馈', smBad.data.passed === false && smBad.data.feedback.length === 4, smBad.data.feedback);
  ok('总结不合格不前移（仍第 6 层、未完成）', smBad.data.state.layer === 6 && smBad.data.state.finishedAt === null);
  const smOk = await POST('/api/attempts/' + AID + '/summary', {
    knowledge: '条件收敛：原级数收敛，取绝对值后发散。',
    difficulty: '最容易错的是莱布尼茨判别法的单调性条件。',
    steps: '先核对单调递减，再确认极限为 0，然后用判别法，最后补绝对值发散。',
  }, TOKEN);
  ok('三栏齐全 → passed=true', smOk.data.passed === true, smOk.data);
  ok('生成我的总结卡（不含标准答案）', !!(smOk.data.card && smOk.data.card.title && Array.isArray(smOk.data.card.items) && smOk.data.card.items.length >= 3));
  ok('返回 mastery（0–100）', typeof smOk.data.mastery === 'number' && smOk.data.mastery >= 0 && smOk.data.mastery <= 100, smOk.data.mastery);
  ok('返回 independence 三档之一', ['independent', 'semi', 'dependent'].includes(smOk.data.independence), smOk.data.independence);
  ok('六层全部 done', Object.values(smOk.data.state.layerStatus).every((v) => v === 'done'), smOk.data.state.layerStatus);
  ok('完成时写 finishedAt', typeof smOk.data.state.finishedAt === 'string');
  assertNoLeak('总结卡', smOk.data.card);
  const restored = await GET('/api/attempts/' + AID, TOKEN);
  const stKeys = ['layer', 'layerLabel', 'layerStatus', 'guidance', 'knowledge', 'parse', 'steps', 'stepIndex', 'failedAttempts', 'budgets', 'used', 'unlocked', 'coverage', 'explanation', 'variant', 'summary', 'independence', 'mastery', 'finishedAt'];
  ok('GET /api/attempts/:id 返回完整 v2 state', stKeys.every((k) => k in restored.data.state), stKeys.filter((k) => !(k in restored.data.state)));
  ok('恢复 state 保留六层记录与 finishedAt', restored.data.state.layer === 6 && restored.data.state.steps.length === 5 && !!restored.data.state.finishedAt);

  section('八、提示预算 / 软着陆（另一条 attempt）');
  const att2 = (await POST('/api/attempts', { problemId: 'p-cond-series' }, TOKEN)).data.attemptId;
  await POST('/api/attempts/' + att2 + '/knowledge', { action: 'answer', answer: '级数本身收敛，取绝对值后发散，所以叫条件收敛。' }, TOKEN);
  await POST('/api/attempts/' + att2 + '/parse', PARSE_OK, TOKEN);
  await POST('/api/attempts/' + att2 + '/step', { conclusion: STEP_DATA[0].conclusion, evidence: STEP_DATA[0].evidence }, TOKEN);
  let lastHint = null;
  for (let i = 0; i < 3; i++) lastHint = await POST('/api/attempts/' + att2 + '/hint', { level: 'L1' }, TOKEN);
  ok('L1 用满 3 次仍 200', lastHint.status === 200 && lastHint.data.state.used.L1 === 3);
  const overflow = await POST('/api/attempts/' + att2 + '/hint', { level: 'L1' }, TOKEN);
  ok('L1 第 4 次 → 429 BUDGET_EXHAUSTED', overflow.status === 429 && overflow.data.error.code === 'BUDGET_EXHAUSTED', overflow.data);
  const soft = overflow.data.softLanding || (overflow.data.error.detail && overflow.data.error.detail.softLanding);
  ok('429 带 softLanding 四选一', soft && soft.options.length === 4, soft);
  const l0 = await POST('/api/attempts/' + att2 + '/hint', { level: 'L0' }, TOKEN);
  ok('L0 追问不占信息型预算（仍可用）', l0.status === 200 && l0.data.state.used.L0 === 1);

  section('九、教师端 / CSV / 事件 / 运维（v1 兼容）');
  const dash = await GET('/api/teacher/dashboard?period=week');
  const k = dash.data.kpis;
  ok('教师看板：完成率 72%（26/36）', k.finished === 26 && k.total === 36 && k.completionRatePercent === 72, k);
  ok('教师看板：未完成 10 人、3 人连续 2 周未动', k.unfinished === 10 && dash.data.unfinishedList.filter((x) => x.inactiveWeeks >= 2).length === 3);
  ok('教师看板：平均提示轮数 4.8', k.avgHintRounds === 4.8);
  ok('教师看板：独立性三档 38/34/28', k.independence.percent.independent === 38 && k.independence.percent.semi === 34 && k.independence.percent.dependent === 28, k.independence);
  ok('教师看板：卡点 Top5 = 32/27/19/13/9', JSON.stringify(dash.data.stuckTop5.map((x) => x.percent)) === JSON.stringify([32, 27, 19, 13, 9]));
  ok('题库审核队列 3 条', dash.data.reviewQueue.length === 3);
  ok('演示学生作答不计入班级统计', k.finished === 26 && k.avgHintRounds === 4.8);
  const csvRes = await fetch(B + '/api/teacher/export.csv');
  const csvText = await csvRes.text();
  const csvLines = csvText.split('\r\n').filter((x) => x.length > 0);
  ok('CSV：200 + text/csv', csvRes.status === 200 && /text\/csv/.test(csvRes.headers.get('content-type') || ''));
  ok('CSV：表头 11 列、60 条 roster attempt', csvLines[0].replace(/^\uFEFF/, '') === '匿名ID,班级,题号,知识点,开始时间,用时分钟,提示次数,最高提示级别,独立性,完成,覆盖度' && csvLines.length === 61, csvLines.length);
  ok('CSV：默认匿名（无真实姓名）', !csvText.includes('王砚') && !csvText.includes('2026001'));
  const stu = await GET('/api/teacher/students/s01');
  ok('学生详情：s01 有 attempts/events', stu.status === 200 && stu.data.attempts.length >= 1 && stu.data.events.length >= 1);
  const ev = await GET('/api/events?attemptId=a001&limit=50', TOKEN);
  ok('事件流：按 attemptId 过滤', ev.status === 200 && ev.data.total >= 5);
  const ev2 = await GET('/api/events?attemptId=' + AID + '&limit=100', TOKEN);
  ok('事件流：新 attempt 有 knowledge/parse/step/final/explain/variant/summary 事件', ['knowledge', 'parse', 'step', 'final', 'explain', 'variant', 'summary', 'finish'].every((t) => ev2.data.items.some((e) => e.type === t)), [...new Set(ev2.data.items.map((e) => e.type))]);
  const stats = await GET('/api/admin/stats');
  ok('admin/stats：guard 统计存在、blocked=0', typeof stats.data.guard.checked === 'number' && stats.data.guard.checked > 0 && stats.data.guard.blocked === 0, stats.data.guard);
  ok('admin/stats：db 计数正确', stats.data.db.students === 36 && stats.data.db.problems === 12);

  section('十、reset 与种子一致性');
  const reset = await POST('/api/admin/reset');
  ok('admin/reset → ok + reseededAt', reset.status === 200 && reset.data.ok === true && typeof reset.data.reseededAt === 'string');
  const health2 = await GET('/api/health');
  ok('重置后 db 回到 36/12/60', health2.data.db.students === 36 && health2.data.db.problems === 12 && health2.data.db.attempts === 60, health2.data.db);
  const dash2 = await GET('/api/teacher/dashboard');
  ok('重置后教师看板仍为 72%/4.8/38-34-28', dash2.data.kpis.completionRatePercent === 72 && dash2.data.kpis.avgHintRounds === 4.8 && dash2.data.kpis.independence.percent.semi === 34);

  section('十一、guard 六条规则单元测试');
  const banned = check('证明如下：先证单调性。');
  ok('guard：禁用词 → BANNED_WORD', banned.blocked && banned.rules.includes('BANNED_WORD'), banned);
  const numbered = check('1. 先证收敛\n2. 再证发散');
  ok('guard：编号步骤 → NUMBERED_STEPS', numbered.blocked && numbered.rules.includes('NUMBERED_STEPS'), numbered);
  const tooLong = check('这'.repeat(40), { level: 'L0' });
  ok('guard：超长 → TOO_LONG', tooLong.blocked && tooLong.rules.includes('TOO_LONG'), tooLong);
  const leak = check('xxabcdefghijyyklmnopqrstzz', { keySteps: ['abcdefghij', 'klmnopqrst'] });
  ok('guard：关键步骤泄漏 ≥2 条 → STEP_LEAK', leak.blocked && leak.rules.includes('STEP_LEAK'));
  const overlap = check('xxABCDEFGHIJKLMNOP', { referenceProof: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  ok('guard：与参考证明重合 ≥12 字 → REFERENCE_OVERLAP', overlap.blocked && overlap.rules.includes('REFERENCE_OVERLAP'));
  const chained = check('这一步的依据是定义。', { history: ['证毕。'] });
  ok('guard：连读检测 → CHAINED', chained.blocked && chained.rules.includes('CHAINED'));
  const clean = check('这一步的依据是定义。', { level: 'L0' });
  ok('guard：合规文本 → ok:true', clean.ok === true && clean.blocked === false);
} catch (e) {
  console.error('\nE2E 异常：', e && e.stack ? e.stack : e);
  results.push({ name: 'E2E 未抛异常', pass: false });
} finally {
  await app.close();
  try { fs.unlinkSync(tmp); } catch {}
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log('\n================ E2E v2 汇总 ================');
console.log('PASS ' + passed + ' / ' + results.length + '；FAIL ' + failed);
if (failed) {
  console.log('失败项：');
  for (const r of results.filter((x) => !x.pass)) console.log(' - ' + r.name);
}
process.exit(failed ? 1 : 0);
