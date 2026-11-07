import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { studentNoHash } from '../src/auth/crypto.ts';
import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { areaOf, sanitizeContext } from '../src/feedback/context.ts';

import { addStudent, get, login, makeEnv, post, type Env } from './support/flow.ts';
import { cookieFrom, loginBody, setStudentAgeBand, testConfig, WRITE_HEADERS } from './support/fixtures.ts';

// 反馈信箱（15-反馈与信箱.md）：提交 → 开发者分类/回复/确认复现/结单 → 学生在信箱看到。
const PASSWORD = 'correct horse battery';

let env: Env;
beforeEach(async () => {
  env = await makeEnv();
});
afterEach(async () => {
  await env.close();
});

async function teacherCookie(username: string, role: 'teacher' | 'admin'): Promise<string> {
  await createTeacherAccount(env.db, { username, password: PASSWORD, role });
  const res = await env.app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

const devPost = (cookie: string, path: string, payload?: object) =>
  env.app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { ...WRITE_HEADERS, cookie }, ...(payload === undefined ? {} : { payload }) });
const devPatch = (cookie: string, path: string, payload: object) =>
  env.app.inject({ method: 'PATCH', url: `/api/v1${path}`, headers: { ...WRITE_HEADERS, cookie }, payload });
const devGet = (cookie: string, path: string) => env.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { cookie } });

