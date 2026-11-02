/**
 * tests/e2e.mjs —— 零依赖 E2E（起随机端口 + 临时 dbPath，不污染演示数据）
 * 运行：node tests/e2e.mjs
 * 输出：每条 PASS/FAIL + 汇总；全 PASS 退出码 0，否则 1。
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

const tmp = path.join(os.tmpdir(), 'mathproof-e2e-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.json');
const app = createServer({ port: 0, dbPath: tmp });
const { port } = await app.start();
const B = 'http://127.0.0.1:' + port;
let TOKEN = '';
let ATT = null;

async function req(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}
const GET = (p, t) => req('GET', p, undefined, t);
const POST = (p, body, t) => req('POST', p, body === undefined ? {} : body, t);

const STEP_INPUTS = [
  '要证这个级数收敛，还要判断它是条件收敛还是绝对收敛。',            // node1 r0
  '条件收敛就是级数本身收敛，但把每一项换成绝对值以后，新级数发散。',     // node1 r1
  '两件：先证原级数收敛；再证绝对值级数 ∑1/√n 发散。',                // node2
  '先攻收敛。u_n=1/√n 随 n 增大而变小，因为分母越来越大。',            // node3（缺不等式 → 诊断）
  '1/√(n+1) < 1/√n，因为 n+1 > n。这是莱布尼茨判别法的单调条件。',    // node4
  '因为 lim n^{1/2}=+∞，所以 lim 1/√n = 0。',                        // node6 r0
  '由莱布尼茨判别法，这个交错级数收敛。',                              // node6 r1
  '∑1/√n 是 p 级数，p=1/2，但 p 级数什么时候收敛我忘了，看不懂。',      // node8 r0
  'p=1/2 ≤ 1，所以 ∑1/√n 发散。',                                    // node8 r1
];
const FINAL_TEXT = [
  '① 令 u_n = 1/√n。因为 n+1 > n，所以 1/√(n+1) < 1/√n，即 {u_n} 单调递减。',
  '② 因为 n^{1/2} → +∞，所以 1/√n → 0。',
  '③ 由莱布尼茨判别法，∑(−1)^{n−1}/√n 收敛。',
  '④ 而 ∑1/√n 是 p=1/2 的 p-级数，p≤1 故发散，所以原级数不绝对收敛。因此它是条件收敛。',
].join('\n');
const REVIEW_ANSWERS = [
  '判定一个交错级数是条件收敛。',
  '两段：先证原级数收敛，再证绝对值级数发散。',
  '第一步就想到条件收敛要证两件事，否则会漏掉绝对发散。',
  '结论写明条件收敛，两段理由都有依据，判别法条件逐条核对。',
  '带走交错用莱布尼茨、条件收敛补证绝对发散、p 级数规则。',
];
const assertAiShape = (label, ai, guard) => {
  const total = [...(ai.judge + ai.hint + ai.ask).replace(/\s/g, '')].length;
  ok(label + '：三段式字段齐全', !!(ai.judge && ai.hint && ai.ask && ai.tag), ai);
  ok(label + '：judge ≤25 字', [...ai.judge.replace(/\s/g, '')].length <= 25, ai.judge);
  ok(label + '：ask 恰好 1 个问句且 ≤40 字', (ai.ask.match(/[？?]/g) || []).length === 1 && [...ai.ask.replace(/\s/g, '')].length <= 40, ai.ask);
  ok(label + '：正文合计 ≤130 字', total <= 130, total);
  ok(label + '：guard 通过', guard && guard.ok === true && guard.blocked === false, guard);
};

try {
  section('一、基础与鉴权');
  const health = await GET('/api/health');
  ok('health.ok = true', health.status === 200 && health.data.ok === true, health.data);
  ok('health.db.students = 36', health.data.db.students === 36, health.data.db);
  ok('health.db.problems = 12', health.data.db.problems === 12, health.data.db);
  ok('health.db.attempts = 60（种子）', health.data.db.attempts === 60, health.data.db);
  ok('health.mode = mock', health.data.mode === 'mock', health.data.mode);

  const meta = await GET('/api/meta');
  ok('meta 邀请码 = MATH-A-2026', Array.isArray(meta.data.inviteCodes) && meta.data.inviteCodes.includes('MATH-A-2026'), meta.data.inviteCodes);
  ok('meta.demoStudentId = demo', meta.data.demoStudentId === 'demo');
  ok('meta.budgets 与契约一致', meta.data.budgets.L1 === 3 && meta.data.budgets.L2 === 3 && meta.data.budgets.L3 === 2 && meta.data.budgets.L4 === 1 && meta.data.budgets.L0 === 6 && meta.data.budgets.xiaobai === 2, meta.data.budgets);
  ok('meta.phases 共 6 个', Array.isArray(meta.data.phases) && meta.data.phases.length === 6);

  const badLogin = await POST('/api/login', { inviteCode: 'WRONG', studentId: 'demo' });
  ok('错误邀请码 → 401 INVALID_INVITE', badLogin.status === 401 && badLogin.data.error.code === 'INVALID_INVITE', badLogin.data);
  const noToken = await GET('/api/home');
  ok('无 token 访问 /api/home → 401 UNAUTHORIZED', noToken.status === 401 && noToken.data.error.code === 'UNAUTHORIZED', noToken.data);
  const badToken = await GET('/api/home', 't-not-exist');
  ok('无效 token → 401', badToken.status === 401, badToken.data);

  const login = await POST('/api/login', { inviteCode: 'MATH-A-2026', studentId: 'demo' });
  TOKEN = login.data.token;
  ok('正确邀请码登录 → 200 + token', login.status === 200 && typeof TOKEN === 'string' && TOKEN.startsWith('t-'), login.data);
  ok('登录返回演示学生（id=s-demo）', login.data.student && login.data.student.id === 's-demo' && login.data.student.name === '演示同学', login.data.student);

  section('二、学生端：题目白名单与首页');
  const home = await GET('/api/home', TOKEN);
  ok('home.weekly.required = 3', home.data.weekly && home.data.weekly.required === 3, home.data.weekly);
  ok('home.retest 为 28 天后', home.data.retest && home.data.retest.days === 28, home.data.retest);

  const list = await GET('/api/problems', TOKEN);
  ok('/api/problems total = 12', list.data.total === 12, list.data.total);
  ok('/api/problems 返回 12 条', Array.isArray(list.data.items) && list.data.items.length === 12);
  const filtered = await GET('/api/problems?chapter=' + encodeURIComponent('级数') + '&difficulty=mid', TOKEN);
  ok('/api/problems 支持 chapter+difficulty 筛选', filtered.data.total >= 1 && filtered.data.total < 12, filtered.data.total);
  const detail = await GET('/api/problems/p-cond-series', TOKEN);
  const detailStr = JSON.stringify(detail.data);
  ok('题目详情 200 且含 stem', detail.status === 200 && typeof detail.data.stem === 'string' && detail.data.stem.length > 10);
  ok('题目详情不含 keySteps（答案隔离）', !('keySteps' in detail.data) && !detailStr.includes('keySteps'), Object.keys(detail.data));
  ok('题目详情不含 hints（答案隔离）', !('hints' in detail.data) && !detailStr.includes('referenceProof'));
  ok('题目详情不含 referenceProof', !detailStr.includes('参考证明') && !detailStr.includes('referenceProof'));
  ok('未知题目 → 404', (await GET('/api/problems/not-exist', TOKEN)).status === 404);
  const noScript = await POST('/api/attempts', { problemId: 'p-epsilon-n' }, TOKEN);
  ok('未开放脚本的题 → 409 WRONG_PHASE', noScript.status === 409 && noScript.data.error.code === 'WRONG_PHASE', noScript.data);

  section('三、作答状态机：10 节点走完');
  const created = await POST('/api/attempts', { problemId: 'p-cond-series' }, TOKEN);
  ATT = created.data.attemptId;
  ok('POST /api/attempts → 201 + attemptId', created.status === 201 && typeof ATT === 'string', created.data);
  ok('初始 state：node=1 / phase=P1 / unlocked=[L0]', created.data.state.node === 1 && created.data.state.phase === 'P1' && JSON.stringify(created.data.state.unlocked) === JSON.stringify(['L0']), created.data.state);

  const locked = await POST('/api/attempts/' + ATT + '/hint', { level: 'L2' }, TOKEN);
  ok('未提交就请求 L2 → 409 HINT_LOCKED', locked.status === 409 && locked.data.error.code === 'HINT_LOCKED', locked.data);

  const step1 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[0] }, TOKEN);
  ok('第 1 次提交 → 200 且推进 round', step1.status === 200 && step1.data.state.round === 1, step1.status);
  assertAiShape('step1', step1.data.ai, step1.data.guard);

  const step2 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[1] }, TOKEN);
  ok('节点 1 第 2 轮 → node=2 phase=P2', step2.data.state.node === 2 && step2.data.state.phase === 'P2', step2.data.state);
  const step3 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[2] }, TOKEN);
  ok('节点 2 → node=3 phase=P3', step3.data.state.node === 3 && step3.data.state.phase === 'P3', step3.data.state);
  const step4 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[3] }, TOKEN);
  ok('节点 3（缺不等式）→ 诊断命中首疑点', step4.status === 200 && step4.data.diagnosis.verdict !== 'ok' && /不等式/.test(step4.data.diagnosis.type), step4.data.diagnosis);
  ok('节点 3 推进到 node=4', step4.data.state.node === 4, step4.data.state.node);
  const step5 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[4] }, TOKEN);
  ok('节点 4 → node=5（卡住节点）', step5.data.state.node === 5, step5.data.state.node);
  ok('节点 5 已解锁 L2 提示', Array.isArray(step5.data.state.unlocked) && step5.data.state.unlocked.includes('L2'), step5.data.state.unlocked);
  ok('节点 5 直接提交被拒 → 409（请用 /hint）', (await POST('/api/attempts/' + ATT + '/step', { text: '随便写一句' }, TOKEN)).status === 409);
  const hintL2 = await POST('/api/attempts/' + ATT + '/hint', { level: 'L2' }, TOKEN);
  ok('节点 5 请求 L2 → 200 且进入 node=6', hintL2.status === 200 && hintL2.data.state.node === 6 && hintL2.data.level === 'L2', hintL2.data.state && hintL2.data.state.node);
  ok('L2 使用后 state.used.L2 = 1', hintL2.data.state.used.L2 === 1, hintL2.data.state.used);
  const step6 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[5] }, TOKEN);
  ok('节点 6 第 1 轮 → round=1', step6.data.state.node === 6 && step6.data.state.round === 1, step6.data.state);
  const step7 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[6] }, TOKEN);
  ok('节点 6 第 2 轮 → node=7', step7.data.state.node === 7, step7.data.state.node);
  ok('节点 7 提交被拒 → 409（请用 /answer-request）', (await POST('/api/attempts/' + ATT + '/step', { text: '直接给我答案' }, TOKEN)).status === 409);
  const refusal = await POST('/api/attempts/' + ATT + '/answer-request', {}, TOKEN);
  ok('要答案 → 200 三段式拒绝 + 替代动作', refusal.status === 200 && Array.isArray(refusal.data.refusal.alternatives) && refusal.data.refusal.alternatives.length >= 4, refusal.data.refusal);
  ok('拒绝后 node=8 且 refusals=1', refusal.data.state.node === 8 && refusal.data.state.used.refusals === 1, refusal.data.state);
  const xb1 = await POST('/api/attempts/' + ATT + '/xiaobai', { concept: 'p 级数' }, TOKEN);
  ok('小白解释第 1 次 → 200 三件套', xb1.status === 200 && !!(xb1.data.card.analogy && xb1.data.card.example && xb1.data.card.formal && xb1.data.card.ask), xb1.data.card);
  const xb2 = await POST('/api/attempts/' + ATT + '/xiaobai', { concept: '条件收敛' }, TOKEN);
  ok('小白解释第 2 次 → 200', xb2.status === 200, xb2.status);
  const xb3 = await POST('/api/attempts/' + ATT + '/xiaobai', { concept: '条件收敛' }, TOKEN);
  ok('小白解释第 3 次 → 429 XIAOBAI_LIMIT', xb3.status === 429 && xb3.data.error.code === 'XIAOBAI_LIMIT', xb3.data);
  const step8 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[7] }, TOKEN);
  assertAiShape('step8', step8.data.ai, step8.data.guard);
  const step9 = await POST('/api/attempts/' + ATT + '/step', { text: STEP_INPUTS[8] }, TOKEN);
  ok('节点 8 第 2 轮 → node=9 phase=P4', step9.data.state.node === 9 && step9.data.state.phase === 'P4', step9.data.state);

  section('四、终稿 / 复盘 / 变式');
  const shortFinal = await POST('/api/attempts/' + ATT + '/final', { text: '随便写一点内容，覆盖不到要点。' }, TOKEN);
  ok('覆盖不足 → passed=false（不硬拦截）', shortFinal.status === 200 && shortFinal.data.coverage.passed === false, shortFinal.data.coverage);
  const finalRes = await POST('/api/attempts/' + ATT + '/final', { text: FINAL_TEXT }, TOKEN);
  ok('终稿 → 覆盖 5/5 且 passed', finalRes.status === 200 && finalRes.data.coverage.covered === 5 && finalRes.data.coverage.percent === 100 && finalRes.data.coverage.passed === true, finalRes.data.coverage);
  ok('覆盖表 5 条且全部问句化', finalRes.data.coverage.items.length === 5 && finalRes.data.coverage.items.every((x) => /[？?]/.test(x.question)), finalRes.data.coverage.items);
  const review = await POST('/api/attempts/' + ATT + '/review', { answers: REVIEW_ANSWERS }, TOKEN);
  ok('五问复盘 → 200 + mastery 0–100', review.status === 200 && typeof review.data.mastery === 'number' && review.data.mastery >= 0 && review.data.mastery <= 100, review.data.mastery);
  ok('复盘后 phase=P5', review.data.state.phase === 'P5', review.data.state.phase);
  const badReview = await POST('/api/attempts/' + ATT + '/review', { answers: ['太短'] }, TOKEN);
  ok('复盘答案不足 5 条 → 400', badReview.status === 400 && badReview.data.error.code === 'BAD_REQUEST', badReview.data);
  const variant = await POST('/api/attempts/' + ATT + '/variant', { answer: '绝对收敛，因为 1/n² 是 p=2>1 的 p 级数' }, TOKEN);
  ok('变式题 → correct=true', variant.status === 200 && variant.data.result.correct === true, variant.data.result);
  ok('完成后判定 independence=semi（用过 L2）', variant.data.state.independence === 'semi', variant.data.state.independence);
  ok('完成 attempt 有 finishedAt', !!variant.data.state.finishedAt, variant.data.state.finishedAt);
  const restored = await GET('/api/attempts/' + ATT, TOKEN);
  ok('GET /api/attempts 可恢复状态与消息', restored.status === 200 && restored.data.state.attemptId === ATT && Array.isArray(restored.data.messages) && restored.data.messages.length >= 10, restored.data.messages.length);

  section('五、提示预算与软着陆（另一条 attempt）');
  const att2 = (await POST('/api/attempts', { problemId: 'p-cond-series' }, TOKEN)).data.attemptId;
  await POST('/api/attempts/' + att2 + '/step', { text: STEP_INPUTS[0] }, TOKEN);
  let lastHint = null;
  for (let i = 0; i < 3; i++) lastHint = await POST('/api/attempts/' + att2 + '/hint', { level: 'L1' }, TOKEN);
  ok('L1 用满 3 次仍 200', lastHint.status === 200 && lastHint.data.state.used.L1 === 3, lastHint.data.state && lastHint.data.state.used);
  const overflow = await POST('/api/attempts/' + att2 + '/hint', { level: 'L1' }, TOKEN);
  ok('L1 第 4 次 → 429 BUDGET_EXHAUSTED', overflow.status === 429 && overflow.data.error.code === 'BUDGET_EXHAUSTED', overflow.data);
  const soft = overflow.data.softLanding || (overflow.data.error.detail && overflow.data.error.detail.softLanding);
  ok('429 带 softLanding 四选一', soft && Array.isArray(soft.options) && soft.options.length === 4, soft);
  const l0 = await POST('/api/attempts/' + att2 + '/hint', { level: 'L0' }, TOKEN);
  ok('L0 追问不占信息型预算（仍可用）', l0.status === 200 && l0.data.state.used.L1 === 3 && l0.data.state.used.L0 === 1, l0.data.state && l0.data.state.used);

  section('六、教师端看板 / CSV / 事件 / 运维');
  const dash = await GET('/api/teacher/dashboard?period=week');
  const k = dash.data.kpis;
  ok('教师看板：完成率 72%（26/36）', k.finished === 26 && k.total === 36 && k.completionRatePercent === 72, k);
  ok('教师看板：未完成 10 人', k.unfinished === 10 && dash.data.unfinishedList.length === 10, dash.data.unfinishedList.length);
  ok('教师看板：平均提示轮数 4.8', k.avgHintRounds === 4.8, k.avgHintRounds);
  ok('教师看板：独立性三档 38/34/28', k.independence.percent.independent === 38 && k.independence.percent.semi === 34 && k.independence.percent.dependent === 28, k.independence);
  ok('教师看板：三档分列、不合成单一百分比', k.independence.counts.independent + k.independence.counts.semi + k.independence.counts.dependent === 50, k.independence.counts);
  const stuck = dash.data.stuckTop5;
  ok('卡点 Top5 = 32/27/19/13/9', JSON.stringify(stuck.map((x) => x.percent)) === JSON.stringify([32, 27, 19, 13, 9]), stuck);
  ok('卡点 Top5 名称与契约一致', stuck[0].kp === '莱布尼茨的单调性条件' && stuck[1].kp === '条件收敛的定义' && stuck[4].kp === '五问复盘第 3 问', stuck.map((x) => x.kp));
  ok('未完成名单含 3 名连续 2 周未动', dash.data.unfinishedList.filter((x) => x.inactiveWeeks >= 2).length === 3, dash.data.unfinishedList.map((x) => x.inactiveWeeks));
  ok('学生列表 36 人', dash.data.students.length === 36);
  ok('题库审核队列 3 条', dash.data.reviewQueue.length === 3);
  ok('exportUrl 指向 CSV', dash.data.exportUrl === '/api/teacher/export.csv');
  ok('看板数字不受演示学生影响（演示 attempt 不计入班级）', k.avgHintRounds === 4.8 && k.finished === 26);

  const csvRes = await fetch(B + '/api/teacher/export.csv');
  const csvText = await csvRes.text();
  const csvLines = csvText.split('\r\n').filter((x) => x.length > 0);
  ok('CSV：200 + text/csv', csvRes.status === 200 && /text\/csv/.test(csvRes.headers.get('content-type') || ''), csvRes.headers.get('content-type'));
  ok('CSV：表头 11 列（契约列序）', csvLines[0].replace(/^\uFEFF/, '') === '匿名ID,班级,题号,知识点,开始时间,用时分钟,提示次数,最高提示级别,独立性,完成,覆盖度', csvLines[0]);
  ok('CSV：60 条 roster attempt + 1 表头', csvLines.length === 61, csvLines.length);
  ok('CSV：默认匿名（不含真实姓名）', !csvText.includes('王砚') && !csvText.includes('2026001'));
  ok('CSV：独立性列使用三档英文', /,(independent|semi|dependent),/.test(csvText));

  const detailStu = await GET('/api/teacher/students/s01');
  ok('学生详情：s01 有 attempts 与 events', detailStu.status === 200 && detailStu.data.attempts.length >= 1 && detailStu.data.events.length >= 1, detailStu.data);
  ok('学生详情：未知学生 → 404', (await GET('/api/teacher/students/not-exist')).status === 404);

  const ev = await GET('/api/events?attemptId=a001&limit=50', TOKEN);
  ok('事件流：按 attemptId 过滤且返回事件', ev.status === 200 && ev.data.total >= 5 && ev.data.items.length >= 5, ev.data.total);
  ok('事件流：事件含 ts/type', typeof ev.data.items[0].ts === 'string' && typeof ev.data.items[0].type === 'string');

  const stats = await GET('/api/admin/stats');
  ok('admin/stats：guard 统计存在且 checked>0', typeof stats.data.guard.checked === 'number' && stats.data.guard.checked > 0, stats.data.guard);
  ok('admin/stats：db 计数正确', stats.data.db.problems === 12 && stats.data.db.students === 36);
  const routes = await GET('/api/admin/routes');
  ok('admin/routes ≥ 20 条', Array.isArray(routes.data) && routes.data.length >= 20, routes.data.length);
  ok('admin/routes 含 step/hint/answer-request', ['/api/attempts/:id/step', '/api/attempts/:id/hint', '/api/attempts/:id/answer-request'].every((p) => routes.data.some((r) => r.path === p)));

  section('七、重置与种子一致性');
  const reset = await POST('/api/admin/reset');
  ok('admin/reset → ok + reseededAt', reset.status === 200 && reset.data.ok === true && typeof reset.data.reseededAt === 'string', reset.data);
  const health2 = await GET('/api/health');
  ok('重置后 db 回到 36/12/60', health2.data.db.students === 36 && health2.data.db.problems === 12 && health2.data.db.attempts === 60, health2.data.db);
  const dash2 = await GET('/api/teacher/dashboard');
  ok('重置后教师看板仍为 72%/4.8/38-34-28', dash2.data.kpis.completionRatePercent === 72 && dash2.data.kpis.avgHintRounds === 4.8 && dash2.data.kpis.independence.percent.independent === 38);

  section('八、guard 六条规则单元测试');
  const banned = check('证明如下：先证单调性。');
  ok('guard：禁用词 → BANNED_WORD', banned.blocked && banned.rules.includes('BANNED_WORD'), banned);
  const numbered = check('1. 先证收敛\n2. 再证发散');
  ok('guard：编号步骤 → NUMBERED_STEPS', numbered.blocked && numbered.rules.includes('NUMBERED_STEPS'), numbered);
  const tooLong = check('这'.repeat(40), { level: 'L0' });
  ok('guard：超长 → TOO_LONG', tooLong.blocked && tooLong.rules.includes('TOO_LONG'), tooLong);
  const leak = check('xxabcdefghijyyklmnopqrstzz', { keySteps: ['abcdefghij', 'klmnopqrst'] });
  ok('guard：关键步骤泄漏 ≥2 条 → STEP_LEAK', leak.blocked && leak.rules.includes('STEP_LEAK'), leak);
  const overlap = check('xxABCDEFGHIJKLMNOP', { referenceProof: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  ok('guard：与参考证明重合 ≥12 字 → REFERENCE_OVERLAP', overlap.blocked && overlap.rules.includes('REFERENCE_OVERLAP'), overlap);
  const chained = check('这一步的依据是定义。', { history: ['证毕。'] });
  ok('guard：连读检测 → CHAINED', chained.blocked && chained.rules.includes('CHAINED'), chained);
  const clean = check('这一步的依据是定义。', { level: 'L0' });
  ok('guard：合规文本 → ok:true', clean.ok === true && clean.blocked === false && clean.rules.length === 0, clean);
  ok('guard：blocked 返回 L0 安全兜底句', typeof banned.safeText === 'string' && banned.safeText.length > 0);
} catch (e) {
  console.error('\nE2E 异常：', e && e.stack ? e.stack : e);
  results.push({ name: 'E2E 未抛异常', pass: false });
} finally {
  await app.close();
  try { fs.unlinkSync(tmp); } catch {}
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log('\n================ E2E 汇总 ================');
console.log('PASS ' + passed + ' / ' + results.length + '；FAIL ' + failed);
if (failed) {
  console.log('失败项：');
  for (const r of results.filter((x) => !x.pass)) console.log(' - ' + r.name);
}
process.exit(failed ? 1 : 0);
