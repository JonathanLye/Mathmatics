#!/usr/bin/env node
// 课堂并发压测（本地/预发用，不要对生产库跑）：N 个学生同时登录并作答，教师同时刷新看板。
// 用法：PG_BASE=http://127.0.0.1:3000 PG_TEACHER_USER=e2e PG_TEACHER_PASSWORD=... node tools/loadtest.mjs [学生数=60] [每人行数=6]
// 注意：学生登录按 IP 限流（120 次/分），N 不要超过 100。输出每个接口的 p50/p95/max 与错误数；有错误或 p95>1500ms 则退出码非 0。
const BASE = process.env.PG_BASE ?? 'http://127.0.0.1:3000';
const USER = process.env.PG_TEACHER_USER ?? '';
const PASSWORD = process.env.PG_TEACHER_PASSWORD ?? '';
const N = Number(process.argv[2] ?? 60);
const LINES = Number(process.argv[3] ?? 6);
if (USER === '' || PASSWORD === '') {
  console.error('缺少 PG_TEACHER_USER / PG_TEACHER_PASSWORD');
  process.exit(2);
}

const stats = new Map();
const errors = [];
function record(name, ms, ok) {
  const s = stats.get(name) ?? { ms: [], err: 0 };
  s.ms.push(ms);
  if (!ok) s.err++;
  stats.set(name, s);
}

async function call(jar, name, method, path, body, headers = {}) {
  const started = performance.now();
  let status = 0;
  let text = '';
  try {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: {
        'x-requested-with': 'proof-gym',
        ...(jar.cookie ? { cookie: jar.cookie } : {}),
        ...(body !== undefined && typeof body === 'object' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    status = res.status;
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0];
    text = await res.text();
  } catch (error) {
    errors.push(`${name}: ${String(error)}`);
  }
  const ok = status >= 200 && status < 300;
  record(name, performance.now() - started, ok);
  if (!ok && errors.length < 12) errors.push(`${name}: HTTP ${status} ${text.slice(0, 120)}`);
  return ok && text ? JSON.parse(text) : null;
}

const teacher = { cookie: '' };
await call(teacher, 'teacher.login', 'POST', '/auth/teacher/login', { username: USER, password: PASSWORD });
const stamp = Date.now();
const cls = await call(teacher, 'class.create', 'POST', '/teacher/classes', { name: `压测班 ${stamp}`, term: '2026 秋' });
if (!cls) { console.error('建班失败', errors); process.exit(1); }
const nos = Array.from({ length: N }, (_, i) => String(9000000 + i));
await call(teacher, 'roster', 'POST', `/teacher/classes/${cls.classId}/roster`, `${nos.map((no, i) => `${no},压测${i}`).join('\n')}\n`, { 'content-type': 'text/csv' });
const assignment = await call(teacher, 'assignment', 'POST', '/teacher/assignments', {
  classId: cls.classId, problemId: 'epsN', version: 1, mode: 'practice', openAt: new Date(Date.now() - 60_000).toISOString(),
});
if (!assignment) { console.error('布置失败', errors); process.exit(1); }

const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
const uuid = (a, b) => `00000000-0000-4000-8000-${String(a).padStart(6, '0')}${String(b).padStart(6, '0')}`;

async function student(i) {
  const jar = { cookie: '' };
  await call(jar, 's.login', 'POST', '/auth/student/login', { inviteCode: cls.inviteCode, studentNo: nos[i], deviceId: uuid(i, 0) });
  await call(jar, 's.ageBand', 'POST', '/auth/student/age-band', { ageBand: 'ge18' });
  await call(jar, 's.consent', 'POST', '/consents', { version: 'v2', items: REQUIRED });
  const started = await call(jar, 's.start', 'POST', `/student/assignments/${assignment.assignmentId}/attempt`);
  const attemptId = started?.state?.attemptId;
  if (!attemptId) return;
  await call(jar, 's.skipL1', 'POST', `/attempts/${attemptId}/layers/L1/skip`, {});
  await call(jar, 's.skipL2', 'POST', `/attempts/${attemptId}/layers/L2/skip`, {});
  for (let k = 0; k < LINES; k++) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
    await call(jar, 's.addLine', 'POST', `/attempts/${attemptId}/lines`, {
      statement: `$|a_n-3|=\\frac{5}{n+2}$`, justification: `通分第${k}次`, input: { provenance: 'keyboard', draftId: uuid(i, k + 1) },
    });
    await call(jar, 's.state', 'GET', `/attempts/${attemptId}`);
  }
}

let polling = true;
const poller = (async () => {
  while (polling) {
    await call(teacher, 't.live', 'GET', `/teacher/classes/${cls.classId}/live`);
    await new Promise((r) => setTimeout(r, 1000));
  }
})();

const t0 = performance.now();
await Promise.all(Array.from({ length: N }, (_, i) => student(i)));
polling = false;
await poller;
await call(teacher, 't.metrics', 'GET', `/teacher/classes/${cls.classId}/metrics`);
const live = await call(teacher, 't.live.final', 'GET', `/teacher/classes/${cls.classId}/live`);

const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
console.log(`\n压测：${N} 名学生 × ${LINES} 行，总耗时 ${((performance.now() - t0) / 1000).toFixed(1)}s，看板行数 ${live?.rows?.length ?? '?'}`);
console.log('接口'.padEnd(14), 'n'.padStart(5), 'p50'.padStart(7), 'p95'.padStart(7), 'max'.padStart(7), 'err'.padStart(5));
let bad = false;
for (const [name, s] of stats) {
  const p95 = pct(s.ms, 0.95);
  if (s.err > 0 || p95 > 1500) bad = true;
  console.log(name.padEnd(14), String(s.ms.length).padStart(5), pct(s.ms, 0.5).toFixed(0).padStart(7), p95.toFixed(0).padStart(7), Math.max(...s.ms).toFixed(0).padStart(7), String(s.err).padStart(5));
}
if (errors.length) console.log('\n前几条错误：\n' + errors.join('\n'));
if ((live?.rows?.length ?? 0) !== N) bad = true;
process.exit(bad ? 1 : 0);
