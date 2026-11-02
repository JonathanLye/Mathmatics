/**
 * metrics.mjs —— 教师看板聚合 / CSV 导出 / 事件流 / 学生详情
 * 口径（契约 §2.1，README §4）：
 *  - 完成率 = 本周完成过必做题的学生数 / 36
 *  - 平均提示轮数 = 全部作答的 L1–L4 平均次数（种子固定为 4.8）
 *  - 独立性三档 = 已完成作答的三档分布（19/17/14 = 38%/34%/28%），不合成单一百分比
 *  - 卡点 Top5 = 100 条卡点事件按知识点聚合（32/27/19/13/9）
 *  - 演示学生 s-demo 不计入班级统计（避免演示操作改乱数字）
 */
import { STUCK_CODES, infoHints } from './seed.mjs';

export const ANON = (() => {
  const map = {};
  for (let i = 1; i <= 36; i++) map['s' + String(i).padStart(2, '0')] = '匿名-' + String(i).padStart(2, '0');
  return map;
})();

export function anonId(studentId) { return ANON[studentId] || '匿名-demo'; }

const INDEP_LABEL = { independent: '独立', semi: '半独立', dependent: '依赖' };
const INDEP_LABEL_CSV = { independent: 'independent', semi: 'semi', dependent: 'dependent' };

function roster(db) { return new Set(db.students.map((s) => s.id)); }
function attemptsOfRoster(db) { const ids = roster(db); return db.attempts.filter((a) => ids.has(a.studentId)); }

function highestLevel(used) {
  if ((used.L4 || 0) > 0) return 'L4';
  if ((used.L3 || 0) > 0) return 'L3';
  if ((used.L2 || 0) > 0) return 'L2';
  if ((used.L1 || 0) > 0) return 'L1';
  return '-';
}

