/**
 * server.mjs —— 零依赖 Node 后端（HTTP + 静态文件 + 全部 API）
 * 运行：node server/server.mjs（默认 8787，PORT / DB_PATH 可覆盖）
 * 测试：const { createServer } = await import('./server.mjs');
 *       const app = createServer({ port: 0, dbPath: tmp }); await app.start(); ... await app.close();
 * 只依赖 node:http / node:fs / node:path / node:crypto / node:url。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from './store.mjs';
import { buildSeed } from './seed.mjs';
import * as ai from './ai.mjs';
import { check, LIMITS, SAFE_TEXT } from './guard.mjs';
import { dashboard, studentDetail, csv } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const DEFAULT_DB = path.join(__dirname, 'data', 'db.json');

const PHASES = ai.PHASES;
const BUDGETS = ai.BUDGETS;

const ROUTES = [
  { method: 'GET', path: '/api/health', desc: '健康检查（ok/mode/uptime/db 计数）' },
  { method: 'GET', path: '/api/meta', desc: '演示元信息（邀请码/阶段/预算/端点清单）' },
  { method: 'POST', path: '/api/login', desc: '邀请码 + 学号登录，返回 Bearer token' },
  { method: 'GET', path: '/api/home', desc: '学生首页（本周进度/继续上次/复测）' },
  { method: 'GET', path: '/api/problems', desc: '题库列表（chapter/kp/difficulty/type 筛选）' },
  { method: 'GET', path: '/api/problems/:id', desc: '题目详情（白名单，不含关键步骤/提示/参考证明）' },
  { method: 'POST', path: '/api/attempts', desc: '开始或继续一次作答' },
  { method: 'GET', path: '/api/attempts/:id', desc: '恢复作答状态与消息' },
  { method: 'POST', path: '/api/attempts/:id/step', desc: '提交一步：诊断 + 三段式 + 闸门' },
  { method: 'POST', path: '/api/attempts/:id/hint', desc: '请求提示（服务端判解锁/预算，409/429）' },
  { method: 'POST', path: '/api/attempts/:id/answer-request', desc: '要答案 → 三段式拒绝 + 替代动作' },
  { method: 'POST', path: '/api/attempts/:id/xiaobai', desc: '小白解释三件套（≤2 次）' },
  { method: 'POST', path: '/api/attempts/:id/final', desc: '交终稿 → 覆盖表（问句化）' },
  { method: 'POST', path: '/api/attempts/:id/review', desc: '五问复盘 → 掌握度' },
  { method: 'POST', path: '/api/attempts/:id/variant', desc: '变式题 → 完成并判定独立性' },
  { method: 'GET', path: '/api/teacher/dashboard', desc: '教师看板聚合（KPI/卡点/未完成/学生列表）' },
  { method: 'GET', path: '/api/teacher/students/:studentId', desc: '学生详情（attempts + events）' },
  { method: 'GET', path: '/api/teacher/export.csv', desc: '导出匿名 CSV（UTF-8 BOM）' },
  { method: 'GET', path: '/api/events', desc: '事件流（?attemptId=&limit=50）' },
  { method: 'GET', path: '/api/admin/routes', desc: '端点清单（后端面板用）' },
  { method: 'GET', path: '/api/admin/stats', desc: '运维统计（mode/db/guard/最近事件）' },
  { method: 'POST', path: '/api/admin/reset', desc: '重置种子数据' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 8); }
function pad(n) { return String(n).padStart(2, '0'); }

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function fail(res, status, code, message, detail) {
  const err = { error: { code, message } };
  if (detail !== undefined) err.error.detail = detail;
  json(res, status, err);
}
function text(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function whitelistProblem(p) {
  return {
    id: p.id, title: p.title, chapter: p.chapter, kp: p.kp, difficulty: p.difficulty,
    type: p.type, estimatedMin: p.estimatedMin, stem: p.stem, status: p.status,
    hasScript: !!p.hasScript, available: !!p.hasScript && p.status === 'published',
  };
}
function freshCoverage(problem) {
  const total = (problem.keySteps || []).length;
  return { covered: 0, total, percent: 0, passed: false, items: [] };
}
function newAttempt(store, studentId, problem) {
  const a = {
    id: id('a'), studentId, problemId: problem.id,
    startedAt: nowIso(), finishedAt: null,
    phase: 'P1', node: 1, round: 0,
    budgets: { ...BUDGETS },
    used: { L1: 0, L2: 0, L3: 0, L4: 0, L0: 0, xiaobai: 0, refusals: 0 },
    unlocked: ['L0'], independence: null, pasteFlags: 0,
    fails: 0, stepsSubmitted: 0,
    chat: [], draft: [], hintLog: [],
    coverage: freshCoverage(problem), finalText: '', review: null, variantResult: null,
    timeMin: 0, stuckPoints: [],
  };
  store.db.attempts.push(a);
  return a;
}
function computeIndependence(attempt) {
  const u = attempt.used || {};
  if ((u.L3 || 0) > 0 || (u.L4 || 0) > 0 || (attempt.pasteFlags || 0) > 0) return 'dependent';
  if ((u.L1 || 0) > 0 || (u.L2 || 0) > 0) return 'semi';
  return 'independent';
}
function stateOf(attempt, problem) {
  return {
    attemptId: attempt.id, problemId: attempt.problemId,
    node: attempt.node, round: attempt.round, nodeTotal: ai.TOTAL_NODES,
    phase: attempt.phase, phaseLabel: ai.PHASE_LABEL[attempt.phase] || attempt.phase,
    budgets: attempt.budgets, used: attempt.used,
    unlocked: attempt.unlocked, independence: attempt.independence,
    draft: attempt.draft, coverage: attempt.coverage,
    startedAt: attempt.startedAt, finishedAt: attempt.finishedAt,
  };
}
function guardLevel(tag) {
  const m = /^L([0-4])/.exec(String(tag || ''));
  return m ? 'L' + m[1] : 'L0';
}
function softLandingOptions() {
  return [
    { id: 'l0', label: '只做 L0 追问', desc: '不再给新信息，只问依据' },
    { id: 'definition', label: '看定义卡', desc: '只给定义/定理原文' },
    { id: 'easier', label: '换同知识点更简单题', desc: '换一道更小的问题继续' },
    { id: 'teacher', label: '转教师', desc: '保存草稿，生成教师工单' },
  ];
}

export function createServer(options = {}) {
  const dbPath = path.resolve(options.dbPath || process.env.DB_PATH || DEFAULT_DB);
  const store = createStore(dbPath);
  const tokens = new Map();
  const guardStats = { checked: 0, blocked: 0, byRule: {} };
  let fallbackToMock = false;
  const startedAt = Date.now();
  const mode = () => (process.env.DEEPSEEK_API_KEY && !fallbackToMock ? 'deepseek' : 'mock');

  function recordGuard(result) {
    guardStats.checked += 1;
    if (result.blocked) {
      guardStats.blocked += 1;
      for (const rule of result.rules) guardStats.byRule[rule] = (guardStats.byRule[rule] || 0) + 1;
    }
  }
  function logEvent(evt) {
    store.addEvent({
      id: id('e'), ts: nowIso(), studentId: evt.studentId || null, attemptId: evt.attemptId || null,
      type: evt.type, level: evt.level || null, text: evt.text || '', meta: evt.meta || {},
      durationMs: evt.durationMs == null ? null : evt.durationMs,
    });
  }
  function studentById(sid) {
    const roster = store.db.students.find((s) => s.id === sid || s.sid === sid);
    if (roster) return roster;
    const demo = store.db.meta.demoStudent;
    if (demo && sid === demo.id) return demo;
    return null;
  }
  function publicStudent(s) {
    return { id: s.id, sid: s.sid, name: s.name, className: s.className };
  }
  function auth(req) {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return null;
    const sid = tokens.get(m[1]);
    if (!sid) return null;
    return { studentId: sid, student: studentById(sid), token: m[1] };
  }
  function getAttempt(aid) { return store.db.attempts.find((a) => a.id === aid) || null; }
  function touchTime(attempt) {
    if (!attempt.finishedAt) attempt.timeMin = Math.max(1, Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 60000));
  }
  function problemsOf(problemId) { return store.db.problems.find((p) => p.id === problemId) || null; }

  async function handle(req, res, url) {
    const p = url.pathname;
    const method = req.method;

    if (p === '/api/health' && method === 'GET') {
      return json(res, 200, {
        ok: true, mode: mode(), version: store.db.meta.version,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        db: store.counts(),
      });
    }
    if (p === '/api/meta' && method === 'GET') {
      return json(res, 200, {
        inviteCodes: [store.db.meta.inviteCode], demoStudentId: 'demo',
        demoStudent: publicStudent(store.db.meta.demoStudent),
        phases: PHASES, budgets: BUDGETS, routes: ROUTES,
      });
    }
    if (p === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const inviteCode = String(body.inviteCode || '');
      const studentId = String(body.studentId || '').trim();
      if (!studentId) return fail(res, 400, 'BAD_REQUEST', '请填写学号');
      const validInvite = inviteCode === store.db.meta.inviteCode || inviteCode === 'MATH-A-2026';
      if (!validInvite) return fail(res, 401, 'INVALID_INVITE', '邀请码不正确');
      const roster = store.db.students.find((s) => s.id === studentId || s.sid === studentId);
      let student = roster;
      if (!student) {
        student = { ...store.db.meta.demoStudent, sid: studentId };
        if (studentId === 'demo') student = { ...store.db.meta.demoStudent };
      }
      const token = 't-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      tokens.set(token, student.id);
      logEvent({ studentId: student.id, type: 'login', meta: { role: 'student' } });
      return json(res, 200, { token, student: publicStudent(student) });
    }
    if (p === '/api/admin/routes' && method === 'GET') return json(res, 200, ROUTES);
    if (p === '/api/admin/stats' && method === 'GET') {
      const recentEvents = store.db.events.slice(-10).reverse().map((e) => ({ id: e.id, ts: e.ts, type: e.type, level: e.level, studentId: e.studentId, attemptId: e.attemptId }));
      return json(res, 200, {
        mode: mode(), uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        db: store.counts(),
        guard: { checked: guardStats.checked, blocked: guardStats.blocked, byRule: guardStats.byRule },
        recentEvents,
      });
    }
    if (p === '/api/admin/reset' && method === 'POST') {
      const reseededAt = store.reset();
      guardStats.checked = 0; guardStats.blocked = 0; guardStats.byRule = {};
      fallbackToMock = false;
      return json(res, 200, { ok: true, reseededAt });
    }

    // ---------- 学生端（需 token） ----------
    const isStudentApi = p === '/api/home' || p.startsWith('/api/problems') || p.startsWith('/api/attempts') || p === '/api/events';
    let who = null;
    if (isStudentApi) {
      who = auth(req);
      if (!who) return fail(res, 401, 'UNAUTHORIZED', '请先登录（缺少或无效的 Bearer token）');
    }

    if (p === '/api/home' && method === 'GET') {
      const attempts = store.db.attempts.filter((a) => a.studentId === who.studentId);
      const requiredIds = new Set(store.db.problems.filter((x) => x.type === 'required').map((x) => x.id));
      const doneSet = new Set(attempts.filter((a) => a.finishedAt && requiredIds.has(a.problemId)).map((a) => a.problemId));
      const done = doneSet.size;
      const required = requiredIds.size;
      const unfinished = attempts.filter((a) => !a.finishedAt).sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1));
      const cont = unfinished[0];
      const contProblem = cont ? problemsOf(cont.problemId) : null;
      const finishedCount = attempts.filter((a) => a.finishedAt).length;
      const due = new Date(Date.now() + 28 * 86400000);
      return json(res, 200, {
        student: publicStudent(who.student),
        weekly: { required, done, percent: required ? Math.round((done / required) * 100) : 0 },
        continue: cont ? { attemptId: cont.id, problemId: cont.problemId, title: contProblem ? contProblem.title : '', node: cont.node, phase: cont.phase } : null,
        retest: { date: due.toISOString().slice(0, 10), days: 28 },
        counts: { completed: finishedCount, inProgress: unfinished.length, hintRounds: attempts.reduce((s, a) => s + (a.used.L1 + a.used.L2 + a.used.L3 + a.used.L4), 0) },
      });
    }
    if (p === '/api/problems' && method === 'GET') {
      const chapter = url.searchParams.get('chapter');
      const kp = url.searchParams.get('kp');
      const difficulty = url.searchParams.get('difficulty');
      const type = url.searchParams.get('type');
      let items = store.db.problems.slice();
      if (chapter) items = items.filter((x) => x.chapter === chapter);
      if (kp) items = items.filter((x) => (x.kp || []).some((k) => k.includes(kp)));
      if (difficulty) items = items.filter((x) => x.difficulty === difficulty);
      if (type) items = items.filter((x) => x.type === type);
      return json(res, 200, { total: items.length, items: items.map(whitelistProblem) });
    }
    const problemMatch = /^\/api\/problems\/([^/]+)$/.exec(p);
    if (problemMatch && method === 'GET') {
      const problem = problemsOf(decodeURIComponent(problemMatch[1]));
      if (!problem) return fail(res, 404, 'NOT_FOUND', '题目不存在');
      return json(res, 200, whitelistProblem(problem));
    }
    if (p === '/api/attempts' && method === 'POST') {
      const body = await readBody(req);
      const problem = problemsOf(String(body.problemId || ''));
      if (!problem) return fail(res, 404, 'NOT_FOUND', '题目不存在');
      if (!problem.hasScript || problem.status !== 'published') {
        return fail(res, 409, 'WRONG_PHASE', '该题暂未开放完整脚本（Demo 只完整开放第 1 题）', { problemId: problem.id, available: false });
      }
      let attempt = store.db.attempts.find((a) => a.studentId === who.studentId && a.problemId === problem.id && !a.finishedAt);
      let created = false;
      if (!attempt) { attempt = newAttempt(store, who.studentId, problem); created = true; }
      logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'attempt_start', meta: { problemId: problem.id, created } });
      store.persist();
      return json(res, created ? 201 : 200, { attemptId: attempt.id, problem: whitelistProblem(problem), state: stateOf(attempt, problem) });
    }
    const attemptMatch = /^\/api\/attempts\/([^/]+)(?:\/(step|hint|answer-request|xiaobai|final|review|variant))?$/.exec(p);
    if (attemptMatch) {
      const attempt = getAttempt(decodeURIComponent(attemptMatch[1]));
      if (!attempt) return fail(res, 404, 'NOT_FOUND', '作答不存在');
      const problem = problemsOf(attempt.problemId);
      const sub = attemptMatch[2] || null;

      if (!sub && method === 'GET') {
        const st = stateOf(attempt, problem);
        const attemptOut = {
          id: attempt.id, attemptId: attempt.id, studentId: attempt.studentId, problemId: attempt.problemId,
          phase: attempt.phase, node: attempt.node, round: attempt.round, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt,
          independence: attempt.independence, budgets: attempt.budgets, used: attempt.used, unlocked: attempt.unlocked,
          draft: attempt.draft, coverage: attempt.coverage, finalText: attempt.finalText, review: attempt.review, variantResult: attempt.variantResult,
        };
        return json(res, 200, { attempt: attemptOut, problem: whitelistProblem(problem), state: st, messages: attempt.chat });
      }
      if (sub === 'step' && method === 'POST') {
        const body = await readBody(req);
        const input = String(body.text || '').trim();
        if (!input) return fail(res, 400, 'BAD_REQUEST', '这一步还没写内容');
        if (attempt.finishedAt) return fail(res, 409, 'WRONG_PHASE', '这次作答已结束');
        const def = ai.SCRIPT[attempt.node - 1];
        if (!def || def.type === 'hint') return fail(res, 409, 'WRONG_PHASE', '当前节点请用「提示阶梯」（/hint）', { node: attempt.node, use: '/hint' });
        if (def.type === 'refuse') return fail(res, 409, 'WRONG_PHASE', '当前节点请点「我要答案」（/answer-request）', { node: attempt.node, use: '/answer-request' });
        if (attempt.node >= 9) return fail(res, 409, 'WRONG_PHASE', '当前请交终稿（/final）或复盘（/review）', { node: attempt.node });

        const info = ai.stepInfo(attempt);
        if (!info) return fail(res, 409, 'WRONG_PHASE', '当前节点不支持提交步骤');
        const diagnosis = ai.diagnose(input, { node: attempt.node, problem });
        if ([...input.replace(/\s/g, '')].length >= 80) { attempt.pasteFlags = (attempt.pasteFlags || 0) + 1; logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'paste', meta: { length: input.length } }); }

        let aiOut = { ...info.round.ai };
        let source = 'mock';
        if (process.env.DEEPSEEK_API_KEY) {
          const user = '题目：' + problem.stem + '\n当前节点：第 ' + attempt.node + ' 节点（' + info.def.title + '）\n学生刚写：' + input +
            '\n请只输出 JSON：{"judge":"≤25字 引用学生原话","hint":"按 L0 信息量给，不给答案","ask":"一个问句≤40字"}。禁止完整证明、编号步骤、证毕/综上。';
          const real = await ai.tryDeepSeek({ system: '你是数学分析证明题助教，只做苏格拉底式追问，绝不写证明或答案。', user });
          if (real) { aiOut = real; source = 'deepseek'; } else { fallbackToMock = true; }
        }
        const combined = [aiOut.judge, aiOut.hint, aiOut.ask].join('\n');
        const level = guardLevel(aiOut.tag);
        const maxLen = level === 'L4' ? 200 : 130;
        const g = check(combined, { level, maxLen, keySteps: problem.keySteps, referenceProof: problem.referenceProof, history: attempt.hintLog.slice(-3) });
        recordGuard(g);
        let guardOut = { ok: true, blocked: false, rules: [] };
        if (g.blocked) {
          aiOut = ai.safeAi();
          guardOut = { ok: false, blocked: true, rules: g.rules };
          logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'leak_blocked', level, text: SAFE_TEXT, meta: { rules: g.rules, source } });
        }
        attempt.chat.push({ role: 'student', content: { text: input }, text: input, ts: nowIso() });
        attempt.chat.push({ role: 'ai', content: { judge: aiOut.judge, hint: aiOut.hint, ask: aiOut.ask }, tag: aiOut.tag, ts: nowIso() });
        attempt.hintLog.push([aiOut.judge, aiOut.hint].join(' / '));
        if (info.round.draftLine && !attempt.draft.some((d) => d.tag === info.round.draftLine.tag)) attempt.draft.push({ ...info.round.draftLine });
        attempt.stepsSubmitted = (attempt.stepsSubmitted || 0) + 1;
        if (diagnosis.verdict === 'ok') attempt.fails = 0; else attempt.fails = (attempt.fails || 0) + 1;
        ai.advanceAfterStep(attempt);
        attempt.unlocked = ai.computeUnlocked(attempt);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'step', level, text: input.slice(0, 200), meta: { diagnosis, node: attempt.node, guard: guardOut.rules } });
        store.persist();
        return json(res, 200, { ai: aiOut, diagnosis, state: stateOf(attempt, problem), draft: attempt.draft, guard: guardOut, source });
      }
      if (sub === 'hint' && method === 'POST') {
        const body = await readBody(req);
        const level = String(body.level || '').toUpperCase();
        if (!['L0', 'L1', 'L2', 'L3', 'L4'].includes(level)) return fail(res, 400, 'BAD_REQUEST', '提示等级只能是 L0–L4');
        attempt.unlocked = ai.computeUnlocked(attempt);
        if (level !== 'L0' && !attempt.unlocked.includes(level)) {
          return fail(res, 409, 'HINT_LOCKED', '这一级提示还没解锁，先提交一次尝试或先用上一级', { level, unlocked: attempt.unlocked, reason: 'NEED_PREV_LEVEL' });
        }
        const usedNow = attempt.used[level] || 0;
        if (usedNow >= attempt.budgets[level]) {
          const options = softLandingOptions();
          return json(res, 429, {
            error: { code: 'BUDGET_EXHAUSTED', message: '本题提示预算用完了，换一种方式继续', detail: { level, softLanding: { options } } },
            softLanding: { options },
          });
        }
        let hint = ai.hintText(problem, level);
        let g = check(hint, { level, keySteps: problem.keySteps, referenceProof: problem.referenceProof, history: attempt.hintLog.slice(-3) });
        recordGuard(g);
        let guardOut = { ok: true, blocked: false, rules: [] };
        if (g.blocked) {
          hint = SAFE_TEXT;
          guardOut = { ok: false, blocked: true, rules: g.rules };
          logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'leak_blocked', level, text: hint, meta: { rules: g.rules } });
        }
        const tag = ai.HINT_TAGS[level];
        attempt.used[level] = usedNow + 1;
        attempt.hintLog.push(hint);
        attempt.chat.push({ role: 'ai', content: { judge: tag, hint, ask: level === 'L4' ? '补完后用一句话复述这一步的理由，再继续。' : '先按提示写一步，再提交给我看。' }, tag, ts: nowIso() });
        if (attempt.node === 5) ai.advanceAfterHint(attempt);
        attempt.unlocked = ai.computeUnlocked(attempt);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'hint', level, text: hint.slice(0, 200), meta: { guard: guardOut.rules } });
        store.persist();
        return json(res, 200, { level, text: hint, tag, state: stateOf(attempt, problem), guard: guardOut });
      }
      if (sub === 'answer-request' && method === 'POST') {
        await readBody(req);
        attempt.used.refusals = (attempt.used.refusals || 0) + 1;
        const r = ai.refusal(attempt);
        const refusalText = [r.receive, r.rule, ...r.alternatives.map((x) => x.label)].join('\n');
        const g = check(refusalText, { level: 'refusal', maxLen: LIMITS.refusal, keySteps: problem.keySteps, referenceProof: problem.referenceProof, history: attempt.hintLog.slice(-3) });
        recordGuard(g);
        const alternatives = r.alternatives.map((x) => x.label);
        attempt.hintLog.push(refusalText);
        attempt.chat.push({ role: 'ai', content: { judge: r.receive, hint: r.rule, ask: '你选一个现在能做的替代动作？' }, tag: '拒绝模板 · 三段式', ts: nowIso() });
        if (attempt.node === 7) ai.advanceAfterRefusal(attempt);
        attempt.unlocked = ai.computeUnlocked(attempt);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'answer_request', meta: { refusals: attempt.used.refusals } });
        store.persist();
        return json(res, 200, {
          refusal: { receive: r.receive, rule: r.rule, alternatives, alternativeDetails: r.alternatives },
          state: stateOf(attempt, problem),
          guard: g.blocked ? { ok: false, blocked: true, rules: g.rules } : { ok: true, blocked: false, rules: [] },
        });
      }
      if (sub === 'xiaobai' && method === 'POST') {
        const body = await readBody(req);
        if ((attempt.used.xiaobai || 0) >= attempt.budgets.xiaobai) {
          return fail(res, 429, 'XIAOBAI_LIMIT', '本题白话解释次数已用完', { used: attempt.used.xiaobai, limit: attempt.budgets.xiaobai });
        }
        const card = ai.xiaobaiCard(body.concept || problem.kp[1] || '条件收敛');
        attempt.used.xiaobai = (attempt.used.xiaobai || 0) + 1;
        attempt.chat.push({ role: 'ai', content: { judge: '看不懂很正常，先只解释这个概念。', hint: card.analogy, ask: card.ask }, tag: '小白解释 · 三件套', ts: nowIso() });
        attempt.hintLog.push(card.formal);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'xiaobai', meta: { concept: card.concept, used: attempt.used.xiaobai } });
        store.persist();
        return json(res, 200, { card, state: stateOf(attempt, problem), remaining: attempt.budgets.xiaobai - attempt.used.xiaobai });
      }
      if (sub === 'final' && method === 'POST') {
        const body = await readBody(req);
        const finalText = String(body.text || '').trim();
        if (!finalText) return fail(res, 400, 'BAD_REQUEST', '终稿不能为空');
        if (attempt.node < 8) return fail(res, 409, 'WRONG_PHASE', '还没到交终稿阶段，先把证明写完', { node: attempt.node });
        const coverage = ai.checkCoverage(problem, finalText);
        attempt.coverage = coverage;
        attempt.finalText = finalText;
        attempt.node = 9; attempt.phase = 'P4'; attempt.round = 0;
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'final', meta: { coverage: coverage.percent, passed: coverage.passed } });
        store.persist();
        return json(res, 200, { coverage, state: stateOf(attempt, problem), guard: { ok: true, blocked: false, rules: [] } });
      }
      if (sub === 'review' && method === 'POST') {
        const body = await readBody(req);
        const answers = Array.isArray(body.answers) ? body.answers : [];
        if (answers.length !== 5 || answers.some((x) => !String(x || '').trim())) {
          return fail(res, 400, 'BAD_REQUEST', '复盘需要 5 个非空答案');
        }
        if (!attempt.coverage || !attempt.coverage.passed) return fail(res, 409, 'WRONG_PHASE', '覆盖度不到 80%，先补齐要点再复盘', { coverage: attempt.coverage });
        const { feedback, mastery } = ai.reviewFeedback(answers, attempt, attempt.coverage);
        attempt.review = { answers, feedback, mastery };
        attempt.phase = 'P5'; attempt.node = 9;
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'review', meta: { mastery } });
        store.persist();
        return json(res, 200, { feedback, mastery, state: stateOf(attempt, problem) });
      }
      if (sub === 'variant' && method === 'POST') {
        const body = await readBody(req);
        const answer = String(body.answer || '').trim();
        if (!answer) return fail(res, 400, 'BAD_REQUEST', '变式题答案不能为空');
        if (!attempt.review) return fail(res, 409, 'WRONG_PHASE', '先完成五问复盘，再做变式题', { phase: attempt.phase });
        const result = ai.variantResult(problem, answer);
        attempt.variantResult = result;
        attempt.finishedAt = nowIso();
        attempt.phase = 'P6'; attempt.node = 10;
        attempt.independence = computeIndependence(attempt);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'variant', meta: { correct: result.correct } });
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'finish', meta: { independence: attempt.independence, mastery: attempt.review.mastery } });
        store.persist();
        return json(res, 200, {
          variant: { title: problem.variant.title, stem: problem.variant.stem },
          result, state: stateOf(attempt, problem),
          guard: { ok: true, blocked: false, rules: [] },
        });
      }
      return fail(res, 404, 'NOT_FOUND', '接口不存在');
    }

    // ---------- 教师端（演示版不强制鉴权） ----------
    if (p === '/api/teacher/dashboard' && method === 'GET') {
      return json(res, 200, dashboard(store.db, url.searchParams.get('period') || 'week'));
    }
    const studentMatch = /^\/api\/teacher\/students\/([^/]+)$/.exec(p);
    if (studentMatch && method === 'GET') {
      const detail = studentDetail(store.db, decodeURIComponent(studentMatch[1]));
      if (!detail) return fail(res, 404, 'NOT_FOUND', '学生不存在');
      return json(res, 200, detail);
    }
    if (p === '/api/teacher/export.csv' && method === 'GET') {
      const body = csv(store.db);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mathproof-export.csv"', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (p === '/api/events' && method === 'GET') {
      const attemptId = url.searchParams.get('attemptId');
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
      let items = store.db.events.slice();
      if (attemptId) items = items.filter((e) => e.attemptId === attemptId);
      items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      return json(res, 200, { total: items.length, items: items.slice(0, limit) });
    }

    if (p.startsWith('/api/')) return fail(res, 404, 'NOT_FOUND', '接口不存在');
    return null;
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method Not Allowed');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(PUBLIC_DIR, '.' + rel);
    if (!file.startsWith(PUBLIC_DIR)) return text(res, 403, 'Forbidden');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html')) && !path.extname(rel)) return serveFile(path.join(PUBLIC_DIR, 'index.html'), req, res);
        return text(res, 404, 'Not Found（前端页面尚未构建，或请访问 /api/health）');
      }
      return serveFile(file, req, res);
    });
  }
  function serveFile(file, req, res) {
    const ext = path.extname(file).toLowerCase();
    fs.readFile(file, (err, buf) => {
      if (err) return text(res, 404, 'Not Found');
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
      if (req.method === 'HEAD') return res.end();
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return text(res, 400, 'Bad Request'); }
    try {
      const handled = await handle(req, res, url);
      if (handled === null) serveStatic(req, res, url);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      const code = status === 400 ? 'BAD_REQUEST' : status === 413 ? 'BAD_REQUEST' : 'INTERNAL';
      if (!res.headersSent) fail(res, status, code, status === 500 ? '服务器内部错误' : (e.message || '请求出错'));
      else try { res.end(); } catch {}
    }
  });

  let actualPort = options.port == null ? 8787 : Number(options.port);
  function start() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(actualPort, '127.0.0.1', () => {
        actualPort = server.address().port;
        resolve({ port: actualPort, url: 'http://127.0.0.1:' + actualPort });
      });
    });
  }
  function close() {
    return new Promise((resolve) => {
      try { store.persist(); } catch {}
      server.close(() => resolve());
    });
  }

  return {
    server, store, start, close,
    get port() { return actualPort; },
    get baseUrl() { return 'http://127.0.0.1:' + actualPort; },
    guardStats,
  };
}

/* ---------- 直接运行：node server/server.mjs ---------- */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const dbPath = process.env.DB_PATH || DEFAULT_DB;
  const app = createServer({ port, dbPath });
  app.start().then(({ url }) => {
    console.log('[mathproof-demo] server ready: ' + url);
    console.log('[mathproof-demo] health: ' + url + '/api/health');
    console.log('[mathproof-demo] mode: ' + (process.env.DEEPSEEK_API_KEY ? 'deepseek(可选，失败回退 mock)' : 'mock') + ' | db: ' + path.resolve(dbPath));
  }).catch((e) => { console.error('[mathproof-demo] failed to start:', e); process.exit(1); });
  const shutdown = () => { app.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