async function submit(cookie: string, body = '键盘打不出分数线', extra: object = {}) {
  const res = await post(env, cookie, '/student/feedback', { kind: 'bug', body, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; refNo: number };
}

describe('探针上下文清洗', () => {
  it('去掉路径与面包屑里的 query/hash，保留 tap 名', () => {
    const ctx = sanitizeContext({
      route: '/pages/practice/index?attemptId=x&token=secret#top',
      breadcrumbs: [
        { kind: 'nav', text: '/pages/home/index?x=1' },
        { kind: 'api', text: 'POST /api/v1/attempts/1/lines?debug=1' },
        { kind: 'tap', text: 'step:3' },
      ],
    }) as { route: string; breadcrumbs: Array<{ text: string }> };
    expect(ctx.route).toBe('/pages/practice/index');
    expect(ctx.breadcrumbs.map((b) => b.text)).toEqual(['/pages/home/index', 'POST /api/v1/attempts/1/lines', 'step:3']);
  });

  it('超过 16KB 拒绝；缺省给空对象', () => {
    expect(sanitizeContext(undefined)).toEqual({});
    // 契约上限在纯 ASCII 时刚好不到 16KB；中文每字 3 字节，才会超。
    const big = { errors: Array.from({ length: 20 }, () => ({ message: '错'.repeat(200), name: 'n'.repeat(60), where: '处'.repeat(80) })), breadcrumbs: Array.from({ length: 30 }, () => ({ kind: 'tap', text: '点'.repeat(160), reqId: 'r'.repeat(64) })) };
    expect(() => sanitizeContext(big)).toThrow(/附带的信息太多/);
  });

  it('区域由路由推导', () => {
    expect(areaOf('/pages/practice/index')).toBe('practice');
    expect(areaOf('/pages/me/about?x=1')).toBe('me');
    expect(areaOf('/pages/unknown/x')).toBe('other');
    expect(areaOf(undefined)).toBe('other');
  });
});

describe('学生提交与信箱', () => {
  it('提交返回编号；上下文落库并推导区域；没带 page 时用 route', async () => {
    const cookie = await login(env);
    const receipt = await submit(cookie, '公式输不进去', {
      context: { route: '/pages/practice/index?a=1', pageName: '做题', problemId: 'epsN', stepNo: 2, targets: ['answer-input'] },
    });
    expect(receipt.refNo).toBeGreaterThan(0);
    const row = (await env.db.query<{ page: string; area: string; context: Record<string, unknown>; status: string; dev_unread: boolean }>(
      `select page, area, context, status, dev_unread from app.student_feedback`,
    )).rows[0];
    expect(row).toMatchObject({ page: '/pages/practice/index', area: 'practice', status: 'new', dev_unread: true });
    expect(row?.context).toMatchObject({ route: '/pages/practice/index', pageName: '做题', stepNo: 2 });
  });

  it('契约拒绝未知键与空内容；上下文里不接受作答正文之类的额外字段', async () => {
    const cookie = await login(env);
    expect((await post(env, cookie, '/student/feedback', { kind: 'bug', body: '   ' })).statusCode).toBe(422);
    expect((await post(env, cookie, '/student/feedback', { kind: 'bug', body: 'x', context: { proofText: '我的证明' } })).statusCode).toBe(422);
    expect((await post(env, cookie, '/student/feedback', { kind: 'bug', body: 'x', context: { breadcrumbs: [{ kind: 'tap', text: 'a', extra: 1 }] } })).statusCode).toBe(422);
  });

  it('需要已签同意书；同一个 Idempotency-Key 重放不重复落库', async () => {
    await env.db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)`, [env.fx.classId, studentNoHash(testConfig.studentNoPepper, '2026009')]);
    const res = await env.app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody({ studentNo: '2026009', deviceId: randomUUID() }) });
    expect(res.statusCode, res.body).toBe(200);
    const noConsent = cookieFrom(res.headers['set-cookie']);
    await setStudentAgeBand(env.app, noConsent); // 年龄段先选，才轮到同意书这一关
    expect((await post(env, noConsent, '/student/feedback', { kind: 'bug', body: 'x' })).statusCode).toBe(403);

    const cookie = await login(env);
    const key = randomUUID();
    const first = await post(env, cookie, '/student/feedback', { kind: 'idea', body: '想要深色模式' }, { 'idempotency-key': key });
    const again = await post(env, cookie, '/student/feedback', { kind: 'idea', body: '想要深色模式' }, { 'idempotency-key': key });
    expect(first.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect((await env.db.query(`select 1 from app.student_feedback`)).rows).toHaveLength(1);
  });

  it('只看得到自己的反馈；别人的 id 是 404', async () => {
    const a = await login(env);
    const mine = await submit(a);
    const b = await addStudent(env, '2026002');
    expect((await get(env, b, `/student/feedback/${mine.id}`)).statusCode).toBe(404);
    expect((await post(env, b, `/student/feedback/${mine.id}/messages`, { body: '我也想说' })).statusCode).toBe(404);
    expect((await get(env, b, '/student/feedback')).json().items).toHaveLength(0);
    expect((await get(env, a, '/student/feedback')).json().items).toHaveLength(1);
    expect((await get(env, a, '/student/feedback/not-a-uuid')).statusCode).toBe(404);
  });
});

describe('开发者账号', () => {
  it('create-teacher 的 role=admin 写进 users.role；缺省仍是 teacher', async () => {
    await createTeacherAccount(env.db, { username: 'a.dev', password: PASSWORD, role: 'admin' });
    await createTeacherAccount(env.db, { username: 'a.teacher', password: PASSWORD });
    const rows = (await env.db.query<{ username: string; role: string }>(
      `select t.username, u.role from app.teacher_accounts t join app.users u on u.id = t.user_id where t.username like 'a.%' order by t.username`,
    )).rows;
    expect(rows).toEqual([{ username: 'a.dev', role: 'admin' }, { username: 'a.teacher', role: 'teacher' }]);
  });
});

describe('开发者后台权限', () => {
  it('学生和普通教师都进不去；admin 可以', async () => {
    const student = await login(env);
    const teacher = await teacherCookie('plain.teacher', 'teacher');
    const admin = await teacherCookie('dev.admin', 'admin');
    expect((await devGet(student, '/teacher/feedback')).statusCode).toBe(403);
    expect((await devGet(teacher, '/teacher/feedback')).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/teacher/feedback' })).statusCode).toBe(401);
    expect((await devGet(admin, '/teacher/feedback')).statusCode).toBe(200);
  });
});

describe('回复、结单与信箱红点', () => {
  it('完整流程：提交 → 开发者回复(正在看) → 学生红点/已读 → 学生追问 → 开发者想问问你 → 学生补充 → 已解决 → 学生追问重开', async () => {
    const student = await login(env);
    const admin = await teacherCookie('dev.admin', 'admin');
    const { id } = await submit(student);

    expect((await get(env, student, '/me')).json().feedbackUnread).toBe(0);

    // 开发者看到一条未读的新反馈，打开后已读。
    const list = (await devGet(admin, '/teacher/feedback?unread=true')).json();
    expect(list.items).toHaveLength(1);
    expect(list.counts).toMatchObject({ new: 1, open: 0 });
    expect(list.items[0]).toMatchObject({ status: 'new', devUnread: true, anonCode: expect.any(String), className: '高数 A 班' });
    const opened = (await devGet(admin, `/teacher/feedback/${id}`)).json();
    expect(opened.messages).toEqual([expect.objectContaining({ from: 'student', body: '键盘打不出分数线' })]);
    expect((await devGet(admin, '/teacher/feedback?unread=true')).json().items).toHaveLength(0);

    // 回复：new → open，学生出红点。
    const replied = await devPost(admin, `/teacher/feedback/${id}/messages`, { body: '收到，在看了' });
    expect(replied.statusCode, replied.body).toBe(201);
    expect(replied.json().status).toBe('open');
    expect((await get(env, student, '/me')).json().feedbackUnread).toBe(1);
    const inbox = (await get(env, student, '/student/feedback')).json();
    expect(inbox).toMatchObject({ unread: 1, items: [expect.objectContaining({ status: 'open', unread: true, lastReply: '收到，在看了' })] });

    // 学生打开：已读，对话里 me/dev 视角正确。
    const thread = (await get(env, student, `/student/feedback/${id}`)).json();
    expect(thread.messages.map((m: { from: string }) => m.from)).toEqual(['me', 'dev']);
    expect((await get(env, student, '/me')).json().feedbackUnread).toBe(0);

    // 开发者想问问你 → 学生回复 → 回到 open 且开发者出现未读。
    expect((await devPost(admin, `/teacher/feedback/${id}/messages`, { body: '用的什么手机？', setStatus: 'need_info' })).json().status).toBe('need_info');
    expect((await post(env, student, `/student/feedback/${id}/messages`, { body: 'iPhone 13' })).statusCode).toBe(201);
    expect((await devGet(admin, `/teacher/feedback/${id}`)).json().status).toBe('open');

    // 回复并解决：说明就是回复内容，学生下次打开收到一次性 resolved 事件。
    const resolved = (await devPost(admin, `/teacher/feedback/${id}/messages`, { body: '已修复，刷新一下就好', setStatus: 'resolved' })).json();
    expect(resolved).toMatchObject({ status: 'resolved', resolutionNote: '已修复，刷新一下就好' });
    const t1 = (await get(env, student, `/student/feedback/${id}`)).json();
    expect(t1).toMatchObject({ status: 'resolved', event: 'resolved' });
    expect((await get(env, student, `/student/feedback/${id}`)).json().event).toBeNull();

    // 14 天内追问会重新打开；超过 14 天 409。
    expect((await post(env, student, `/student/feedback/${id}/messages`, { body: '还是不行' })).statusCode).toBe(201);
    expect((await get(env, student, `/student/feedback/${id}`)).json().status).toBe('open');
    await devPost(admin, `/teacher/feedback/${id}/messages`, { body: '再看看', setStatus: 'resolved' });
    await env.db.query(`update app.student_feedback set resolved_at = now() - interval '15 days' where id = $1`, [id]);
    const late = await post(env, student, `/student/feedback/${id}/messages`, { body: '又坏了' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('FEEDBACK_CLOSED');
  });

  it('改状态规则：resolved/closed 必须写说明，closed 必须选原因；说明会作为回复发给学生；关闭后双方都不能再回复', async () => {
    const student = await login(env);
    const admin = await teacherCookie('dev.admin', 'admin');
    const { id } = await submit(student);

    expect((await devPatch(admin, `/teacher/feedback/${id}`, { status: 'resolved' })).statusCode).toBe(422);
    expect((await devPatch(admin, `/teacher/feedback/${id}`, { status: 'closed', note: '重复了' })).statusCode).toBe(422);
    expect((await devPatch(admin, `/teacher/feedback/${id}`, { status: 'open', closeReason: 'fixed' })).statusCode).toBe(422);
    expect((await devPatch(admin, `/teacher/feedback/${id}`, {})).statusCode).toBe(422);
    expect((await devPatch(admin, `/teacher/feedback/${id}`, { status: 'weird' })).statusCode).toBe(422);

    const closed = await devPatch(admin, `/teacher/feedback/${id}`, { status: 'closed', closeReason: 'duplicate', note: '和 #1 是同一个问题' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({ status: 'closed', closeReason: 'duplicate' });
    const thread = (await get(env, student, `/student/feedback/${id}`)).json();
    expect(thread).toMatchObject({ status: 'closed', closeReason: 'duplicate' });
    expect(thread.messages.at(-1)).toMatchObject({ from: 'dev', body: '和 #1 是同一个问题' });
    expect((await post(env, student, `/student/feedback/${id}/messages`, { body: '嗯' })).statusCode).toBe(409);
    expect((await devPost(admin, `/teacher/feedback/${id}/messages`, { body: '嗯' })).statusCode).toBe(409);

    // 重新打开后清掉结单信息。
    const reopened = (await devPatch(admin, `/teacher/feedback/${id}`, { status: 'open' })).json();
    expect(reopened).toMatchObject({ status: 'open', closeReason: null });
  });

  it('分类与筛选：category/area/status/搜索；计数不受筛选影响', async () => {
    const student = await login(env);
    const admin = await teacherCookie('dev.admin', 'admin');
    const a = await submit(student, '分数线打不出', { context: { route: '/pages/practice/index' } });
    await submit(student, '希望有深色模式', { context: { route: '/pages/me/index' } });
    await devPatch(admin, `/teacher/feedback/${a.id}`, { category: 'bug', area: 'keyboard' });

    expect((await devGet(admin, '/teacher/feedback?category=bug')).json().items).toHaveLength(1);
    expect((await devGet(admin, '/teacher/feedback?area=me')).json().items).toHaveLength(1);
    expect((await devGet(admin, '/teacher/feedback?area=keyboard')).json().items[0].refNo).toBe(a.refNo);
    expect((await devGet(admin, '/teacher/feedback?q=%E6%B7%B1%E8%89%B2')).json().total).toBe(1);
    expect((await devGet(admin, '/teacher/feedback?q=%25')).json().total).toBe(0); // % 不当通配符
    const filtered = (await devGet(admin, '/teacher/feedback?status=open')).json();
    expect(filtered.items).toHaveLength(0);
    expect(filtered.counts.new).toBe(2);
    expect((await devGet(admin, '/teacher/feedback?status=nope')).statusCode).toBe(422);
    expect((await devGet(admin, '/teacher/feedback?limit=0')).statusCode).toBe(422);
  });
});

describe('确认复现与「捉虫小能手」勋章', () => {
  it('分类不是故障/显示异常时拒绝；确认后发勋章、学生看到一次性庆祝；重复确认不重复发', async () => {
    const student = await login(env);
    const admin = await teacherCookie('dev.admin', 'admin');
    const { id } = await submit(student);

    expect((await devPost(admin, `/teacher/feedback/${id}/confirm`)).statusCode).toBe(422);
    await devPatch(admin, `/teacher/feedback/${id}`, { category: 'suggestion' });
    expect((await devPost(admin, `/teacher/feedback/${id}/confirm`)).statusCode).toBe(422);

    await devPatch(admin, `/teacher/feedback/${id}`, { category: 'bug' });
    const first = await devPost(admin, `/teacher/feedback/${id}/confirm`, { note: '复现了，今晚修' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ confirmed: true, badgeGranted: true });
    expect((await devPost(admin, `/teacher/feedback/${id}/confirm`)).json()).toEqual({ confirmed: true, badgeGranted: false });

    const badges = (await env.db.query<{ badge_id: string }>(`select badge_id from app.student_badges`)).rows;
    expect(badges).toEqual([{ badge_id: 'bug_hunter' }]);
    const progress = (await get(env, student, '/student/progress')).json();
    expect(progress.badges.find((b: { id: string }) => b.id === 'bug_hunter')).toMatchObject({ title: '捉虫小能手', earnedAt: expect.any(String) });

    const t = (await get(env, student, `/student/feedback/${id}`)).json();
    expect(t).toMatchObject({ confirmed: true, event: 'confirmed', status: 'open' });
    expect(t.messages.filter((m: { body: string }) => m.body === '复现了，今晚修')).toHaveLength(1);
    expect((await get(env, student, `/student/feedback/${id}`)).json().event).toBeNull();
  });

  it('同一个学生第二次被确认：确认成功但不再发勋章', async () => {
    const student = await login(env);
    const admin = await teacherCookie('dev.admin', 'admin');
    const one = await submit(student, '问题一');
    const two = await submit(student, '问题二');
    for (const f of [one, two]) await devPatch(admin, `/teacher/feedback/${f.id}`, { category: 'display' });
    expect((await devPost(admin, `/teacher/feedback/${one.id}/confirm`)).json().badgeGranted).toBe(true);
    expect((await devPost(admin, `/teacher/feedback/${two.id}/confirm`)).json()).toEqual({ confirmed: true, badgeGranted: false });
    expect((await env.db.query(`select 1 from app.student_badges where badge_id = 'bug_hunter'`)).rows).toHaveLength(1);
  });

  it('学生不能自己确认；勋章不会因为提交反馈而自动发', async () => {
    const student = await login(env);
    const { id } = await submit(student);
    expect((await post(env, student, `/teacher/feedback/${id}/confirm`)).statusCode).toBe(403);
    expect((await env.db.query(`select 1 from app.student_badges`)).rows).toHaveLength(0);
  });
});

describe('请求 ID', () => {
  it('合格的 X-Request-Id 原样回显，不合格的换成服务端生成的', async () => {
    const ok = await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: { 'x-request-id': 'req_abc12345' } });
    expect(ok.headers['x-request-id']).toBe('req_abc12345');
    const bad = await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: { 'x-request-id': 'bad id\nx' } });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