export function dashboard(db, period = 'week') {
  const p = period === 'month' ? 'month' : 'week';
  const attempts = attemptsOfRoster(db);
  const requiredIds = new Set(db.problems.filter((x) => x.type === 'required').map((x) => x.id));
  const finishedAttempts = attempts.filter((a) => a.finishedAt);
  const unfinishedAttempts = attempts.filter((a) => !a.finishedAt);

  // 完成率：至少完成 1 道必做题的学生数
  const completedStudents = new Set(
    finishedAttempts.filter((a) => requiredIds.has(a.problemId)).map((a) => a.studentId)
  );
  const total = db.students.length;
  const finished = completedStudents.size;
  const unfinished = total - finished;
  const completionRate = Math.round((finished / total) * 100) / 100;

  // 平均提示轮数：全部作答（种子 288 / 60 = 4.8）
  const totalHints = attempts.reduce((sum, a) => sum + infoHints(a.used || {}), 0);
  const avgHintRounds = attempts.length ? Math.round((totalHints / attempts.length) * 10) / 10 : 0;

  // 独立性三档（已完成作答）
  const indepCounts = { independent: 0, semi: 0, dependent: 0 };
  for (const a of finishedAttempts) if (a.independence && indepCounts[a.independence] != null) indepCounts[a.independence] += 1;
  const indepTotal = finishedAttempts.length || 1;
  const independence = {
    independent: Math.round((indepCounts.independent / indepTotal) * 100) / 100,
    semi: Math.round((indepCounts.semi / indepTotal) * 100) / 100,
    dependent: Math.round((indepCounts.dependent / indepTotal) * 100) / 100,
    counts: { ...indepCounts },
    percent: {
      independent: Math.round((indepCounts.independent / indepTotal) * 100),
      semi: Math.round((indepCounts.semi / indepTotal) * 100),
      dependent: Math.round((indepCounts.dependent / indepTotal) * 100),
    },
  };

  // 卡点 Top5（按卡点事件聚合，同一题同一知识点只计一次——种子中已保证不重复）
  const stuckCount = {};
  for (const a of attempts) for (const code of a.stuckPoints || []) stuckCount[code] = (stuckCount[code] || 0) + 1;
  const stuckTotal = Object.values(stuckCount).reduce((x, y) => x + y, 0) || 1;
  const stuckTop5 = Object.entries(stuckCount)
    .map(([code, count]) => ({ kp: STUCK_CODES[code] || code, count, percent: Math.round((count / stuckTotal) * 100) }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 5);

  // 未完成名单（含 3 名连续 2 周未动）
  const lastAttemptByStudent = {};
  for (const a of attempts) {
    if (!lastAttemptByStudent[a.studentId] || a.startedAt > lastAttemptByStudent[a.studentId].startedAt) lastAttemptByStudent[a.studentId] = a;
  }
  const unfinishedList = db.students
    .filter((s) => !completedStudents.has(s.id))
    .map((s) => {
      const at = lastAttemptByStudent[s.id];
      const inactiveDays = Math.floor((Date.now() - new Date(s.lastActive).getTime()) / 86400000);
      return {
        studentId: s.id, anonId: anonId(s.id), name: s.name, sid: s.sid,
        phase: at ? at.phase : null, lastActive: s.lastActive,
        inactiveDays, inactiveWeeks: Math.floor(inactiveDays / 7),
      };
    })
    .sort((x, y) => (x.lastActive < y.lastActive ? -1 : 1));

  // 学生列表
  const students = db.students.map((s) => {
    const mine = attempts.filter((a) => a.studentId === s.id);
    const done = mine.filter((a) => a.finishedAt).length;
    const hints = mine.reduce((sum, a) => sum + infoHints(a.used || {}), 0);
    const latestFinished = mine.filter((a) => a.finishedAt).sort((x, y) => (x.finishedAt > y.finishedAt ? -1 : 1))[0] || null;
    const inactiveDays = Math.floor((Date.now() - new Date(s.lastActive).getTime()) / 86400000);
    const firstStuck = mine.flatMap((a) => a.stuckPoints || [])[0] || null;
    return {
      studentId: s.id, anonId: anonId(s.id), name: s.name, sid: s.sid,
      finished: done, hints,
      independence: latestFinished ? latestFinished.independence : null,
      independenceLabel: latestFinished && latestFinished.independence ? INDEP_LABEL[latestFinished.independence] : '未完成',
      lastActive: s.lastActive, inactiveDays,
      stuckPoint: firstStuck ? STUCK_CODES[firstStuck] || null : null,
    };
  });

  const reviewQueue = db.problems
    .filter((x) => x.status === 'review')
    .map((x) => ({ problemId: x.id, title: x.title, chapter: x.chapter, status: 'pending', submittedBy: '教研组' }));

  return {
    period: p,
    class: db.meta.classInfo,
    kpis: {
      completionRate,
      completionRatePercent: Math.round(completionRate * 100),
      finished,
      total,
      unfinished,
      avgHintRounds,
      avgHintRoundsBasis: '同题口径：全部作答的 L1–L4 平均次数',
      independence,
    },
    stuckTop5,
    unfinishedList,
    students,
    reviewQueue,
    exportUrl: '/api/teacher/export.csv',
    generatedAt: new Date().toISOString(),
  };
}

export function studentDetail(db, studentId) {
  const student = db.students.find((s) => s.id === studentId || s.sid === studentId);
  if (!student) return null;
  const attempts = db.attempts.filter((a) => a.studentId === student.id);
  const finished = attempts.filter((a) => a.finishedAt);
  const totalHints = attempts.reduce((sum, a) => sum + infoHints(a.used || {}), 0);
  const latest = finished.sort((x, y) => (x.finishedAt > y.finishedAt ? -1 : 1))[0] || null;
  return {
    student: { studentId: student.id, anonId: anonId(student.id), name: student.name, sid: student.sid, className: student.className, group: student.group },
    summary: {
      finished: finished.length,
      avgHintRounds: attempts.length ? Math.round((totalHints / attempts.length) * 10) / 10 : 0,
      independence: latest ? latest.independence : null,
      timeOnTaskMin: attempts.reduce((sum, a) => sum + (a.timeMin || 0), 0),
    },
    attempts: attempts.map((a) => ({
      attemptId: a.id, problemId: a.problemId, phase: a.phase, node: a.node,
      coverage: a.coverage ? a.coverage.percent : 0,
      independence: a.independence, finished: !!a.finishedAt,
      hints: infoHints(a.used || {}), timeMin: a.timeMin || 0,
    })),
    events: db.events.filter((e) => e.studentId === student.id).slice(-50).reverse(),
  };
}

export function csv(db) {
  const attempts = attemptsOfRoster(db)
    .slice()
    .sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1));
  const header = ['匿名ID', '班级', '题号', '知识点', '开始时间', '用时分钟', '提示次数', '最高提示级别', '独立性', '完成', '覆盖度'];
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = attempts.map((a) => {
    const problem = db.problems.find((p) => p.id === a.problemId) || {};
    return [
      anonId(a.studentId),
      (db.students.find((s) => s.id === a.studentId) || {}).className || '',
      a.problemId,
      (problem.kp || []).join(';'),
      a.startedAt,
      Math.max(1, Math.round(a.timeMin || 1)),
      infoHints(a.used || {}),
      highestLevel(a.used || {}),
      a.independence ? INDEP_LABEL_CSV[a.independence] : '',
      a.finishedAt ? '1' : '0',
      (a.coverage ? a.coverage.percent : 0) + '%',
    ].map(esc).join(',');
  });
  return '\uFEFF' + header.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
}
