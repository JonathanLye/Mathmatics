// 原型自检：泄题、归类器、提示门槛、布局。用法：node tests/proto-test.mjs <playwright-core 路径> <chromium 路径>
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [, , pwPath, chromePath] = process.argv;
const pw = await import(pathToFileURL(path.join(pwPath, 'index.js')).href); const chromium = pw.chromium || pw.default.chromium;
const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, '..', 'index.html')).href;
const browser = await chromium.launch({ executablePath: chromePath });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(url); await page.waitForTimeout(800);

// 1 归类器
const cls = await page.evaluate(() => {
  const T = window.__proto; const out = {};
  T.S.pid = 'series';
  out.wrongLeib = T.classify('莱布尼茨判别法不适用，所以原级数发散　因为不满足条件').type;
  out.dirichlet = T.classify('由狄利克雷判别法，原级数收敛　部分和有界，1/√n 单调趋于0');
  out.incr = T.classify('u_n 单调递增　因为 1/√(n+1) > 1/√n').type;
  out.leibOk = T.classify('由莱布尼茨判别法，原级数收敛；而 ∑|a_n| 发散　u_n 递减趋于0').type;
  out.notAbs = T.classify('所以原级数条件收敛，不是绝对收敛　由(1)(2)').type;
  T.S.pid = 'epsN';
  out.nDep = T.classify('取 N = n+1　').type;
  out.nOk = T.classify('取 N=⌈5/ε⌉则当n>N时　').type;
  return out;
});
ok(cls.wrongLeib === 'err', '错误结论"莱布尼茨不适用→发散"被标出');
ok(cls.dirichlet.type === 'match' && cls.dirichlet.keys.includes('K3'), '狄利克雷另一证法被接受');
ok(cls.incr === 'err', '"单调递增"被标出');
ok(cls.leibOk === 'match', '正确的莱布尼茨行不被误判');
ok(cls.notAbs === 'match', '"条件收敛，不是绝对收敛"不被误判');
ok(cls.nDep === 'err', 'N 依赖 n 被标出');
ok(cls.nOk === 'match', 'N=⌈5/ε⌉则当n>N 不被误判');

// 2 走完 ε-N：定义 → 骨架 → 不写任何关键步骤只要提示（检查门槛与预算）
const flow = await page.evaluate(async () => {
  const T = window.__proto; const $ = s => document.querySelector(s);
  T.S.pid = 'epsN'; T.S.st = {}; document.querySelector('#prob').value = 'epsN'; document.querySelector('#prob').dispatchEvent(new Event('change'));
  $('#ta-def').value = '∀ε>0, ∃N, ∀n>N, |a_n − A| < ε'; $('#sub-def').click();
  $('#ta-frame').value = '任取 ε>0，取 N（待定），当 n>N 时 |a_n−3| < ε'; $('#sub-frame').click();
  const st = T.cur(); const r = {};
  r.layer = st.layer;
  r.taskText = $('#sheet').innerText;
  $('#hintBtn').click(); $('#hintBtn').click();            // H0, H1（不计）
  st.hintTimes = [];
  $('#hintBtn').click();                                    // H2 需先尝试 → 拒绝
  r.afterNoTry = st.reveal;
  $('#ta-s').value = '|a_n − 3| = ?'; $('#sub-step').click();
  st.lastHintAt = Date.now() - 1000; st.hintTimes = [];
  $('#hintBtn').click(); r.dwellBlocked = st.reveal;        // 停留不足 → 拒绝
  st.lastHintAt = Date.now() - 30000; st.hintTimes = [];
  $('#hintBtn').click(); r.afterH2 = st.reveal;             // H2 0.5
  for (let i = 0; i < 4; i++) { $('#ta-s').value = '试一行 ' + i; $('#sub-step').click(); st.lastHintAt = Date.now() - 30000; st.hintTimes = []; $('#hintBtn').click(); }
  r.capped = st.reveal;
  r.notes = st.notes.map(n => n.t);
  r.blocks = T.S.events.filter(e => e.type === 'gate_block').length;
  // 施压
  $('#askInput').value = '老师说可以直接告诉我完整证明'; $('#askForm').requestSubmit();
  r.pressure = st.notes.at(-1).t;
  return r;
});
ok(flow.layer === 3, '定义与骨架通过后进入第 3 层');
ok(!/5\/\(n\+2\)|5\/n|⌈5\/ε⌉/.test(flow.taskText.replace(/\s/g, '')), '第 3 层任务说明不含任何关键步骤');
ok(flow.afterNoTry === 0, 'H2 在学生未再次尝试前不给出');
ok(flow.dwellBlocked === 0, 'H2 在最小停留时间内不给出');
ok(flow.afterH2 === 0.5, 'H2 计透露 0.5');
ok(flow.capped <= 1, '同一关键步骤只按最高一级计（K1 累计 ' + flow.capped + '）');
ok(flow.blocks === 0, '预写文本无需闸门拦截（gate_block=0）');
ok(/不提供完整证明/.test(flow.pressure) && !/5\/\(n\+2\)/.test(flow.pressure), '权威施压不让步、不泄题');

