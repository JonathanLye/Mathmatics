#!/usr/bin/env node
// 演示班种子：给一台本地服务建一个叫「演示班」的独立班级，导入 13 个虚构学生，让其中 12 个按真实流程作答
// （设密码 → 年龄 → 同意 → 做题），留一个学号不动，用来现场演示学生第一次登录的开场动画。
//
// 铁律（任何一条不满足就直接退出，不做任何事）：
//   1. 必须带 --i-know-this-is-a-demo；
//   2. 目标服务必须是本机（localhost / 127.0.0.1 / ::1）；要对别的地址跑，必须再带 --allow-non-local-target；
//   3. 只碰「演示班」和它自己的演示学生，不碰任何其他班级、用户、题目。
//
// 用法：
//   DEMO_TEACHER_PASSWORD=… node tools/demo-seed.mjs --i-know-this-is-a-demo
//   DEMO_TEACHER_PASSWORD=… node tools/demo-seed.mjs --cleanup --i-know-this-is-a-demo [--dry-run]
//
// 环境变量（密码从来不写进文件，也不接受命令行参数，避免进 shell 历史）：
//   DEMO_BASE_URL            默认 http://127.0.0.1:3000
//   DEMO_TEACHER_USER        默认 demo；这个教师账号要先存在（见下）
//   DEMO_TEACHER_PASSWORD    必填（播种用；--cleanup 只查教师是谁，不需要）
//   DEMO_TEACHER_TOTP        教师账号开了两步验证才需要
//   DEMO_STUDENT_PASSWORD    可选；不给就随机生成一个，打印在最后。至少 8 个字符
//
// 教师账号：本脚本不建教师。没有时先用文档里的命令建一个（同一数据库没有别的进程占用时）：
//   TEACHER_PASSWORD=… node apps/server/src/db/cli.ts create-teacher demo
//
// 播种只走 HTTP 接口（登录、设密码、年龄、同意书、作答），和真实学生一模一样。
// --cleanup 不一样：服务端没有删班级/删学生的接口，所以清理直接连数据库（和 tools/reset-teacher-password.mjs 同样的
// DATABASE_URL / PGLITE_DIR 约定），在一个事务里只删「演示班」及其学生名下的行；教师账号和题库不动。
// 本地 PGlite 同一时刻只允许一个进程打开，所以清理前要先停掉服务。
//
// 「卡住」是按真实时间算的（写完最近一个关键步骤后 3 分钟没进展）：想在看板上看到卡住的学生，
// 播种结束后要再等约 3 分钟；播种脚本最后会打印确切的时间点。

import { randomBytes, randomUUID } from 'node:crypto';

const FLAG_CONFIRM = '--i-know-this-is-a-demo';
const FLAG_NON_LOCAL = '--allow-non-local-target';
const CLASS_NAME = '演示班';
const CLASS_TERM = '演示';
const REQUIRED_CONSENT = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((a) => ![FLAG_CONFIRM, FLAG_NON_LOCAL, '--cleanup', '--dry-run', '--wait-stuck'].includes(a));
if (unknown.length > 0) fail(`不认识的参数：${unknown.join(' ')}`);
if (!args.has(FLAG_CONFIRM)) {
  fail(`这是演示数据脚本，必须明确带上 ${FLAG_CONFIRM} 才会运行（它会建班、建学生账号，清理时会删数据）。`);
}
const teacherUser = process.env.DEMO_TEACHER_USER ?? 'demo';


// ---------------------------------------------------------------------------------------------------------
// 安全闸门
// ---------------------------------------------------------------------------------------------------------

function fail(message) {
  console.error(`demo-seed：${message}`);
  process.exit(1);
}

/** 主机名必须逐字等于本机名；不能用 includes，否则 localhost.evil.com 也会通过。 */
function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());
}

function assertLocalOrAllowed(what, hostname) {
  if (isLocalHost(hostname)) return;
  if (!args.has(FLAG_NON_LOCAL)) {
    fail(`${what}（${hostname}）不是本机地址，默认拒绝。确实要对它运行，请再加 ${FLAG_NON_LOCAL}。`);
  }
  console.warn(`警告：${what}（${hostname}）不是本机地址，已按 ${FLAG_NON_LOCAL} 放行。`);
}

// ---------------------------------------------------------------------------------------------------------
// 播种
// ---------------------------------------------------------------------------------------------------------

