/**
 * server.mjs v2 —— 六层引导工作台后端（零依赖 Node）
 * 六层：1 前置知识点 / 2 题目解析 / 3 详细步骤 / 4 完整讲解 / 5 同类题 / 6 总结
 * 运行：node server/server.mjs（默认 8787，PORT / DB_PATH 可覆盖）
 * 测试：const { createServer } = await import('./server.mjs'); const app = createServer({port:0, dbPath:tmp}); await app.start(); ... await app.close();
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from './store.mjs';
import * as ai from './ai.mjs';
import { check, LIMITS, SAFE_TEXT } from './guard.mjs';
import { dashboard, studentDetail, csv } from './metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const DEFAULT_DB = path.join(__dirname, 'data', 'db.json');

const BUDGETS = ai.BUDGETS;
const LAYERS = ai.LAYERS;

const ROUTES = [
  { method: 'GET', path: '/api/health', desc: '健康检查（ok/mode/version/uptime/db）' },
  { method: 'GET', path: '/api/meta', desc: '演示元信息（邀请码/六层/预算/端点清单）' },
  { method: 'POST', path: '/api/login', desc: '邀请码 + 学号登录' },
  { method: 'GET', path: '/api/home', desc: '学生首页（本周进度/继续上次/复测）' },
  { method: 'GET', path: '/api/problems', desc: '题库列表（筛选）' },
  { method: 'GET', path: '/api/problems/:id', desc: '题目详情（白名单，不含答案）' },
  { method: 'GET', path: '/api/problems/:id/knowledge', desc: '第 1 层：知识点卡（专业/高中，不含解法）' },
  { method: 'POST', path: '/api/attempts', desc: '开始/继续六层作答（state.layer=1）' },
  { method: 'GET', path: '/api/attempts/:id', desc: '恢复完整六层 state' },
  { method: 'POST', path: '/api/attempts/:id/knowledge', desc: '第 1 层：提交复述 / 调取知识点卡' },
  { method: 'POST', path: '/api/attempts/:id/parse', desc: '第 2 层：提交四栏解析，AI 逐项查漏' },
  { method: 'POST', path: '/api/attempts/:id/step', desc: '第 3 层：提交一步（结论+依据），返回三段式与 proactive' },
  { method: 'POST', path: '/api/attempts/:id/hint', desc: '第 3 层：L0–L4 提示（附 plain 小白版）' },
  { method: 'POST', path: '/api/attempts/:id/answer-request', desc: '第 3 层：要答案 → 三段式拒绝' },
  { method: 'POST', path: '/api/attempts/:id/xiaobai', desc: '小白解释三件套（≤2 次）' },
  { method: 'POST', path: '/api/attempts/:id/final', desc: '第 3 层收口：交终稿 → 覆盖表 → 第 4 层' },
  { method: 'POST', path: '/api/attempts/:id/explain', desc: '第 4 层：学生讲，AI 五项核对 → 第 5 层' },
  { method: 'GET', path: '/api/attempts/:id/variant', desc: '第 5 层：取同类题题面' },
  { method: 'POST', path: '/api/attempts/:id/variant', desc: '第 5 层：提交变式题 → 第 6 层' },
  { method: 'POST', path: '/api/attempts/:id/summary', desc: '第 6 层：三栏总结 → 总结卡 + 掌握度 + 完成' },
  { method: 'GET', path: '/api/teacher/dashboard', desc: '教师看板聚合' },
  { method: 'GET', path: '/api/teacher/students/:studentId', desc: '学生详情' },
  { method: 'GET', path: '/api/teacher/export.csv', desc: '导出匿名 CSV' },
  { method: 'GET', path: '/api/events', desc: '事件流（?attemptId=&limit=50）' },
  { method: 'GET', path: '/api/admin/routes', desc: '端点清单' },
  { method: 'GET', path: '/api/admin/stats', desc: '运维统计（mode/db/guard/最近事件）' },
  { method: 'POST', path: '/api/admin/reset', desc: '重置种子数据' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 8); }
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
    available: p.status === 'published',
  };
}
function softLandingOptions() {
  return [
    { id: 'l0', label: '只做 L0 追问', desc: '不再给新信息，只问依据' },
    { id: 'definition', label: '看定义卡', desc: '只给定义/定理原文' },
    { id: 'easier', label: '换同知识点更简单题', desc: '换一道更小的问题继续' },
    { id: 'teacher', label: '转教师', desc: '保存草稿，生成教师工单' },
  ];
}
function emptyLayerStatus() {
  return { '1': 'active', '2': 'locked', '3': 'locked', '4': 'locked', '5': 'locked', '6': 'locked' };
}
function initAttemptFields(attempt, problem) {
  if (!attempt.layer) {
    attempt.layer = 1;
    attempt.layerStatus = emptyLayerStatus();
    attempt.knowledge = {
      requested: false, question: '', professional: '', plain: '', checkQuestion: '',
      answer: '', passed: false, feedback: '', attempts: 0, weakPoint: false,
    };
    attempt.parse = { goal: '', parts: '', keywords: '', tools: '', plainRestatement: '', feedback: [], passed: false };
    attempt.steps = [];
    attempt.stepIndex = 1;
    attempt.failedAttempts = 0;
    attempt.explanation = { text: '', feedback: [], passed: false };
    attempt.summary = { knowledge: '', difficulty: '', steps: '', feedback: [], passed: false, card: null };
    attempt.mastery = null;
  }
  attempt.layerLabel = ai.LAYER_LABELS[attempt.layer] || '前置知识点';
  attempt.guidance = ai.buildGuidance(attempt, problem);
  if (!attempt.unlocked) attempt.unlocked = ai.computeUnlocked(attempt);
  if (!attempt.coverage) attempt.coverage = { items: [], covered: 0, total: ((problem && problem.keySteps) || []).length, percent: 0, passed: false };
  if (!attempt.variant) {
    const v = ai.variantOf(problem);
    attempt.variant = { title: v.title, stem: v.stem, answer: '', result: null };
  }
  if (!attempt.budgets) attempt.budgets = { ...BUDGETS };
  if (!attempt.used) attempt.used = { L1: 0, L2: 0, L3: 0, L4: 0, L0: 0, xiaobai: 0, refusals: 0 };
  if (!Array.isArray(attempt.hintLog)) attempt.hintLog = [];
  if (!Array.isArray(attempt.chat)) attempt.chat = [];
  if (typeof attempt.pasteFlags !== 'number') attempt.pasteFlags = 0;
}
function passLayer(attempt, n, problem) {
  attempt.layerStatus[String(n)] = 'done';
  if (n < 6) {
    attempt.layerStatus[String(n + 1)] = 'active';
    attempt.layer = n + 1;
  } else {
    attempt.layer = 6;
  }
  attempt.phase = 'P' + Math.min(6, attempt.layer);
  attempt.node = attempt.layer;
  attempt.layerLabel = ai.LAYER_LABELS[attempt.layer];
  attempt.guidance = ai.buildGuidance(attempt, problem);
}
function stateOf(attempt, problem) {
  return {
    attemptId: attempt.id, problemId: attempt.problemId,
    layer: attempt.layer, layerLabel: attempt.layerLabel || ai.LAYER_LABELS[attempt.layer] || '前置知识点',
    layerStatus: attempt.layerStatus, guidance: attempt.guidance || ai.buildGuidance(attempt, problem),
    knowledge: attempt.knowledge, parse: attempt.parse, steps: attempt.steps, stepIndex: attempt.stepIndex,
    failedAttempts: attempt.failedAttempts || 0,
    budgets: attempt.budgets, used: attempt.used, unlocked: attempt.unlocked,
    coverage: attempt.coverage, explanation: attempt.explanation, variant: attempt.variant, summary: attempt.summary,
    independence: attempt.independence, mastery: attempt.mastery,
    proactive: ai.buildProactive(attempt),
    finishedAt: attempt.finishedAt, startedAt: attempt.startedAt,
  };
}
function layerGuard(attempt, expected) {
  if ((attempt.layer || 1) !== expected) {
    return { ok: false, layer: attempt.layer, expected };
  }
  return { ok: true };
}
function requireLayer(attempt, expected, res, useHint) {
  const g = layerGuard(attempt, expected);
  if (!g.ok) {
    fail(res, 409, 'WRONG_PHASE', '当前在第 ' + g.layer + ' 层，这一步属于第 ' + expected + ' 层' + (useHint ? '（' + useHint + '）' : ''), { layer: g.layer, expected });
    return false;
  }
  return true;
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
      id: newId('e'), ts: nowIso(), studentId: evt.studentId || null, attemptId: evt.attemptId || null,
      type: evt.type, level: evt.level || null, text: evt.text || '', meta: evt.meta || {}, durationMs: evt.durationMs == null ? null : evt.durationMs,
    });
  }
  function studentById(sid) {
    const roster = store.db.students.find((s) => s.id === sid || s.sid === sid);
    if (roster) return roster;
    const demo = store.db.meta.demoStudent;
    if (demo && sid === demo.id) return demo;
    return null;
  }
  function publicStudent(s) { return { id: s.id, sid: s.sid, name: s.name, className: s.className }; }
  function auth(req) {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return null;
    const sid = tokens.get(m[1]);
    if (!sid) return null;
    return { studentId: sid, student: studentById(sid), token: m[1] };
  }
  function getAttempt(aid) { return store.db.attempts.find((a) => a.id === aid) || null; }
  function problemsOf(problemId) { return store.db.problems.find((p) => p.id === problemId) || null; }
  function touchTime(attempt) {
    if (!attempt.finishedAt) attempt.timeMin = Math.max(1, Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 60000));
  }
  function guardAi(aiOut, attempt, problem, opts = {}) {
    const level = (/^L([0-4])/.exec(String(aiOut.tag || '')) || [null, '0'])[1];
    const lv = 'L' + level;
    const maxLen = lv === 'L4' ? 200 : 130;
    const combined = [aiOut.judge, aiOut.hint, aiOut.ask].join('\n');
    const g = check(combined, { level: lv, maxLen, keySteps: problem.keySteps, referenceProof: problem.referenceProof, history: attempt.hintLog.slice(-3) });
    recordGuard(g);
    if (g.blocked) {
      logEvent({ studentId: attempt.studentId, attemptId: attempt.id, type: 'leak_blocked', level: lv, text: SAFE_TEXT, meta: { rules: g.rules, source: opts.source || 'mock' } });
      return { ai: ai.safeAi(), guard: { ok: false, blocked: true, rules: g.rules } };
    }
    return { ai: aiOut, guard: { ok: true, blocked: false, rules: [] } };
  }
  function guardTexts(items, attempt, problem, maxLen = 120) {
    const out = [];
    for (const item of items) {
      const msg = String(item.message || item.text || '');
      const g = check(msg, { level: 'L1', maxLen, keySteps: problem.keySteps, referenceProof: problem.referenceProof, history: attempt.hintLog.slice(-3) });
      recordGuard(g);
      let message = msg;
      if (g.blocked) {
        message = SAFE_TEXT;
        logEvent({ studentId: attempt.studentId, attemptId: attempt.id, type: 'leak_blocked', level: 'L1', text: SAFE_TEXT, meta: { rules: g.rules, kind: 'feedback' } });
      }
      out.push({ ...item, message });
    }
    return out;
  }
  function guardFeedbackArray(feedback, attempt, problem) {
    return guardTexts(feedback.map((f) => ({ ...f, message: f.message || '' })), attempt, problem);
  }
  function guardedString(str, attempt, problem, maxLen = 120) {
    const g = check(String(str), { level: 'L1', maxLen, keySteps: problem.keySteps, referenceProof: problem.referenceProof });
    recordGuard(g);
    if (g.blocked) {
      logEvent({ studentId: attempt.studentId, attemptId: attempt.id, type: 'leak_blocked', level: 'L1', text: SAFE_TEXT, meta: { rules: g.rules, kind: 'string' } });
      return SAFE_TEXT;
    }
    return String(str);
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    const method = req.method;

    if (p === '/api/health' && method === 'GET') {
      return json(res, 200, {
        ok: true, mode: mode(), version: store.db.meta.version, v2: true,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        db: store.counts(),
      });
    }
    if (p === '/api/meta' && method === 'GET') {
      return json(res, 200, {
        v2: true, version: store.db.meta.version,
        inviteCodes: [store.db.meta.inviteCode], demoStudentId: 'demo',
        demoStudent: publicStudent(store.db.meta.demoStudent),
        layers: LAYERS, phases: ai.PHASES, budgets: BUDGETS, routes: ROUTES,
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
      const due = new Date(Date.now() + 28 * 86400000);
      return json(res, 200, {
        student: publicStudent(who.student),
        weekly: { required, done, percent: required ? Math.round((done / required) * 100) : 0 },
        continue: cont ? { attemptId: cont.id, problemId: cont.problemId, title: contProblem ? contProblem.title : '', layer: cont.layer, phase: cont.phase } : null,
        retest: { date: due.toISOString().slice(0, 10), days: 28 },
        counts: {
          completed: attempts.filter((a) => a.finishedAt).length,
          inProgress: unfinished.length,
          hintRounds: attempts.reduce((s, a) => s + (a.used.L1 + a.used.L2 + a.used.L3 + a.used.L4), 0),
        },
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
    const knowledgeCardMatch = /^\/api\/problems\/([^/]+)\/knowledge$/.exec(p);
    if (knowledgeCardMatch && method === 'GET') {
      const problem = problemsOf(decodeURIComponent(knowledgeCardMatch[1]));
      if (!problem) return fail(res, 404, 'NOT_FOUND', '题目不存在');
      if (problem.status !== 'published') return fail(res, 409, 'WRONG_PHASE', '该题还在审核中，暂不可做');
      return json(res, 200, ai.knowledgeCard(problem));
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
      if (problem.status !== 'published') return fail(res, 409, 'WRONG_PHASE', '该题还在审核中，暂不可做', { problemId: problem.id });
      let attempt = store.db.attempts.find((a) => a.studentId === who.studentId && a.problemId === problem.id && !a.finishedAt);
      let created = false;
      if (!attempt) {
        attempt = {
          id: newId('a'), studentId: who.studentId, problemId: problem.id,
          startedAt: nowIso(), finishedAt: null, phase: 'P1', node: 1,
          budgets: { ...BUDGETS }, used: { L1: 0, L2: 0, L3: 0, L4: 0, L0: 0, xiaobai: 0, refusals: 0 },
          unlocked: ['L0'], independence: null, pasteFlags: 0,
          chat: [], hintLog: [], stuckPoints: [], timeMin: 0, finalText: '', coverage: { items: [], covered: 0, total: (problem.keySteps || []).length, percent: 0, passed: false },
        };
        store.db.attempts.push(attempt);
        created = true;
      }
      initAttemptFields(attempt, problem);
      if (!attempt.knowledge.question) {
        const card = ai.knowledgeCard(problem);
        attempt.knowledge.question = card.question;
        attempt.knowledge.professional = card.professional;
        attempt.knowledge.plain = card.plain;
        attempt.knowledge.checkQuestion = card.checkQuestion;
      }
      if (!attempt.parse.plainRestatement) attempt.parse.plainRestatement = ai.knowledgeCard(problem).plain ? (problem.knowledge && problem.knowledge.plainRestatement) || '' : '';
      logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'attempt_start', meta: { problemId: problem.id, created, layer: attempt.layer } });
      store.persist();
      return json(res, created ? 201 : 200, { attemptId: attempt.id, problem: whitelistProblem(problem), state: stateOf(attempt, problem) });
    }
    const attemptMatch = /^\/api\/attempts\/([^/]+)(?:\/(knowledge|parse|step|hint|answer-request|xiaobai|final|explain|variant|summary|review|events))?$/.exec(p);
    if (attemptMatch) {
      const attempt = getAttempt(decodeURIComponent(attemptMatch[1]));
      if (!attempt) return fail(res, 404, 'NOT_FOUND', '作答不存在');
      const problem = problemsOf(attempt.problemId);
      if (!problem) return fail(res, 404, 'NOT_FOUND', '题目不存在');
      initAttemptFields(attempt, problem);
      const sub = attemptMatch[2] || null;

      if (!sub && method === 'GET') {
        const st = stateOf(attempt, problem);
        return json(res, 200, {
          attempt: {
            id: attempt.id, attemptId: attempt.id, studentId: attempt.studentId, problemId: attempt.problemId,
            layer: attempt.layer, layerStatus: attempt.layerStatus, phase: attempt.phase,
            startedAt: attempt.startedAt, finishedAt: attempt.finishedAt,
            independence: attempt.independence, mastery: attempt.mastery,
            budgets: attempt.budgets, used: attempt.used, unlocked: attempt.unlocked,
            steps: attempt.steps, coverage: attempt.coverage,
          },
          problem: whitelistProblem(problem),
          state: st,
          messages: attempt.chat,
        });
      }

      // ---------- 第 1 层：前置知识点 ----------
      if (sub === 'knowledge' && method === 'POST') {
        if (!requireLayer(attempt, 1, res, 'POST /knowledge')) return;
        const body = await readBody(req);
        const action = String(body.action || 'answer');
        attempt.knowledge.requested = true;
        if (action === 'request-card') {
          attempt.knowledge.feedback = '知识点卡在左栏（专业 / 高中两 tab）。看完请你用自己的话回答核对问题。';
          const g = guardedString(attempt.knowledge.feedback, attempt, problem);
          attempt.knowledge.feedback = g;
          logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'knowledge_card', meta: {} });
          store.persist();
          return json(res, 200, { passed: false, feedback: attempt.knowledge.feedback, state: stateOf(attempt, problem), requested: true });
        }
        const answer = String(body.answer || '').trim();
        if (!answer) return fail(res, 400, 'BAD_REQUEST', '请先写下你自己的理解');
        const result = ai.gradeKnowledge(attempt, answer, problem);
        attempt.knowledge.attempts = result.attempts;
        attempt.knowledge.answer = answer;
        attempt.knowledge.passed = result.passed;
        attempt.knowledge.weakPoint = !!result.weakPoint;
        attempt.knowledge.feedback = guardedString(result.feedback, attempt, problem);
        if (result.passed) {
          passLayer(attempt, 1, problem);
          attempt.unlocked = ai.computeUnlocked(attempt);
        }
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'knowledge', level: 'L0', meta: { passed: result.passed, weakPoint: result.weakPoint, layer: attempt.layer } });
        store.persist();
        return json(res, 200, { passed: result.passed, feedback: attempt.knowledge.feedback, weakPoint: !!result.weakPoint, state: stateOf(attempt, problem) });
      }

      // ---------- 第 2 层：题目解析 ----------
      if (sub === 'parse' && method === 'POST') {
        if (!requireLayer(attempt, 2, res, 'POST /parse')) return;
        const body = await readBody(req);
        const input = {
          goal: String(body.goal || '').trim(), parts: String(body.parts || '').trim(),
          keywords: String(body.keywords || '').trim(), tools: String(body.tools || '').trim(),
        };
        if (!input.goal && !input.parts && !input.keywords && !input.tools) return fail(res, 400, 'BAD_REQUEST', '四栏至少填一栏');
        const result = ai.gradeParse(input, problem);
        attempt.parse = { ...input, plainRestatement: result.plainRestatement, feedback: guardFeedbackArray(result.feedback, attempt, problem), passed: result.passed };
        if (result.passed) { passLayer(attempt, 2, problem); attempt.unlocked = ai.computeUnlocked(attempt); }
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'parse', meta: { passed: result.passed, layer: attempt.layer } });
        store.persist();
        return json(res, 200, { feedback: attempt.parse.feedback, passed: result.passed, plainRestatement: attempt.parse.plainRestatement, state: stateOf(attempt, problem) });
      }

      // ---------- 第 3 层：详细步骤 ----------
      if (sub === 'step' && method === 'POST') {
        if (!requireLayer(attempt, 3, res, 'POST /step')) return;
        const body = await readBody(req);
        const conclusion = String(body.conclusion != null ? body.conclusion : (body.text || '')).trim();
        const evidence = String(body.evidence || '').trim();
        if (!conclusion && !evidence) return fail(res, 400, 'BAD_REQUEST', '先写这一步的「结论/操作」');
        const graded = ai.gradeStep(attempt, conclusion, evidence, problem);
        attempt.used = attempt.used || {};
        attempt.failedAttempts = attempt.failedAttempts || 0;
        if (graded.passed && !graded.done) {
          const revIdx = attempt.steps.findIndex((x) => x.no === graded.stepNo && x.status !== 'passed');
          if (revIdx >= 0) attempt.steps.splice(revIdx, 1);
          attempt.steps.push({ no: graded.stepNo, conclusion, evidence, status: 'passed', feedback: graded.feedback, ts: nowIso() });
          attempt.stepIndex = graded.stepNo + 1;
          attempt.failedAttempts = 0;
          const passedSteps = attempt.steps.filter((x) => x.status === 'passed').length;
          const total = (problem.keySteps || []).length;
          attempt.coverage = {
            items: (problem.keySteps || []).map((k, i) => ({ id: k.id, question: k.question, covered: i < passedSteps })),
            covered: passedSteps, total, percent: Math.round((passedSteps / (total || 1)) * 100), passed: passedSteps >= Math.ceil(total * 0.8),
          };
        } else if (graded.passed && graded.done) {
          // 已经写完：提示交终稿（不重复加步骤）
        } else {
          attempt.failedAttempts += 1;
          const existing = attempt.steps.find((x) => x.no === graded.stepNo && x.status !== 'passed');
          const rec = { no: graded.stepNo, conclusion, evidence, status: 'revision', feedback: graded.feedback, ts: nowIso() };
          if (existing) Object.assign(existing, rec); else attempt.steps.push(rec);
        }
        const guarded = guardAi(graded.ai, attempt, problem);
        attempt.hintLog.push([guarded.ai.judge, guarded.ai.hint].join(' / '));
        attempt.chat.push({ role: 'student', content: { conclusion, evidence }, ts: nowIso() });
        attempt.chat.push({ role: 'ai', content: { judge: guarded.ai.judge, hint: guarded.ai.hint, ask: guarded.ai.ask }, tag: guarded.ai.tag, ts: nowIso() });
        attempt.layerLabel = ai.LAYER_LABELS[attempt.layer];
        attempt.guidance = ai.buildGuidance(attempt, problem);
        attempt.unlocked = ai.computeUnlocked(attempt);
        touchTime(attempt);
        const proactive = ai.buildProactive(attempt);
        logEvent({
          studentId: who.studentId, attemptId: attempt.id, type: 'step', level: 'L0',
          text: (conclusion || evidence).slice(0, 200),
          meta: { passed: graded.passed, diagnosis: graded.diagnosis, proactive: !!proactive, stepNo: graded.stepNo },
        });
        store.persist();
        return json(res, 200, {
          ai: guarded.ai, diagnosis: graded.diagnosis, step: attempt.steps.find((x) => x.no === graded.stepNo && x.status === 'revision') || { no: graded.stepNo, conclusion, evidence, status: graded.passed ? 'passed' : 'revision' },
          stepPassed: graded.passed, proactive, state: stateOf(attempt, problem), guard: guarded.guard,
        });
      }
      if (sub === 'hint' && method === 'POST') {
        if (!requireLayer(attempt, 3, res, 'POST /hint')) return;
        const body = await readBody(req);
        const level = String(body.level || '').toUpperCase();
        if (!['L0', 'L1', 'L2', 'L3', 'L4'].includes(level)) return fail(res, 400, 'BAD_REQUEST', '提示等级只能是 L0–L4');
        attempt.unlocked = ai.computeUnlocked(attempt);
        if (level !== 'L0' && !attempt.unlocked.includes(level)) {
          return fail(res, 409, 'HINT_LOCKED', '这一级提示还没解锁，先提交一次尝试或先用上一级', { level, unlocked: attempt.unlocked, reason: 'NEED_PREV_LEVEL' });
        }
        if ((attempt.used[level] || 0) >= attempt.budgets[level]) {
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
        const plain = guardedString(ai.plainForHint(attempt, problem), attempt, problem, 160);
        attempt.used[level] = (attempt.used[level] || 0) + 1;
        attempt.hintLog.push(hint);
        attempt.chat.push({ role: 'ai', content: { judge: ai.HINT_TAGS[level], hint, ask: level === 'L4' ? '补完后用一句话复述这一步的理由，再继续。' : '先按提示写一步，再提交给我看。' }, tag: ai.HINT_TAGS[level], ts: nowIso() });
        attempt.unlocked = ai.computeUnlocked(attempt);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'hint', level, text: hint.slice(0, 200), meta: { guard: guardOut.rules } });
        store.persist();
        return json(res, 200, { level, text: hint, tag: ai.HINT_TAGS[level], plain, state: stateOf(attempt, problem), guard: guardOut });
      }
      if (sub === 'answer-request' && method === 'POST') {
        if (!requireLayer(attempt, 3, res, 'POST /answer-request')) return;
        await readBody(req);
        attempt.used.refusals = (attempt.used.refusals || 0) + 1;
        const r = ai.refusal(attempt);
        const refusalText = [r.receive, r.rule, ...r.alternatives.map((x) => x.label)].join('\n');
        const g = check(refusalText, { level: 'refusal', maxLen: LIMITS.refusal, keySteps: problem.keySteps, referenceProof: problem.referenceProof, history: attempt.hintLog.slice(-3) });
        recordGuard(g);
        const alternatives = r.alternatives.map((x) => x.label);
        attempt.hintLog.push(refusalText);
        attempt.chat.push({ role: 'ai', content: { judge: r.receive, hint: r.rule, ask: '你选一个现在能做的替代动作？' }, tag: '拒绝模板 · 三段式', ts: nowIso() });
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
        const card = ai.xiaobaiCard(body.concept || (problem.kp && problem.kp[1]) || '条件收敛');
        attempt.used.xiaobai = (attempt.used.xiaobai || 0) + 1;
        attempt.chat.push({ role: 'ai', content: { judge: '看不懂很正常，先只解释这个概念。', hint: card.analogy, ask: card.ask }, tag: '小白解释 · 三件套', ts: nowIso() });
        attempt.hintLog.push(card.formal);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'xiaobai', meta: { concept: card.concept, used: attempt.used.xiaobai } });
        store.persist();
        return json(res, 200, { card, state: stateOf(attempt, problem), remaining: attempt.budgets.xiaobai - attempt.used.xiaobai });
      }
      if (sub === 'final' && method === 'POST') {
        if (!requireLayer(attempt, 3, res, 'POST /final')) return;
        const body = await readBody(req);
        const finalText = String(body.text || '').trim();
        if (!finalText) return fail(res, 400, 'BAD_REQUEST', '终稿不能为空');
        const coverage = ai.checkCoverage(problem, finalText);
        attempt.coverage = coverage;
        attempt.finalText = finalText;
        if (coverage.passed) passLayer(attempt, 3, problem);
        attempt.unlocked = ai.computeUnlocked(attempt);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'final', meta: { coverage: coverage.percent, passed: coverage.passed, layer: attempt.layer } });
        store.persist();
        return json(res, 200, { coverage, passed: coverage.passed, state: stateOf(attempt, problem), guard: { ok: true, blocked: false, rules: [] } });
      }

      // ---------- 第 4 层：完整讲解 ----------
      if (sub === 'explain' && method === 'POST') {
        if (!requireLayer(attempt, 4, res, 'POST /explain')) return;
        const body = await readBody(req);
        const content = String(body.text || '').trim();
        if (!content) return fail(res, 400, 'BAD_REQUEST', '请先写下你的完整讲解');
        const result = ai.checkExplain(problem, content);
        attempt.explanation = { text: content, feedback: guardFeedbackArray(result.feedback, attempt, problem), passed: result.passed };
        if (result.passed) passLayer(attempt, 4, problem);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'explain', meta: { passed: result.passed, passCount: result.passCount, layer: attempt.layer } });
        store.persist();
        return json(res, 200, { feedback: attempt.explanation.feedback, passed: result.passed, state: stateOf(attempt, problem), guard: { ok: true, blocked: false, rules: [] } });
      }

      // ---------- 第 5 层：同类题 ----------
      if (sub === 'variant' && method === 'GET') {
        if (!requireLayer(attempt, 5, res, 'GET /variant')) return;
        const v = ai.variantOf(problem);
        attempt.variant = { ...attempt.variant, title: v.title, stem: v.stem };
        return json(res, 200, { variant: v, state: stateOf(attempt, problem) });
      }
      if (sub === 'variant' && method === 'POST') {
        if (!requireLayer(attempt, 5, res, 'POST /variant')) return;
        const body = await readBody(req);
        const answer = String(body.answer || '').trim();
        if (!answer) return fail(res, 400, 'BAD_REQUEST', '变式题答案不能为空');
        const result = ai.gradeVariant(problem, answer);
        attempt.variant = { ...attempt.variant, answer, result };
        if (result.correct) passLayer(attempt, 5, problem);
        touchTime(attempt);
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'variant', meta: { correct: result.correct, layer: attempt.layer } });
        store.persist();
        return json(res, 200, { result, variant: ai.variantOf(problem), state: stateOf(attempt, problem) });
      }

      // ---------- 第 6 层：总结 ----------
      if (sub === 'summary' && method === 'POST') {
        if (!requireLayer(attempt, 6, res, 'POST /summary')) return;
        const body = await readBody(req);
        const input = {
          knowledge: String(body.knowledge || '').trim(),
          difficulty: String(body.difficulty || '').trim(),
          steps: String(body.steps || '').trim(),
        };
        if (!input.knowledge && !input.difficulty && !input.steps) return fail(res, 400, 'BAD_REQUEST', '三栏至少写一栏');
        const result = ai.checkSummary(input, problem);
        const guardedFeedback = guardFeedbackArray(result.feedback, attempt, problem);
        const card = { ...result.card, items: (result.card.items || []).map((s) => guardedString(s, attempt, problem, 200)) };
        attempt.summary = { ...input, feedback: guardedFeedback, passed: result.passed, card: result.passed ? card : null };
        let mastery = null;
        let independence = null;
        if (result.passed) {
          attempt.independence = ai.computeIndependence(attempt);
          independence = attempt.independence;
          mastery = ai.masteryFor(attempt, problem);
          attempt.mastery = mastery;
          attempt.finishedAt = nowIso();
          attempt.layerStatus['6'] = 'done';
          touchTime(attempt);
          logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'finish', meta: { mastery, independence } });
        }
        logEvent({ studentId: who.studentId, attemptId: attempt.id, type: 'summary', meta: { passed: result.passed, layer: attempt.layer } });
        store.persist();
        return json(res, 200, {
          feedback: guardedFeedback, passed: result.passed, card: result.passed ? card : null,
          mastery, independence, state: stateOf(attempt, problem), guard: { ok: true, blocked: false, rules: [] },
        });
      }

      // 旧版 /review 已由 /summary 取代
      if (sub === 'review') {
        return fail(res, 409, 'WRONG_PHASE', 'v2 用 /summary 完成总结（旧 /review 已停用）', { use: '/api/attempts/:id/summary' });
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

/* ---------- 直接运行 ---------- */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const dbPath = process.env.DB_PATH || DEFAULT_DB;
  const app = createServer({ port, dbPath });
  app.start().then(({ url }) => {
    console.log('[mathproof-demo v2] server ready: ' + url);
    console.log('[mathproof-demo v2] health: ' + url + '/api/health');
    console.log('[mathproof-demo v2] six layers: knowledge / parse / steps / explain / variant / summary');
    console.log('[mathproof-demo v2] mode: ' + (process.env.DEEPSEEK_API_KEY ? 'deepseek(optional, fallback to mock)' : 'mock'));
  }).catch((e) => { console.error('[mathproof-demo v2] failed to start:', e); process.exit(1); });
  const shutdown = () => { app.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
