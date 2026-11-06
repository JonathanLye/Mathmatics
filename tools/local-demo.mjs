#!/usr/bin/env node
// 本地演示数据：对一个已启动的本地服务（默认 http://127.0.0.1:3000）建班、导入名单、布置两道主题题，
// 并打印学生登录需要的邀请码和学号。只用 HTTP 接口，不碰数据库文件；可重复运行（每次建一个新班）。
//
//   TEACHER_PASSWORD=… node tools/local-demo.mjs [用户名，默认 demo]
//
// 先决条件：服务已按 README 启动，且教师账号已创建（node apps/server/src/db/cli.ts create-teacher demo）。
// 这是演示脚本，不属于生产代码。
const base = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const username = process.argv[2] ?? 'demo';
const password = process.env.TEACHER_PASSWORD ?? '';
if (password === '') {
  console.error('需要环境变量 TEACHER_PASSWORD');
  process.exit(1);
}

let cookie = '';
async function api(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'x-requested-with': 'proof-gym', ...(cookie ? { cookie } : {}), ...(body && typeof body === 'object' ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return json;
}

await api('POST', '/auth/teacher/login', { body: { username, password } });
const stamp = new Date().toISOString().slice(11, 19);
const cls = await api('POST', '/teacher/classes', { body: { name: `演示班 ${stamp}`, term: '2026 秋' } });
const students = ['2026001,张三', '2026002,李四', '2026003,王五'];
await api('POST', `/teacher/classes/${cls.classId}/roster`, { body: `${students.join('\n')}\n`, headers: { 'content-type': 'text/csv' } });

const problems = await api('GET', '/teacher/problems?status=published');
const mains = problems.filter((p) => !p.problemId.includes('-T')).map((p) => p.problemId);
const openAt = new Date(Date.now() - 60_000).toISOString();
const assigned = [];
for (const problemId of mains) {
  const version = problems.find((p) => p.problemId === problemId).version ?? 1;
  const a = await api('POST', '/teacher/assignments', { body: { classId: cls.classId, problemId, version, mode: 'practice', openAt } });
  assigned.push(`${problemId}（${a.assignmentId ?? a.id}）`);
}

console.log('\n演示数据已就绪');
console.log(`  邀请码：${cls.inviteCode}`);
console.log(`  学号：${students.map((s) => s.split(',')[0]).join(' / ')}（任选其一登录学生端）`);
console.log(`  已布置：${assigned.join('、')}`);