/** 12 个虚构学生 + 1 个留给现场演示首次登录。学号以 DEMO 开头，方便一眼认出是演示账号。 */
const STUDENTS = [
  { no: 'DEMO01', name: '林知远', plan: 'finished_pro' },
  { no: 'DEMO02', name: '周明哲', plan: 'finished_pro' },
  { no: 'DEMO03', name: '陈思齐', plan: 'finished_mid' },
  { no: 'DEMO04', name: '王子墨', plan: 'selfcheck' },
  { no: 'DEMO05', name: '赵可欣', plan: 'writing' },
  { no: 'DEMO06', name: '孙浩然', plan: 'stuck_hints' },
  { no: 'DEMO07', name: '吴雨桐', plan: 'stuck_empty' },
  { no: 'DEMO08', name: '郑书豪', plan: 'help_teacher' },
  { no: 'DEMO09', name: '冯嘉怡', plan: 'frame' },
  { no: 'DEMO10', name: '蒋逸飞', plan: 'logged_in_only' },
  { no: 'DEMO11', name: '韩晓菲', plan: 'self_study_active' },
  { no: 'DEMO12', name: '杨子轩', plan: 'self_study_done' },
];
const FRESH = { no: 'DEMO13', name: '何一鸣', plan: 'fresh' };

// 下面这些行取自引擎测试用的“学生写法”（packages/engine/test/support/scenarios.ts）和种子题的示例答案，
// 都是已知能被题目包的关键步骤匹配的文本。
const EPSN = {
  def: '∀ε>0，∃N，∀n>N，|a_n−A|<ε',
  frame: '任取 ε>0。取 N=（待构造）。则当 n>N 时，… < ε。',
  k: [
    ['|a_n−3| = 5/(n+2)', '通分化简：3n+1−3(n+2)=−5'],
    ['5/(n+2) < 5/n', '分母变小，分数变大'],
    ['取 N=⌈5/ε⌉', 'N 只依赖 ε，先于 n 取定'],
    ['当 n>N 时，|a_n−3| = 5/(n+2) < 5/n < ε', '前三行连成一条链'],
  ],
  vague: ['先把 N 取大一点吧', ''],
  wrongN: ['取 N=n+1', '先把 N 定下来'],
  selfcheck: ['第4行由第1、2、3行推出，用到化简、放大和 N 的取法', 'N 决定从第几项起，只依赖 ε', '换成 n≥1，第3行取 N 那一步就断了'],
  transfer: [
    ['|f(x)-3| = |2x-2| = 2|x-1|', '代入化简，绝对值里提出 2'],
    ['取 δ=ε/2', 'δ 只依赖 ε，先于 x 取定'],
    ['当 |x-1|<δ 时，|f(x)-3| = 2|x-1| < 2δ = ε', '前两行连成一条链'],
  ],
  summary: [
    '证明了极限等于 3',
    '分三块：化简、放大、取 N 收尾',
    'N 只依赖 ε，这个选择决定成败',
    '链条落到 <ε 才算证完',
    '放大到简单式子的做法下次还能用',
  ],
};
const SERIES = {
  def: '绝对收敛：∑|a_n| 收敛；条件收敛：∑a_n 收敛但 ∑|a_n| 发散。',
  frame: '判断：条件收敛。要证：(1) ∑a_n 收敛；(2) ∑|a_n| 发散。',
  k: [
    ['$\\frac{1}{\\sqrt{n+1}}<\\frac{1}{\\sqrt n}$，所以 $u_n$ 单调递减', '分母变大，分数变小'],
    ['$\\lim_{n\\to\\infty}\\frac{1}{\\sqrt n}=0$', '$u_n$ 趋于 0'],
    ['由莱布尼茨判别法，原级数收敛', '交错级数，通项单调递减且趋于 0'],
  ],
};