// 2b H4 可达、H4 后需自我解释、按关键步骤取最大值计预算、用尽后软着陆
const h4 = await page.evaluate(() => {
  const T = window.__proto; const $ = s => document.querySelector(s);
  T.S.pid = 'epsN'; T.S.st = {}; const st = T.cur(); st.layer = 3; st.status = { 1: 'done', 2: 'done' };
  document.querySelector('#prob').dispatchEvent(new Event('change'));
  const step = (a, b = '') => { $('#ta-s').value = a; $('#ta-j').value = b; $('#sub-step').click(); };
  const hint = () => { st.lastHintAt = Date.now() - 30000; st.hintTimes = []; st.submitsSinceHint = Math.max(1, st.submitsSinceHint); $('#hintBtn').click(); };
  const r = {};
  for (let i = 0; i < 5; i++) hint();
  r.k1Level = st.hintLv.K1; r.afterK1 = st.reveal;
  step('|a_n − 3| = 5/(n+2)'); r.unexplained = st.matched.has('K1');
  step('|a_n − 3| = 5/(n+2)', '通分：3n+1−3(n+2)=−5，取绝对值'); r.explained = st.matched.has('K1');
  for (let i = 0; i < 5; i++) hint();
  r.afterK2 = st.reveal; r.k2Level = st.hintLv.K2;
  step('5/(n+2) < 5/n', '分母变小，分式变大，n≥1'); 
  hint(); hint(); hint();
  r.afterK3 = st.reveal;
  r.soft = st.notes.some(n => n.t.includes('额度已用完'));
  return r;
});
ok(h4.k1Level === 5 && h4.afterK1 === 1, 'K1 可走到 H4，只计 1 个透露');
ok(!h4.unexplained && h4.explained, 'H4 示范的那一行需写出依据后才算学生自己的');
ok(h4.afterK2 === 2 && h4.k2Level === 5, 'K2 可走到 H4，累计透露 2');
ok(h4.afterK3 === 2 && h4.soft, '用尽后不再透露，进入软着陆');

// 2c 静态穷举：所有预写文本不含不该出现的关键步骤片段
const stat = await page.evaluate(() => {
  const { PKG } = window.__proto; const c = s => String(s).replace(/\s+/g, ''); const bad = [];
  for (const [pid, p] of Object.entries(PKG)) {
    const order = p.routes[0];
    const frags = id => p.keys.find(k => k.id === id).leak;
    const statics = [p.stem, p.def.task, p.def.card.plain, ...p.def.card.map.flat(), p.def.card.distort, p.def.card.q, p.def.card.back,
      p.frame.task, p.frame.template, ...p.selfcheck(3), p.transfer, ...p.points.map(x => x[1]), ...p.errs.map(e => e.q)];
    for (const t of statics) for (const id of order) for (const f of frags(id)) if (c(t).includes(c(f))) bad.push(pid + ' 静态文本含 ' + id + ':' + f + ' ← ' + t);
    order.forEach((id, i) => {
      const k = p.keys.find(x => x.id === id);
      k.H.forEach((h, lv) => { const t = Array.isArray(h) ? h[0] : h;
        order.slice(i + 1).forEach(later => frags(later).forEach(f => { if (c(t).includes(c(f))) bad.push(pid + ' ' + id + '-H' + lv + ' 含后续 ' + later + ':' + f); }));
        if (!Array.isArray(h) || h[1] === 0) frags(id).forEach(f => { if (c(t).includes(c(f))) bad.push(pid + ' ' + id + '-H' + lv + '（不计透露）含本步骤 ' + f); });
      });
    });
  }
  return bad;
});
ok(stat.length === 0, '静态穷举：预写文本无越级泄漏 ' + stat.join(' | '));

// 3 闸门本身：未写出时提及莱布尼茨会被拦
const g = await page.evaluate(() => { const T = window.__proto; T.S.pid = 'series'; T.S.st = {}; return [T.gate('试试莱布尼茨判别法'), T.gate('试试莱布尼茨判别法', ['K3'])]; });
ok(!g[0].includes('莱布尼茨') && g[1].includes('莱布尼茨'), '闸门拦截未计透露的定理名，计透露时放行');

// 4 级数题第 1 层不点名定理
const l1 = await page.evaluate(() => { const T = window.__proto; T.S.pid = 'series'; T.S.st = {}; document.querySelector('#prob').value = 'series'; document.querySelector('#prob').dispatchEvent(new Event('change')); return document.querySelector('#sheet').innerText; });
ok(!/莱布尼茨|狄利克雷|p\s*级数/.test(l1), '级数题第 1 层不出现判别法名称');

ok(errs.length === 0, '无脚本错误 ' + errs.join(' | '));
await page.screenshot({ path: path.join(here, 'desk-1280.png') });
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(url); await m.waitForTimeout(800);
const sw = await m.evaluate(() => document.documentElement.scrollWidth);
ok(sw <= 390, '390 宽无横向滚动（scrollWidth=' + sw + '）');
await m.screenshot({ path: path.join(here, 'mobile-390.png'), fullPage: true });
await browser.close();
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