async function seed() {
  const base = new URL(process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000');
  assertLocalOrAllowed('目标服务', base.hostname);
  const teacherPassword = process.env.DEMO_TEACHER_PASSWORD ?? '';
  if (teacherPassword === '') fail('需要环境变量 DEMO_TEACHER_PASSWORD（教师账号的密码）。');
  const studentPassword = process.env.DEMO_STUDENT_PASSWORD ?? `Demo-${randomBytes(6).toString('base64url')}`;
  if ([...studentPassword].length < 8) fail('DEMO_STUDENT_PASSWORD 至少 8 个字符。');

  const teacher = new Actor(base, 'teacher');
  const login = await teacher.send('POST', '/auth/teacher/login', {
    username: teacherUser,
    password: teacherPassword,
    ...(process.env.DEMO_TEACHER_TOTP ? { totp: process.env.DEMO_TEACHER_TOTP } : {}),
  });
  if (!login.ok) {
    fail(
      `教师登录失败（${login.status}）。教师账号 ${teacherUser} 不存在的话，先建一个：\n` +
        `  TEACHER_PASSWORD=… node apps/server/src/db/cli.ts create-teacher ${teacherUser}\n` +
        '（服务用本地 PGlite 时，建账号要在服务停着的时候做。）',
    );
  }

  const classes = await teacher.json('GET', '/teacher/classes');
  if (classes.some((c) => c.name === CLASS_NAME)) {
    fail(`已经有一个「${CLASS_NAME}」了。先清理再重建：node tools/demo-seed.mjs --cleanup ${FLAG_CONFIRM}`);
  }

  const problems = await teacher.json('GET', '/teacher/problems?status=published&kind=main');
  for (const id of ['epsN', 'series']) {
    if (!problems.some((p) => p.problemId === id && !p.hiddenAt)) {
      fail(`题库里没有已发布且未下架的题目 ${id}。先运行 node apps/server/src/db/cli.ts seed。`);
    }
  }
  const epsN = problems.find((p) => p.problemId === 'epsN');

  console.log(`目标服务：${base.origin}；教师：${teacherUser}`);
  const cls = await teacher.json('POST', '/teacher/classes', { name: CLASS_NAME, term: CLASS_TERM });
  const roster = [...STUDENTS, FRESH].map((s) => `${s.no},${s.name}`).join('\n') + '\n';
  await teacher.json('POST', `/teacher/classes/${cls.classId}/roster`, roster, { 'content-type': 'text/csv' });
  const assignment = await teacher.json('POST', '/teacher/assignments', {
    classId: cls.classId,
    problemId: 'epsN',
    version: epsN.version,
    mode: 'practice',
    openAt: new Date(Date.now() - 60_000).toISOString(),
    // 提示额度调成 1：让「额度用完 + 求助老师」的学生能在几十秒内走到，现场不必干等。
    settings: { revealBudget: 1, photoEnabled: true, hintsEnabled: true, maxSwitches: 3 },
  });
  console.log(`已建「${CLASS_NAME}」，邀请码 ${cls.inviteCode}；布置：${epsN.title}`);

  // 先做会“卡住”的人：卡住要 3 分钟，越早动手越早显示。其余学生并发 3 个一批。
  const order = [...STUDENTS].sort((a, b) => Number(b.plan.startsWith('stuck')) - Number(a.plan.startsWith('stuck')));
  const results = [];
  const startedAt = Date.now();
  let cursor = 0;
  const worker = async () => {
    while (cursor < order.length) {
      const student = order[cursor++];
      try {
        const note = await runStudent(base, student, cls.inviteCode, assignment.assignmentId, studentPassword);
        results.push({ student, ok: true, note });
        console.log(`  ✓ ${student.no} ${student.name}：${note}`);
      } catch (error) {
        results.push({ student, ok: false, note: error instanceof Error ? error.message : String(error) });
        console.log(`  ✗ ${student.no} ${student.name}：${results.at(-1).note}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const failed = results.filter((r) => !r.ok);

  const stuckReady = new Date(startedAt + 3 * 60_000 + 15_000);
  if (args.has('--wait-stuck')) {
    const waitMs = stuckReady.getTime() - Date.now();
    if (waitMs > 0) {
      console.log(`等待「卡住」状态出现（约 ${Math.ceil(waitMs / 1000)} 秒）…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  console.log('\n演示班已就绪');
  console.log(`  教师端：${base.origin}/t/ ，教师 ${teacherUser}，打开班级「${CLASS_NAME}」`);
  console.log(`  学生端：${base.origin}/ ，用学号 + 密码登录；密码（12 个已激活的学生共用）：${studentPassword}`);
  console.log(`  学号：${[...STUDENTS].map((s) => `${s.no} ${s.name}`).join(' / ')}`);
  console.log(`  留给现场演示首次登录：学号 ${FRESH.no}（${FRESH.name}），邀请码 ${cls.inviteCode}（还没有账号，登录后会走开场动画）`);
  console.log(`  看板上“卡住”的学生约在 ${stuckReady.toLocaleTimeString('zh-CN', { hour12: false })} 之后出现（需要 3 分钟没有进展）。`);
  if (failed.length > 0) {
    console.error(`\n有 ${failed.length} 个学生没做完：${failed.map((r) => r.student.no).join('、')}（见上面的 ✗ 行）。`);
    process.exit(1);
  }
}

/** 按 plan 让一个学生走真实流程。返回一句话描述他现在的状态。 */
async function runStudent(base, student, inviteCode, assignmentId, password) {
  const me = new Actor(base, 'student');
  await onboardStudent(me, student, inviteCode, password);
  if (student.plan === 'logged_in_only') return '登录并签了同意书，还没打开题目';

  if (student.plan.startsWith('self_study')) return runSelfStudy(me, student);

  const started = await me.json('POST', `/student/assignments/${assignmentId}/attempt`);
  const id = started.state.attemptId;
  const step = new Steps(me, id);

  switch (student.plan) {
    case 'finished_pro':
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      for (const line of EPSN.k) await step.line(...line);
      await step.finish();
      await step.selfcheck(EPSN.selfcheck);
      await step.transfer(EPSN.transfer);
      await step.summary(EPSN.summary);
      return '独立做完全部六层';
    case 'finished_mid': {
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      await step.line(...EPSN.k[0]);
      await step.line(...EPSN.wrongN); // 取 N 依赖 n：收到一条问句批注
      await step.hint(); // 第一条提示（不计额度）
      await step.line(...EPSN.k[1]);
      await step.line(...EPSN.k[2]);
      await step.hint();
      await step.line(...EPSN.vague);
      await step.line(...EPSN.k[3]);
      await step.finish();
      await step.selfcheck(EPSN.selfcheck);
      await step.skip('L5');
      await step.summary(EPSN.summary);
      return '用了提示、有一次含糊的行，做完（会出现在错题里）';
    }
    case 'selfcheck':
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      for (const line of EPSN.k) await step.line(...line);
      await step.finish();
      return '写完证明，停在自检';
    case 'writing':
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      for (const line of EPSN.k.slice(0, 3)) await step.line(...line);
      return '第三层，已写出 3 个关键步骤，正在写';
    case 'stuck_hints':
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      await step.line(...EPSN.k[0]);
      await step.hint();
      await step.hint();
      return '第三层，写出 1 个关键步骤后停住（约 3 分钟后显示为卡住）';
    case 'stuck_empty':
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      return '第三层，一个关键步骤也没写出（约 3 分钟后显示为卡住）';
    case 'help_teacher':
      await step.def(EPSN.def);
      await step.frame(EPSN.frame);
      await step.line(...EPSN.k[0]);
      await step.hint();
      await step.hint();
      return step.exhaustAndFlag();
    case 'frame':
      await step.def(EPSN.def);
      return '定义已过，停在第二层搭骨架';
    default:
      throw new Error(`未知的 plan：${student.plan}`);
  }
}

/** 一个真实学生的第一次：学号 + 邀请码激活 → 设密码 → 年龄 → 同意书。 */
async function onboardStudent(me, student, inviteCode, password) {
  const deviceId = randomUUID();
  const login = await me.send('POST', '/auth/student/login', { inviteCode, studentNo: student.no, deviceId });
  if (!login.ok) throw new Error(`登录失败 ${login.status} ${login.text}`);
  await me.json('POST', '/auth/student/password', { newPassword: password });
  await me.json('POST', '/auth/student/age-band', { ageBand: 'ge18' });
  const doc = await me.json('GET', '/consents');
  await me.json('POST', '/consents', { version: doc.version, items: REQUIRED_CONSENT });
  await me.json('PATCH', '/student/settings', { nickname: student.name });
  // 密码登录一次，确认之后的演示可以用学号 + 密码进入（不带邀请码）。
  const again = new Actor(me.base, 'student');
  const check = await again.send('POST', '/auth/student/login', { studentNo: student.no, password, deviceId: randomUUID() });
  if (!check.ok) throw new Error(`用密码重新登录失败 ${check.status}`);
}

async function runSelfStudy(me, student) {
  const started = await me.json('POST', '/student/path/items/series/start');
  const id = started.state.attemptId;
  const step = new Steps(me, id);
  await step.def(SERIES.def);
  await step.frame(SERIES.frame);
  if (student.plan === 'self_study_active') {
    await step.line(...SERIES.k[0]);
    return '自学路径里在做「交错级数」，写出 1 个关键步骤';
  }
  for (const line of SERIES.k) await step.line(...line);
  const reveal = await me.send('POST', '/student/practice/series/solution/reveal', { level: 'approach' });
  return `自学路径里做「交错级数」到第三层，写出 ${SERIES.k.length} 个关键步骤${reveal.ok ? '，看过解题思路' : ''}`;
}

class Steps {
  constructor(actor, attemptId) {
    this.actor = actor;
    this.id = attemptId;
  }
  input() {
    return { provenance: 'keyboard', draftId: randomUUID() };
  }
  async post(path, body) {
    return this.actor.json('POST', `/attempts/${this.id}${path}`, body ?? undefined);
  }
  def(text) {
    return this.post('/definition', { text, input: this.input() });
  }
  frame(text) {
    return this.post('/framework', { text, input: this.input() });
  }
  line(statement, justification) {
    return this.post('/lines', { statement, justification, input: this.input() });
  }
  finish() {
    return this.post('/finish');
  }
  async selfcheck(answers) {
    for (const [index, text] of answers.entries()) {
      await this.post(`/selfcheck/SC${index + 1}`, { text, input: this.input() });
    }
  }
  async transfer(lines) {
    const child = await this.post('/transfer');
    const childId = child.state.attemptId;
    const sub = new Steps(this.actor, childId);
    for (const [statement, justification] of lines) await sub.line(statement, justification);
    await sub.finish();
  }
  summary(answers) {
    return this.post('/summary', { answers, input: this.input() });
  }
  skip(layer) {
    return this.post(`/layers/${layer}/skip`, {});
  }
  /** 求助：H0/H1 直接下发；返回结果里的预览 */
  async hint() {
    const res = await this.post('/help', { intent: 'stuck' });
    return res;
  }
  /** 把提示额度用完，再点“求助老师”。每条计额度的提示之间要等 20 秒并多写一行，所以最多尝试 100 秒。 */
  async exhaustAndFlag() {
    const deadline = Date.now() + 100_000;
    let exhausted = false;
    while (Date.now() < deadline && !exhausted) {
      const res = await this.actor.send('POST', `/attempts/${this.id}/help`, { intent: 'stuck' });
      const preview = res.body?.preview;
      if (!res.ok || preview === undefined) break;
      if (preview.reason === 'budget' || preview.softLanding?.includes('flag_teacher')) {
        exhausted = true;
      } else if (preview.allowed && preview.previewToken) {
        const claim = await this.actor.send('POST', `/attempts/${this.id}/hints/claim`, { previewToken: preview.previewToken });
        if (!claim.ok) break;
        const used = claim.body?.state?.budget;
        exhausted = used !== undefined && used.revealUsed >= used.revealMax;
      } else if (preview.reason === 'need_attempt') {
        await this.line(...EPSN.vague);
      } else {
        await new Promise((resolve) => setTimeout(resolve, (preview.waitSec ?? 5) * 1000 + 300));
      }
    }
    const flagged = await this.actor.send('POST', `/attempts/${this.id}/flag-teacher`);
    const head = exhausted ? '提示额度用完' : '提示额度还没用完';
    if (flagged.ok) return `${head}，点了「求助老师」`;
    if (flagged.status === 404) return `${head}（这个服务还没有「求助老师」接口，更新服务后重新运行即可）`;
    return `${head}，但「求助老师」没点成（${flagged.status}）`;
  }
}

/** 一个登录会话：自带 cookie 罐，每个演示学生/教师各用一个，互不串。 */
class Actor {
  constructor(base, app) {
    this.base = base;
    this.app = app;
    this.cookies = new Map();
  }
  async send(method, path, body, headers = {}) {
    const isJson = body !== undefined && typeof body !== 'string';
    const res = await fetch(new URL(`/api/v1${path}`, this.base), {
      method,
      headers: {
        'x-pg-app': this.app,
        ...(method === 'GET' ? {} : { 'x-requested-with': 'proof-gym' }),
        ...(method === 'POST' || method === 'PATCH' ? { 'idempotency-key': randomUUID() } : {}),
        ...(isJson ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size > 0 ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isJson ? JSON.stringify(body) : body,
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const value = pair.slice(eq + 1);
        if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(pair.slice(0, eq));
        else this.cookies.set(pair.slice(0, eq), value);
      }
    }
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, text, body: parsed };
  }
  async json(method, path, body, headers) {
    const res = await this.send(method, path, body, headers);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${res.text.slice(0, 200)}`);
    return res.body;
  }
}

// ---------------------------------------------------------------------------------------------------------
// 清理（直接连数据库，只删演示班和它的演示学生）
// ---------------------------------------------------------------------------------------------------------

async function cleanup() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl !== '') {
    let host;
    try {
      host = new URL(databaseUrl).hostname;
    } catch {
      fail('DATABASE_URL 无法解析。');
    }
    assertLocalOrAllowed('数据库', host);
  }
  const { openDb } = await import('../apps/server/src/db/index.ts');
  const db = await openDb({ databaseUrl, pgliteDir: process.env.PGLITE_DIR ?? '.data/pglite' });
  const dry = args.has('--dry-run');
  class DryRun extends Error {
    constructor(report) {
      super('dry-run');
      this.report = report;
    }
  }
  try {
    let report;
    try {
      report = await db.tx(async (tx) => {
      const owner = (await tx.query(`select user_id from app.teacher_accounts where username = $1`, [teacherUser])).rows[0];
      if (!owner) throw new Error(`没有教师账号 ${teacherUser}，不知道该清理谁的演示班（DEMO_TEACHER_USER）。`);
      const classIds = (
        await tx.query(`select id::text as id from app.classes where owner_id = $1 and name = $2 and term = $3`, [owner.user_id, CLASS_NAME, CLASS_TERM])
      ).rows.map((r) => r.id);
      if (classIds.length === 0) return { empty: true };

      // 演示学生 = 这些班的名单里被认领的账号 + 班级成员里的学生。
      const userIds = [
        ...new Set(
          (
            await tx.query(
              `select claimed_by::text as id from app.roster_entries where class_id::text = any($1) and claimed_by is not null
               union select user_id::text from app.class_members where class_id::text = any($1) and role = 'student'`,
              [classIds],
            )
          ).rows.map((r) => r.id),
        ),
      ];
      if (userIds.length > 0) {
        // 保险：必须全是学生账号，并且只属于演示班。任何一个不满足就整体放弃，什么都不删。
        const bad = (
          await tx.query(
            `select u.anon_code, u.role from app.users u
              where u.id::text = any($1)
                and (u.role <> 'student'
                     or exists (select 1 from app.class_members m where m.user_id = u.id and m.class_id::text <> all($2))
                     or exists (select 1 from app.roster_entries r where r.claimed_by = u.id and r.class_id::text <> all($2)))`,
            [userIds, classIds],
          )
        ).rows;
        if (bad.length > 0) {
          throw new Error(`拒绝清理：${bad.map((b) => `${b.anon_code}(${b.role})`).join('、')} 不是只属于演示班的学生。`);
        }
      }
      const attemptIds = (
        await tx.query(
          `select a.id::text as id from app.attempts a
            where a.user_id::text = any($1)
               or a.assignment_id in (select id from app.assignments where class_id::text = any($2))`,
          [userIds, classIds],
        )
      ).rows.map((r) => r.id);
      const assignmentIds = (await tx.query(`select id::text as id from app.assignments where class_id::text = any($1)`, [classIds])).rows.map((r) => r.id);

      const counts = {};
      // 事件表只能追加（触发器拦截更新/删除）。演示数据的事件只能在这个事务里临时关掉触发器来删，事务结束前恢复。
      await tx.query(`alter table ev.events disable trigger events_no_update`);
      const evDel = await tx.query(
        `delete from ev.events where class_id::text = any($1) or user_id::text = any($2) or attempt_id::text = any($3) or assignment_id::text = any($4)`,
        [classIds, userIds, attemptIds, assignmentIds],
      );
      counts['ev.events'] = evDel.rowCount ?? evDel.affectedRows ?? 0;
      await tx.query(`alter table ev.events enable trigger events_no_update`);
      await purgeIds(tx, 'app.attempts', 'id', attemptIds, counts);
      await purgeIds(tx, 'app.users', 'id', userIds, counts);
      await purgeIds(tx, 'app.classes', 'id', classIds, counts);
      const done = { counts, classes: classIds.length, users: userIds.length };
      if (dry) throw new DryRun(done); // 抛出 = 事务回滚，演练不留痕
      return done;
    });
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
      report = error.report;
    }
    if (report.empty) {
      console.log(`没有找到教师 ${teacherUser} 名下的「${CLASS_NAME}」，无需清理。`);
    } else {
      const lines = Object.entries(report.counts).filter(([, n]) => n > 0).map(([table, n]) => `  ${table}：${n}`);
      console.log(`${dry ? '（演练，未提交）将要' : '已'}删除 ${report.classes} 个演示班、${report.users} 个演示学生账号，以及它们名下的行：\n${lines.join('\n')}`);
    }
    if (dry) {
      console.log('演练结束：事务已回滚，数据库没有变化。');
    }
  } finally {
    await db.close?.();
  }
}

/**
 * 按外键关系删掉 ids 指向的行和所有依赖它们的行（子表先删）。只沿“单列外键”走，遇到没见过的结构直接报错，宁可不删。
 * 演练模式下用抛出的方式回滚事务。
 */
async function purgeIds(tx, table, pk, ids, counts, depth = 0) {
  if (ids.length === 0) return;
  if (depth > 8) throw new Error(`外键层级太深：${table}`);
  const children = (
    await tx.query(
      `select c.conrelid::regclass::text as child, ca.attname as child_col, pa.attname as parent_col,
              c.conrelid = c.confrelid as self_ref, array_length(c.conkey, 1) as width
         from pg_constraint c
         join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
         join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
        where c.contype = 'f' and c.confrelid = $1::regclass`,
      [table],
    )
  ).rows;
  for (const fk of children) {
    if (fk.width !== 1) throw new Error(`不支持的多列外键：${fk.child} → ${table}`);
    if (fk.parent_col !== pk) throw new Error(`外键 ${fk.child}.${fk.child_col} 指向 ${table}.${fk.parent_col}，不是主键 ${pk}`);
    if (fk.self_ref) {
      await tx.query(`update ${fk.child} set ${fk.child_col} = null where ${fk.child_col}::text = any($1)`, [ids]);
      continue;
    }
    // 没有任何行指向这些 id 的子表直接跳过（比如题库的审核人字段，演示学生不会出现在里面）。
    const hit = (await tx.query(`select 1 from ${fk.child} where ${fk.child_col}::text = any($1) limit 1`, [ids])).rows.length;
    if (hit === 0) continue;
    const childPk = (
      await tx.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indrelid = $1::regclass and i.indisprimary and i.indnatts = 1`,
        [fk.child],
      )
    ).rows[0]?.attname;
    if (childPk === undefined) {
      const referenced = (await tx.query(`select 1 from pg_constraint where contype = 'f' and confrelid = $1::regclass limit 1`, [fk.child])).rows.length;
      if (referenced > 0) throw new Error(`不支持：${fk.child} 没有单列主键却被其他表引用`);
      const del = await tx.query(`delete from ${fk.child} where ${fk.child_col}::text = any($1)`, [ids]);
      counts[fk.child] = (counts[fk.child] ?? 0) + (del.rowCount ?? del.affectedRows ?? 0);
      continue;
    }
    const childIds = (await tx.query(`select ${childPk}::text as id from ${fk.child} where ${fk.child_col}::text = any($1)`, [ids])).rows.map((r) => r.id);
    await purgeIds(tx, fk.child, childPk, childIds, counts, depth + 1);
  }
  const del = await tx.query(`delete from ${table} where ${pk}::text = any($1)`, [ids]);
  counts[table] = (counts[table] ?? 0) + (del.rowCount ?? del.affectedRows ?? 0);
}

// ---------------------------------------------------------------------------------------------------------
// 入口（放在文件末尾：类声明要先于使用）
// ---------------------------------------------------------------------------------------------------------

if (args.has('--cleanup')) {
  await cleanup();
} else {
  if (args.has('--dry-run')) fail('--dry-run 只用于 --cleanup');
  await seed();
}
