/* 证明陪练场 · 全栈 Demo 前端（原生 JS，零依赖）
 * 单一事实源：docs/API_CONTRACT.md；响应结构按 docs/API.md（已与后端校准）。
 * 说明：前端不推算预算/解锁/覆盖，全部使用服务端返回的 state / coverage / guard。
 */
(function(){
'use strict';

/* ================= 小工具 ================= */
function $(sel, root){ return (root || document).querySelector(sel); }
function $$(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function formatMath(raw){
  var out = esc(raw);
  out = out.replace(/∑_\{n=1\}\^\{∞\}/g, '∑<sub>n=1</sub><sup>∞</sup>');
  out = out.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>');
  out = out.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>');
  out = out.replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
  out = out.replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>');
  return out;
}
function fmtTime(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function fmtDate(iso){
  if(!iso) return '—';
  try{
    var d = new Date(iso);
    if(isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('zh-CN', {hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
  }catch(e){ return String(iso); }
}
function toast(msg, type){
  var root = $('#toast-root');
  if(!root) return;
  if(root.children.length > 2) root.removeChild(root.firstChild);
  var el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(function(){
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 220);
  }, 3200);
}
var modalClose = null;
function openModal(html, opts){
  opts = opts || {};
  var root = $('#modal-root');
  root.innerHTML = '<div class="modal-backdrop"><div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
    '<button class="modal-x" data-close aria-label="关闭">×</button>' + html + '</div></div>';
  root.hidden = false;
  var backdrop = root.querySelector('.modal-backdrop');
  var close = function(){ root.hidden = true; root.innerHTML = ''; modalClose = null; };
  modalClose = close;
  backdrop.addEventListener('click', function(e){ if(e.target === backdrop) close(); });
  $$('[data-close]', root).forEach(function(b){ b.addEventListener('click', close); });
  if(opts.onOpen) opts.onOpen(root, close);
  return close;
}
document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && modalClose) modalClose(); });

/* ================= 全局状态 ================= */
var App = {
  tab:'student',
  token:null,
  student:null,
  meta:null,
  health:null,
  online:false,
  booted:false
};
var St = {
  screen:'S0',
  home:null,
  problems:[],
  filterOptions:null,
  filters:{chapter:'', kp:'', difficulty:'', type:''},
  attemptId:null,
  attempt:null,
  problem:null,
  state:null,
  messages:[],
  timerSec:0,
  timerId:null,
  coverage:null,
  review:null,
  mastery:null,
  variant:null,
  finalInput:'',
  source:''
};
var Teacher = { period:'week', data:null, loading:false, processed:{}, detail:null };
var Backend = {
  routes:null, stats:null, events:null, health:null,
  log:[], logSeq:0, pollId:null, onlyErrors:false
};

var LS = {
  token:'proof_demo_token',
  student:'proof_demo_student',
  attempt:'proof_demo_attempt',
  rules:'proof_demo_rules_',
  check:'proof_demo_check_'
};
function saveSession(){
  try{
    if(App.token) localStorage.setItem(LS.token, App.token); else localStorage.removeItem(LS.token);
    if(App.student) localStorage.setItem(LS.student, JSON.stringify(App.student)); else localStorage.removeItem(LS.student);
    if(St.attemptId) localStorage.setItem(LS.attempt, St.attemptId); else localStorage.removeItem(LS.attempt);
  }catch(e){}
}
function loadSession(){
  try{
    App.token = localStorage.getItem(LS.token) || null;
    var s = localStorage.getItem(LS.student);
    App.student = s ? JSON.parse(s) : null;
    St.attemptId = localStorage.getItem(LS.attempt) || null;
  }catch(e){ App.token = null; App.student = null; St.attemptId = null; }
}
function clearSession(){
  App.token = null; App.student = null; St.attemptId = null;
  try{ localStorage.removeItem(LS.token); localStorage.removeItem(LS.student); localStorage.removeItem(LS.attempt); }catch(e){}
}

/* ================= 请求层：所有 fetch 都走这里（后端面板日志） ================= */
function setOnline(on, reason){
  App.online = !!on;
  var pill = $('#backend-pill');
  var text = $('#backend-pill-text');
  if(pill){
    pill.classList.toggle('online', !!on);
    pill.classList.toggle('offline', !on);
  }
  if(text) text.textContent = on ? '后端已连接' : '等待后端启动';
  if(on){
    var b = $('#banner-root');
    if(b && b.getAttribute('data-offline') === '1'){ b.innerHTML = ''; b.removeAttribute('data-offline'); }
  }else if(reason !== 'silent'){
    showOfflineBanner(reason || '无法连接 http://127.0.0.1:8787');
  }
}
function showOfflineBanner(reason){
  var root = $('#banner-root');
  if(!root) return;
  root.setAttribute('data-offline', '1');
  root.innerHTML = '<div class="banner warn"><span><b>等待后端启动。</b>页面已就绪，数据会在后端启动后自动加载。' +
    '<br><span class="small">请运行 <code>start-demo.cmd</code> 或 <code>node server/server.mjs</code> 后点「重试」；' +
    '当前错误：' + esc(reason) + '</span></span>' +
    '<button class="btn btn-amber btn-sm" data-action="retry-boot">重试连接</button></div>';
}
function logRequest(method, path, status, ms, ok, error){
  Backend.log.unshift({id:++Backend.logSeq, ts:new Date(), method:method, path:path, status:status, ms:ms, ok:ok, error:error || ''});
  if(Backend.log.length > 300) Backend.log.length = 300;
  var count = $('#reqlog-count');
  if(count) count.textContent = Backend.log.length + ' 条';
  if(App.tab === 'backend') renderRequestLog();
}
function api(method, path, body, opts){
  opts = opts || {};
  var started = Date.now();
  var headers = {};
  if(App.token && !opts.noAuth) headers.Authorization = 'Bearer ' + App.token;
  var init = {method:method, headers:headers};
  if(body !== undefined){
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetch(path, init).then(function(res){
    var ms = Date.now() - started;
    var ct = res.headers.get('content-type') || '';
    var parse = ct.indexOf('json') >= 0 ? res.json() : res.text();
    return parse.then(function(data){
      logRequest(method, path, res.status, ms, res.ok);
      if(!res.ok){
        var info = (data && data.error) ? data.error : {};
        var err = new Error(info.message || ('请求失败 HTTP ' + res.status));
        err.status = res.status;
        err.code = info.code || ('HTTP_' + res.status);
        err.detail = info.detail || null;
        err.body = data;
        throw err;
      }
      setOnline(true);
      return data;
    });
  }).catch(function(err){
    if(!err.status){
      logRequest(method, path, 'ERR', Date.now() - started, false, err.message);
      setOnline(false, err.message);
      var nerr = new Error('等待后端启动：请先运行 start-demo.cmd / node server/server.mjs');
      nerr.offline = true;
      throw nerr;
    }
    throw err;
  });
}
function showApiError(err, fallback){
  if(err && err.offline){ toast(err.message, 'warn'); return; }
  var msg = (err && err.message) || fallback || '请求失败';
  if(err && err.code) msg = msg + '（' + err.code + '）';
  toast(msg, 'err');
}

/* ================= 顶栏 / 路由 ================= */
var TABS = ['student','teacher','backend','about'];
function parseHash(){
  var h = (location.hash || '').replace(/^#\/?/, '');
  return TABS.indexOf(h) >= 0 ? h : 'student';
}
function setTab(tab, updateHash){
  if(TABS.indexOf(tab) < 0) tab = 'student';
  App.tab = tab;
  $$('.tab-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
  $$('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'tab-' + tab); });
  if(updateHash !== false && location.hash !== '#/' + tab){
    try{ history.replaceState(null, '', '#/' + tab); }catch(e){ location.hash = '#/' + tab; }
  }
  window.scrollTo(0, 0);
  if(tab === 'teacher') loadTeacher(Teacher.period);
  if(tab === 'backend') refreshBackend();
  if(tab === 'student' && App.token && !St.state && !St.home){ loadHomeAndRestore(); }
  if(tab === 'student' && !App.token) renderStudent();
}
window.addEventListener('hashchange', function(){
  var t = parseHash();
  if(t !== App.tab) setTab(t, false);
});
function refreshUserChip(){
  var chip = $('#user-chip');
  var logout = $('#btn-logout');
  if(App.student){
    chip.hidden = false;
    chip.textContent = App.student.name + ' · ' + (App.student.className || '学生');
    logout.hidden = false;
  }else{
    chip.hidden = true;
    logout.hidden = true;
  }
}

/* ================= 元信息 / 健康检查 ================= */
async function refreshMeta(){
  try{
    App.meta = await api('GET', '/api/meta', undefined, {noAuth:true});
    setOnline(true);
  }catch(e){ /* 后端未启动时静默，由 banner 统一提示 */ }
}
async function refreshHealth(silent){
  try{
    var h = await api('GET', '/api/health', undefined, {noAuth:true});
    App.health = h;
    setOnline(true);
    if(App.tab === 'backend') renderHealth();
    return h;
  }catch(e){
    if(!silent) showApiError(e);
    return null;
  }
}

/* ================= 学生端：登录 / 首页 / 选题 ================= */
function renderStudent(){
  var root = $('#student-root');
  if(!root) return;
  stopTimer();
  var screen = St.screen;
  if(!App.token && screen !== 'S0') screen = 'S0';
  if(screen === 'S0') return renderS0(root);
  if(screen === 'S1') return renderS1(root);
  if(screen === 'S2') return renderS2(root);
  if(screen === 'S3') return renderS3(root);
  if(screen === 'S4') return renderS4(root);
  if(screen === 'S5') return renderS5(root);
  return renderS0(root);
}

function renderS0(root){
  var invite = (App.meta && App.meta.inviteCodes && App.meta.inviteCodes[0]) || 'MATH-A-2026';
  root.innerHTML =
    '<div class="login-wrap">' +
      '<div class="card">' +
        '<div class="eyebrow">S0 · 登录入班</div>' +
        '<h2 style="margin:6px 0 8px">用邀请码 + 学号进入班级</h2>' +
        '<p class="small muted">本 Demo 登录会真实调用 POST /api/login，拿到 token 后所有学生端请求带 Bearer token；换设备或刷新后用 GET /api/attempts/:id 恢复。</p>' +
        '<div class="field"><label for="invite-code">邀请码</label><input class="input" id="invite-code" value="' + esc(invite) + '" autocomplete="off"><span class="hint">演示邀请码：' + esc(invite) + '</span></div>' +
        '<div class="field"><label for="student-sid">学号</label><input class="input" id="student-sid" value="2026001" placeholder="任意非空学号；demo 直接进演示学生" autocomplete="off"><span class="hint">学号命中班级名单会用该学生；否则以你填的学号作为演示身份。</span></div>' +
        '<div class="field-error" id="s0-error" style="display:none"></div>' +
        '<div class="row"><button class="btn btn-primary" data-action="login">进入班级</button>' +
        '<button class="btn btn-soft" data-action="demo-login">演示模式：一键进入 →</button></div>' +
        '<p class="privacy">隐私说明：只记录做题过程数据（步骤、提示、时间），教师导出默认匿名；演示学生的作答不计入班级统计。</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="eyebrow">这个 Demo 是真的</div>' +
        '<h3 style="margin:4px 0 10px">AI 不写证明，只让后端判断与给提示</h3>' +
        '<div class="mini-list">' +
          '<div class="mini-item"><span class="mini-num">1</span><div><b>登录：POST /api/login</b><br><span class="muted small">邀请码 + 学号换 token；学生端请求都带 Bearer token。</span></div></div>' +
          '<div class="mini-item"><span class="mini-num">2</span><div><b>作答：POST /api/attempts/:id/step</b><br><span class="muted small">服务端返回三段式 AI、诊断与 state；预算/解锁由后端算。</span></div></div>' +
          '<div class="mini-item"><span class="mini-num">3</span><div><b>红线：server/guard.mjs</b><br><span class="muted small">完整证明、最终答案、可抄推导链都在服务端被闸门拦住。</span></div></div>' +
        '</div>' +
        '<p class="small muted" style="margin-top:14px">提示：打开 <code>?demo=1</code> 会自动登录并进学生端；四个 Tab 用 hash 切换，可直接分享 <code>#/teacher</code>。</p>' +
      '</div>' +
    '</div>';
}

async function doLogin(demo){
  var errEl = $('#s0-error');
  var invite = demo ? ((App.meta && App.meta.inviteCodes && App.meta.inviteCodes[0]) || 'MATH-A-2026') : (($('#invite-code') || {}).value || '').trim();
  var sid = demo ? ((App.meta && App.meta.demoStudentId) || 'demo') : (($('#student-sid') || {}).value || '').trim();
  if(!invite || !sid){
    if(errEl){ errEl.style.display = 'block'; errEl.textContent = '邀请码和学号都要填；演示可点「演示模式」。'; }
    return;
  }
  try{
    var data = await api('POST', '/api/login', {inviteCode:invite, studentId:sid}, {noAuth:true});
    App.token = data.token;
    App.student = data.student;
    St.attemptId = null;
    saveSession();
    refreshUserChip();
    await loadHomeAndRestore(false);
    toast('已登录：' + (data.student && data.student.name ? data.student.name : sid));
  }catch(e){
    if(errEl){
      errEl.style.display = 'block';
      errEl.textContent = e.code === 'INVALID_INVITE' ? '邀请码或学号不对，请找老师确认。' : (e.message || '登录失败');
    }
    showApiError(e);
  }
}
async function logout(){
  clearSession();
  refreshUserChip();
  St.screen = 'S0'; St.home = null; St.state = null; St.attempt = null; St.messages = []; St.screen = 'S0';
  renderStudent();
  toast('已退出登录');
}
async function loadHomeAndRestore(restoreAttempt){
  try{
    var home = await api('GET', '/api/home');
    St.home = home;
    App.student = home.student || App.student;
    saveSession();
    refreshUserChip();
    if(restoreAttempt !== false){
      var aid = St.attemptId || localStorage.getItem(LS.attempt);
      if(aid){
        try{
          var payload = await api('GET', '/api/attempts/' + encodeURIComponent(aid));
          applyAttemptPayload(payload);
          return;
        }catch(e){
          if(e.status === 404 || e.status === 401){ St.attemptId = null; saveSession(); }
          else showApiError(e, '恢复上次作答失败');
        }
      }
    }
    St.screen = 'S1';
    renderStudent();
  }catch(e){
    if(e.status === 401){ await logout(); toast('登录已过期（后端重启会清空 token），请重新登录','warn'); return; }
    showApiError(e, '加载首页失败');
  }
}
function problemTitle(p){ return (p && (p.title || p.problemTitle)) || (p && p.problemId) || '未命名题目'; }

function renderS1(root){
  var h = St.home || {};
  var weekly = h.weekly || {required:3, done:0, percent:0};
  var cont = h.continue;
  var retest = h.retest;
  var student = h.student || App.student || {};
  var title = cont ? (cont.title || cont.problemTitle || '继续上次作答') : '从老师布置的必做题开始';
  root.innerHTML =
    '<div class="page-head"><div><div class="eyebrow">S1 · 今日任务</div>' +
      '<h2>' + esc(student.name || '同学') + '，接着来</h2>' +
      '<p>数据来自 GET /api/home 与 GET /api/problems；所有进度由后端返回。</p></div>' +
      '<div class="row"><button class="btn btn-ghost" data-action="refresh-home">刷新</button>' +
      '<button class="btn btn-primary" data-action="goto-s2">进入选题 →</button></div></div>' +
    '<div class="grid grid-3" style="align-items:stretch">' +
      '<div class="card hi-card"><div class="eyebrow">本周必做</div>' +
        '<div class="mini-kpi" style="margin-top:6px">' + (weekly.done || 0) + ' <small>/ ' + (weekly.required || 3) + ' 题</small></div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + Math.min(100, weekly.percent || 0) + '%"></div></div>' +
        '<p class="small muted">完成度 ' + (weekly.percent || 0) + '% · 继续完成本周任务。</p></div>' +
      '<div class="card"><div class="row-between"><span class="eyebrow">继续上次</span>' +
        (cont ? '<span class="tag tag-amber">进行中</span>' : '<span class="tag">暂无</span>') + '</div>' +
        '<h3 style="margin:6px 0 2px">' + esc(title) + '</h3>' +
        '<p class="small muted">' + (cont ? ('节点 ' + (cont.node || '—') + ' · ' + esc(cont.phase || '')) : '直接从选题开始一道题。') + '</p>' +
        '<div class="row" style="margin-top:10px">' + (cont ? '<button class="btn btn-primary btn-sm" data-action="resume-attempt" data-id="' + esc(cont.attemptId || '') + '">继续作答 →</button>' : '') +
        '<span class="small muted">' + (h.counts ? ('本周已完成 ' + (h.counts.completed || 0) + ' 题 · 进行中 ' + (h.counts.inProgress || 0) + ' 题') : '') + '</span></div></div>' +
      '<div class="card"><div class="row-between"><span class="eyebrow">复测提醒</span><span class="tag tag-blue">' + (retest && retest.days != null ? (retest.days + ' 天后') : '待定') + '</span></div>' +
        '<h3 style="margin:6px 0 2px">' + (retest ? '复测日期 ' + esc(retest.date) : '完成本题后安排') + '</h3>' +
        '<p class="small muted">复测检验方法是否留下；完成度、提示次数、独立性会在教师端汇总。</p>' +
        '<div class="row" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-action="retest-info">看复测说明</button></div></div>' +
    '</div>' +
    '<div class="card" style="margin-top:14px"><div class="row-between"><h3>本周任务</h3><span class="chip">必做 ' + (weekly.required || 3) + ' 题</span></div>' +
      '<div id="s1-task-list" style="margin-top:4px"><div class="loading-card"><span class="spinner"></span>读取题目列表…</div></div></div>' +
    '<p class="small muted" style="margin-top:10px">这一步只读 GET /api/home；点「进入选题」才会拉 GET /api/problems。</p>';
  loadRequiredTasks();
}
async function loadRequiredTasks(){
  var box = $('#s1-task-list');
  if(!box) return;
  try{
    var data = await api('GET', '/api/problems?type=required');
    var items = (data.items || []).slice(0, 6);
    if(!items.length){ box.innerHTML = '<div class="empty-state">暂无必做题。</div>'; return; }
    var cont = St.home && St.home.continue;
    box.innerHTML = items.map(function(p, i){
      var isCont = cont && (cont.problemId === p.id || cont.attemptId === p.id);
      var available = p.available !== false;
      return '<div class="task-line"><span class="task-idx ' + (isCont ? 'now' : '') + '">' + (i + 1) + '</span>' +
        '<div><div class="task-name">' + esc(problemTitle(p)) + '</div><div class="task-meta">' + esc(p.chapter || '') + ' · ' + esc(difficultyLabel(p.difficulty)) + ' · 预计 ' + (p.estimatedMin || '—') + ' 分钟</div></div>' +
        (available ? '<button class="btn btn-soft btn-sm" data-action="start-problem" data-id="' + esc(p.id) + '">' + (isCont ? '继续' : '开始') + '</button>' : '<span class="tag">演示仅完整开放第 1 题</span>') +
        '</div>';
    }).join('');
  }catch(e){
    box.innerHTML = '<div class="empty-state">题目加载失败：' + esc(e.message) + '<br><button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="refresh-home">重试</button></div>';
  }
}

function difficultyLabel(d){
  return {easy:'基础', mid:'进阶', hard:'挑战', basic:'基础'}[d] || d || '—';
}
async function gotoProblems(){
  St.screen = 'S2';
  renderStudent();
  await loadProblems(true);
}
async function loadProblems(first){
  var qs = [];
  var f = St.filters || {};
  ['chapter','kp','difficulty','type'].forEach(function(k){ if(f[k]) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(f[k])); });
  var path = '/api/problems' + (qs.length ? ('?' + qs.join('&')) : '');
  try{
    var data = await api('GET', path);
    St.problems = data.items || [];
    if(first && !St.filterOptions){
      var all = await api('GET', '/api/problems');
      buildFilterOptions(all.items || []);
    }
    if(St.screen === 'S2') renderStudent();
  }catch(e){
    showApiError(e, '加载选题列表失败');
    if(St.screen === 'S2'){
      var box = $('#problem-grid');
      if(box) box.innerHTML = '<div class="card empty-state">加载失败：' + esc(e.message) + '<br><button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="goto-s2">重试</button></div>';
    }
  }
}
function buildFilterOptions(items){
  var opt = {chapter:[], kp:[], difficulty:[], type:[]};
  items.forEach(function(p){
    if(p.chapter && opt.chapter.indexOf(p.chapter) < 0) opt.chapter.push(p.chapter);
    (p.kp || []).forEach(function(k){ if(opt.kp.indexOf(k) < 0) opt.kp.push(k); });
    if(p.difficulty && opt.difficulty.indexOf(p.difficulty) < 0) opt.difficulty.push(p.difficulty);
    if(p.type && opt.type.indexOf(p.type) < 0) opt.type.push(p.type);
  });
  St.filterOptions = opt;
}
function renderS2(root){
  var f = St.filters;
  var opts = St.filterOptions || {chapter:[],kp:[],difficulty:[],type:[]};
  function chips(key, values, labelFn){
    return '<div class="filter-line"><span class="flabel">' + key + '</span>' +
      '<button class="fchip' + (!f[Object.keys(f).filter(function(k){return false;}).length] ? '' : '') + (f[key] === '' ? ' active' : '') + '" data-action="filter" data-key="' + key + '" data-value="">全部</button>' +
      values.map(function(v){
        return '<button class="fchip' + (f[key] === v ? ' active' : '') + '" data-action="filter" data-key="' + key + '" data-value="' + esc(v) + '">' + esc(labelFn ? labelFn(v) : v) + '</button>';
      }).join('') + '</div>';
  }
  var cards = St.problems.map(function(p){
    var available = p.available !== false;
    return '<div class="card problem-card' + (available ? '' : ' dim') + '">' +
      '<div class="p-head"><div class="p-title">' + esc(problemTitle(p)) + '</div><div class="row">' +
        (p.type === 'required' ? '<span class="tag tag-red">必做</span>' : '<span class="tag">选练</span>') +
        '<span class="tag tag-blue">' + esc(difficultyLabel(p.difficulty)) + '</span></div></div>' +
      '<div class="p-stem">' + formatMath(p.stem || '') + '</div>' +
      '<div class="small muted">' + esc(p.chapter || '') + ' · ' + esc((p.kp || []).join(' / ')) + ' · 预计 ' + (p.estimatedMin || '—') + ' 分钟</div>' +
      '<div class="p-foot">' + (available
        ? '<button class="btn btn-primary btn-sm" data-action="start-problem" data-id="' + esc(p.id) + '">开始作答 →</button>'
        : '<button class="btn btn-ghost btn-sm" data-action="preview-problem" data-id="' + esc(p.id) + '">预览题面</button><span class="tag">Demo 只完整开放第 1 题</span>') +
      '</div></div>';
  }).join('');
  root.innerHTML =
    '<div class="page-head"><div><div class="eyebrow">S2 · 选题</div><h2>按章节、知识点、难度挑一道</h2>' +
      '<p>筛选直接请求 GET /api/problems?chapter=&kp=&difficulty=&type=，当前共 ' + (St.problems.length) + ' 题。</p></div>' +
      '<button class="btn btn-ghost" data-action="goto-s1">← 返回今日任务</button></div>' +
    '<div class="card" style="margin-bottom:14px"><div class="filters">' +
      chips('chapter', opts.chapter) + chips('kp', opts.kp) + chips('difficulty', opts.difficulty, difficultyLabel) + chips('type', opts.type, function(v){ return v === 'required' ? '必做' : (v === 'optional' ? '选练' : v); }) +
      '</div><div class="row-between" style="margin-top:10px"><span class="result-count">当前显示 ' + St.problems.length + ' 题</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="reset-filters">清空筛选</button></div></div>' +
    '<div class="grid grid-2" id="problem-grid">' + (cards || '<div class="card empty-state">没有符合条件的题目。</div>') + '</div>';
}

/* ================= 学生端：作答主界面 ================= */
var STEP_META = {
  1:{title:'读题 · 说清要证什么', label:'用自己的话说：这道题要你证什么？', sample:['要证这个级数收敛，还要判断它是条件收敛还是绝对收敛。','条件收敛就是级数本身收敛，但把每一项换成绝对值后新级数发散。']},
  2:{title:'拆题 · 要证几件事', label:'拆题：这道题你要分别证明几件事？', sample:['两件：先证原级数收敛；再证绝对值级数 ∑1/√n 发散。']},
  3:{title:'写第 1 步 · 单调性', label:'写第 1 步 + 依据（一句话）', sample:['先攻收敛。u_n=1/√n 随 n 增大而变小，因为分母越来越大。']},
  4:{title:'补不等式 · 每步必须写依据', label:'把不等式补进第 1 步 + 依据', sample:['1/√(n+1) < 1/√n，因为 n+1 > n。这是莱布尼茨判别法的单调条件。']},
  5:{title:'卡住 · 打开提示阶梯', label:'本节点由 /hint 推进：卡住了就打开提示阶梯。', sample:[]},
  6:{title:'写第 3 步并收成结论', label:'写第 3 步：把「极限为 0」的依据写出来', sample:['因为 lim n^{1/2}=+∞，所以 lim 1/√n=0。','由莱布尼茨判别法，这个交错级数收敛。']},
  7:{title:'要答案 · 触发三段式拒绝', label:'本节点由 /answer-request 推进：直接向 AI 要完整证明。', sample:[]},
  8:{title:'绝对收敛 · 小白解释 + 回严格', label:'第二件事：∑1/√n 是什么级数？你卡在哪？', sample:['∑1/√n 是 p 级数，p=1/2。可 p 级数什么时候收敛我忘了，看不懂。','p=1/2 ≤ 1，所以 ∑1/√n 发散。']},
  9:{title:'终稿核对 + 五问复盘', label:'交终稿，核对覆盖表并完成五问复盘。', sample:[]},
  10:{title:'迁移与总结', label:'规律、自检卡与变式题。', sample:[]}
};
var FINAL_SAMPLE = '① 令 u_n = 1/√n。因为 n+1 > n，所以 1/√(n+1) < 1/√n，即 {u_n} 单调递减。② 因为 n^{1/2} 趋于 +∞，所以 lim 1/√n = 0（极限为零的依据：分母趋于无穷）。③ 由莱布尼茨判别法，∑(−1)^{n−1}/√n 收敛。④ 而 ∑1/√n 是 p=1/2 的 p-级数，p≤1 故发散，所以原级数不绝对收敛。因此它是条件收敛。';
var REVIEW_QS = ['用一句话说清：这道题在证什么？','你的证明分几段？顺序是什么？','哪一步是这题的胜负手？为什么？','写到什么程度算证完？','哪些方法能带走？哪些细节只在本题有用？'];
var REVIEW_SAMPLE = ['判定一个交错级数是条件收敛。','两段：先证原级数收敛，再证绝对值级数发散。','第一步就想到「条件收敛要证两件事」，否则会漏掉绝对发散。','结论写明条件收敛，两段理由都有依据，判别法条件逐条核对。','带走：交错用莱布尼茨、条件收敛补证绝对发散、p 级数规则；带不走：1/√n 这个具体形式。'];
var VARIANT_STEM = '判断级数 ∑_{n=1}^{∞} (−1)^{n−1}/n² 的收敛性，并说明它是条件收敛还是绝对收敛。';

function screenForAttempt(payload){
  var state = payload.state || {};
  var attempt = payload.attempt || {};
  if(attempt.finishedAt || state.finishedAt || state.node >= 10 || state.phase === 'P6') return 'S5';
  if(state.node >= 9 || state.phase === 'P4' || state.phase === 'P5') return 'S4';
  return 'S3';
}
function applyAttemptPayload(payload){
  St.attemptId = payload.attemptId || (payload.attempt && payload.attempt.attemptId) || St.attemptId;
  St.attempt = payload.attempt || St.attempt || {};
  St.problem = payload.problem || St.problem || {};
  St.state = payload.state || St.state;
  St.draft = (St.state && St.state.draft) || payload.draft || [];
  St.coverage = (St.state && St.state.coverage && (St.state.coverage.items || []).length) ? St.state.coverage : (St.attempt && St.attempt.coverage && (St.attempt.coverage.items || []).length ? St.attempt.coverage : null);
  St.review = (St.attempt && St.attempt.review) || null;
  St.mastery = (St.attempt && St.attempt.mastery) || St.mastery || null;
  if(St.review && St.review.mastery) St.mastery = St.review.mastery;
  St.variant = (St.attempt && St.attempt.variantResult) || St.variant || null;
  St.messages = normalizeMessages(payload.messages);
  var screen = screenForAttempt(payload);
  St.screen = screen;
  St.reviewAnswersInitialized = false;
  saveSession();
  renderStudent();
}
function normalizeMessages(list){
  return (list || []).map(function(m){
    if(!m) return null;
    var role = m.role || m.who || 'ai';
    var content = m.content;
    if(role === 'student'){
      var t = (content && (content.text || content.content)) || m.text || '';
      return {kind:'student', text:String(t), ts:m.ts};
    }
    if(role === 'ai'){
      var ai = (content && typeof content === 'object' && (content.judge != null || content.hint != null)) ? content : {judge:'', hint:(content && (content.text || content.content)) || m.text || '', ask:''};
      return {kind:'ai', ai:ai, tag:m.tag || '', ts:m.ts};
    }
    return {kind:'system', text:(typeof content === 'string' ? content : (content && content.text)) || m.text || '', ts:m.ts};
  }).filter(Boolean);
}
async function startProblem(problemId){
  try{
    var data = await api('POST', '/api/attempts', {problemId:problemId});
    St.attemptId = data.attemptId;
    St.problem = data.problem || {};
    St.state = data.state || {};
    St.draft = St.state.draft || [];
    St.messages = [];
    St.coverage = null; St.review = null; St.mastery = null; St.variant = null;
    St.reviewAnswersInitialized = false;
    saveSession();
    var payload = await api('GET', '/api/attempts/' + encodeURIComponent(data.attemptId));
    applyAttemptPayload(payload);
    if(St.screen === 'S3') startTimer();
    toast('已进入作答 · 节点 ' + (St.state.node || 1));
  }catch(e){
    if(e.status === 409 && e.detail && e.detail.problemId){
      toast('这道题暂未开放完整脚本，Demo 只完整开放第 1 题', 'warn');
    }else showApiError(e, '开始作答失败');
  }
}
async function resumeAttempt(id){
  if(!id) return startProblem('p-cond-series');
  try{
    var payload = await api('GET', '/api/attempts/' + encodeURIComponent(id));
    applyAttemptPayload(payload);
    toast('已恢复上次作答');
  }catch(e){ showApiError(e, '恢复作答失败'); }
}
function startTimer(){
  stopTimer();
  St.timerId = setInterval(function(){
    if(St.screen === 'S3' || St.screen === 'S4'){
      var el = $('#s3-timer');
      if(el){ St.timerSec++; el.textContent = fmtTime(St.timerSec); }
    }
  }, 1000);
}
function stopTimer(){ if(St.timerId){ clearInterval(St.timerId); St.timerId = null; } }
function phaseIndex(phase){ return {P1:1,P2:2,P3:3,P4:4,P5:5,P6:6}[phase] || 1; }
function phaseBarHtml(){
  var cur = phaseIndex(St.state && St.state.phase);
  var labels = [['P1','激活'],['P2','拆题'],['P3','分步'],['P4','核对'],['P5','复盘'],['P6','迁移']];
  return '<div class="phase-track">' + labels.map(function(x, i){
    var n = i + 1;
    return '<div class="phase-step' + (n === cur ? ' current' : '') + (n < cur ? ' done' : '') + '"><b>' + x[0] + ' ' + x[1] + '</b>' + (n === 1 ? '核对定义' : n === 2 ? '说清目标' : n === 3 ? '一步一依据' : n === 4 ? '覆盖表' : n === 5 ? '五问' : '规律+变式') + '</div>';
  }).join('') + '</div>';
}
function aiBubbleHtml(m){
  var ai = m.ai || {};
  var tag = m.tag || ai.tag || '';
  return '<div class="msg ai"><div class="ava">AI</div><div class="bubble">' +
    (tag ? '<span class="msg-tag">' + esc(tag) + '</span>' : '') +
    '<div class="tri">' +
    (ai.judge ? '<p><span class="seg-label seg-judge">【判断】</span>' + formatMath(ai.judge) + '</p>' : '') +
    (ai.hint ? '<p><span class="seg-label seg-hint">【提示】</span>' + formatMath(ai.hint) + '</p>' : '') +
    (ai.ask ? '<p><span class="seg-label seg-ask">【提问】</span>' + formatMath(ai.ask) + '</p>' : '') +
    '</div></div></div>';
}
function chatHtml(){
  if(!St.messages.length) return '<div class="msg system"><span>已进入 S3 作答：AI 不写证明，只指出第一处可疑步骤。每一步请写「结论 + 依据」。</span></div>';
  return St.messages.map(function(m){
    if(m.kind === 'student') return '<div class="msg student"><div class="bubble">' + esc(m.text) + '</div></div>';
    if(m.kind === 'system') return '<div class="msg system"><span>' + esc(m.text) + '</span></div>';
    if(m.kind === 'hint') return '<div class="msg ai"><div class="ava">AI</div><div class="bubble"><span class="msg-tag amber">' + esc(m.tag || m.level) + '</span><div class="tri"><p><span class="seg-label seg-hint">【提示】</span>' + esc(m.text) + '</p></div></div></div>';
    if(m.kind === 'xiaobai'){ var c = m.card || {}; return '<div class="msg ai"><div class="ava">AI</div><div class="bubble"><span class="msg-tag amber">小白解释</span><div class="mini-card"><h5>' + esc(c.concept || '概念解释') + '</h5><ol><li><b>一句话类比：</b>' + esc(c.analogy || '') + '</li><li><b>与本题无关的最小例子：</b>' + esc(c.example || '') + '</li><li><b>回到严格表述：</b><span class="strict">' + esc(c.formal || '') + '</span></li></ol><p class="small" style="margin-top:6px">' + esc(c.ask || '') + '</p></div></div></div>'; }
    if(m.kind === 'refusal'){ var r = m.refusal || {}; return '<div class="msg ai"><div class="ava">AI</div><div class="bubble"><span class="msg-tag red">三段式拒绝</span><div class="tri"><p><span class="seg-label seg-judge">【接住】</span>' + esc(r.receive || '') + '</p><p><span class="seg-label seg-hint">【规则】</span>' + esc(r.rule || '') + '</p><p><span class="seg-label seg-ask">【替代动作】</span>' + esc((r.alternatives || []).join(' / ')) + '</p></div></div></div>'; }
    return aiBubbleHtml(m);
  }).join('');
}
function budgetHtml(){
  var b = (St.state && St.state.budgets) || {};
  var u = (St.state && St.state.used) || {};
  function chip(name, key){ var rem = Math.max(0, (b[key] || 0) - (u[key] || 0)); return '<span class="bchip' + (rem <= 0 ? ' zero' : '') + '">' + name + ' <b>' + rem + '</b>/' + (b[key] || 0) + '</span>'; }
  return chip('L1','L1') + chip('L2','L2') + chip('L3','L3') + chip('L4','L4') + chip('小白','xiaobai') + chip('L0','L0');
}
function unlockedHtml(){
  var un = (St.state && St.state.unlocked) || ['L0'];
  return '<span class="small muted">后端已解锁：' + esc(un.join(' / ')) + '</span>';
}
function renderS3(root){
  var state = St.state || {};
  var node = state.node || 1;
  var meta = STEP_META[node] || STEP_META[1];
  var draft = (state.draft || []).length ? state.draft : (St.draft || []);
  var problem = St.problem || {};
  root.innerHTML =
    '<div class="breadcrumb"><span>S2 选题</span><span class="sep">›</span><strong>S3 作答</strong><span class="sep">·</span><span>' + esc(problemTitle(problem)) + '</span>' +
      '<button class="lesson-link" data-action="back-home">保存并返回今日任务</button></div>' +
    '<div class="s3-top"><div class="s3-top-l"><span class="step-pill">节点 ' + node + ' / ' + (state.nodeTotal || 10) + '</span>' +
      '<span class="timer" id="s3-timer">' + fmtTime(St.timerSec) + '</span>' +
      '<span class="chip">' + esc(state.phaseLabel || state.phase || '') + '</span></div>' + phaseBarHtml() + '</div>' +
    '<div class="s3-grid">' +
      '<div class="area-problem card">' +
        '<div class="card-title"><span class="tag tag-red">必做</span><h3>' + esc(problemTitle(problem)) + '</h3><span class="tag tag-blue">' + esc(problem.chapter || '级数') + '</span></div>' +
        '<div class="stem-box">' + formatMath(problem.stem || '题目加载中…') + '<span class="stem-note">证明你的结论。每一步都要写出依据；AI 只指第一处可疑步骤。</span></div>' +
        '<div class="problem-meta"><span class="tag">' + esc((problem.kp || []).join(' / ')) + '</span><span class="tag tag-amber">预计 ' + (problem.estimatedMin || '—') + ' 分钟</span><span class="tag">' + esc(meta.title) + '</span></div>' +
        '<button class="lesson-link" style="margin-top:10px" data-action="open-def">查看「条件收敛 / p 级数」定义原文（只核对，不讲课）</button>' +
      '</div>' +
      '<div class="area-side">' +
        '<div class="card s3-side-card"><div class="chat-head"><span class="ai-ava">AI</span><strong>AI 陪练</strong><span class="tag">不写证明 · 只给最小提示</span></div>' +
          '<div class="chat-log" id="chat-log">' + chatHtml() + '</div>' +
          '<div class="chat-compose" id="s3-compose">' + composeHtml(node) + '</div></div>' +
        '<div class="card hint-card"><div class="row-between"><h3 style="font-size:15px">提示阶梯</h3><span class="tag" id="hint-left">信息型提示剩余 ' + infoRemain() + ' 次</span></div>' +
          '<div class="budget-chips">' + budgetHtml() + '</div>' +
          '<div class="row" style="margin-top:10px"><button class="btn btn-soft btn-sm" data-action="open-hints">打开提示阶梯 · L0–L4</button></div>' +
          '<div class="small muted" style="margin-top:6px">' + unlockedHtml() + '</div>' +
          '<div class="redline-note"><b>红线</b><span>AI 对话区永不出现完整证明/最终答案；你的终稿只出现在「我的草稿」区。</span></div></div>' +
        '<div class="card"><div class="quick-actions"><button class="btn btn-danger" data-action="ask-answer">我要答案</button><button class="btn btn-amber" data-action="xiaobai">看不懂</button></div>' +
          '<p class="small muted" style="margin-top:8px">两个高风险入口都真实调用后端：/answer-request 与 /xiaobai；前端不伪造 AI 回复。</p></div>' +
      '</div>' +
      '<div class="area-draft card draft-wrap"><div class="draft-head"><h3>我的草稿 / 终稿</h3><span class="save">已自动保存</span><span class="tag tag-blue">只有你能看到</span></div>' +
        '<ul class="draft-list">' + (draft.length ? draft.map(function(d){ return '<li>' + esc(d.text) + '<span class="d-tag">' + esc(d.tag || '学生写出') + '</span></li>'; }).join('') : '<li class="draft-empty" style="border-left:0;background:transparent">还没有内容。每通过一步，你写的那一步会出现在这里；AI 对话区不会代写。</li>') + '</ul>' +
        '<div class="redline-note"><b>说明</b><span>草稿由你自己逐步写；刷新页面会用 GET /api/attempts/:id 恢复草稿与对话。</span></div></div>' +
    '</div>';
  bindCompose(node);
  scrollChat();
}
function infoRemain(){
  var b = (St.state && St.state.budgets) || {};
  var u = (St.state && St.state.used) || {};
  return Math.max(0, (b.L1 || 0) - (u.L1 || 0)) + Math.max(0, (b.L2 || 0) - (u.L2 || 0)) + Math.max(0, (b.L3 || 0) - (u.L3 || 0)) + Math.max(0, (b.L4 || 0) - (u.L4 || 0));
}
function composeHtml(node){
  if(node === 5){
    return '<div class="compose-label"><span class="num">节点 5 / 10</span>卡住了？这个节点由 /hint 推进</div>' +
      '<p class="small muted">节点 5 不调用 /step：打开提示阶梯，由后端判断解锁与预算。L2 只给方向，L3/L4 给一步就必须复述。</p>' +
      '<div class="compose-actions"><button class="btn btn-primary btn-sm" data-action="open-hints">打开提示阶梯 →</button></div>' +
      '<div class="next-tip"><b>下一步：</b>在浮层里选一级可用提示；用完后会自动进入节点 6。</div>';
  }
  if(node === 7){
    return '<div class="compose-label"><span class="num">节点 7 / 10</span>要答案节点：直接向 AI 要完整证明</div>' +
      '<p class="small muted">这个节点由 /answer-request 推进。你会看到三段式拒绝 + 60 秒替代动作，AI 不会给完整证明。</p>' +
      '<div class="compose-actions"><button class="btn btn-danger btn-sm" data-action="ask-answer">发送「直接给我完整证明」→</button></div>' +
      '<div class="next-tip"><b>下一步：</b>选一个替代动作，然后回到节点 8。</div>';
  }
  var meta = STEP_META[node] || STEP_META[1];
  var round = (St.state && St.state.round) || 0;
  var samples = meta.sample || [];
  var sample = samples[Math.min(round, samples.length - 1)] || '';
  return '<div class="compose-label"><span class="num">节点 ' + node + ' / 10</span>' + esc(meta.label) + '</div>' +
    '<textarea class="ta" id="student-input" placeholder="写一步 + 依据，例如：因为……所以……"></textarea>' +
    '<div class="compose-actions"><button class="btn btn-soft btn-sm" data-action="fill-sample" data-sample="' + esc(sample) + '">填入示例作答</button>' +
    '<button class="btn btn-primary btn-sm" data-action="submit-step">提交这一步</button></div>' +
    '<div class="next-tip"><b>下一步：</b>提交后后端会返回三段式判断；点「提示阶梯」可看后端解锁级别。</div>';
}
function bindCompose(node){
  var log = $('#chat-log');
  if(log) log.scrollTop = log.scrollHeight;
}
function scrollChat(){ var log = $('#chat-log'); if(log) log.scrollTop = log.scrollHeight; }

async function submitStep(){
  var ta = $('#student-input');
  var text = ta ? (ta.value || '').trim() : '';
  if(!text){ toast('先写一句再提交；也可以点「填入示例作答」', 'warn'); if(ta) ta.focus(); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/step', {text:text});
    St.messages.push({kind:'student', text:text});
    St.messages.push({kind:'ai', ai:data.ai, tag:data.ai && data.ai.tag});
    if(data.diagnosis && data.diagnosis.type){ /* diagnosis 只用于后端事件，不展示判分 */ }
    updateFromResponse(data);
    if(data.guard && data.guard.blocked){ toast('guard 拦截：' + (data.guard.rules || []).join(', ') + '，已替换为安全提示', 'warn'); }
    renderStudent();
    toast('后端已返回 · 节点 ' + ((St.state && St.state.node) || '—'));
  }catch(e){
    if(e.status === 409 && e.code === 'WRONG_PHASE'){
      var use = e.detail && e.detail.use;
      toast(e.message || '当前节点请走专用接口', 'warn');
      if(use === '/hint') openHintModal();
      else if(use === '/answer-request') askAnswer();
      else if(use === '/final' || use === '/review'){ St.screen = 'S4'; renderStudent(); }
      return;
    }
    showApiError(e, '提交失败');
  }
}
function updateFromResponse(data){
  if(data.state){ St.state = data.state; St.draft = data.state.draft || St.draft; St.coverage = data.state.coverage || St.coverage; }
  if(data.draft){ St.draft = data.draft; if(St.state) St.state.draft = data.draft; }
  if(data.coverage) St.coverage = data.coverage;
  if(data.attempt) St.attempt = data.attempt;
  if(data.independence) St.attempt = St.attempt || {};
  if(data.state && St.screen !== 'S5') St.screen = screenForAttempt({state:St.state, attempt:St.attempt});
  saveSession();
}

/* ---------- 提示阶梯（/hint） ---------- */
function openHintModal(lockNote){
  var state = St.state || {};
  var b = state.budgets || {};
  var u = state.used || {};
  var un = state.unlocked || ['L0'];
  var levels = ['L0','L1','L2','L3','L4'];
  var names = {L0:'元认知追问 · 0 条新信息',L1:'概念提示 · 只点名定义/定理',L2:'方向提示 · 只给方向/结构',L3:'局部步骤 · 给一步就交还',L4:'示范微步 · 1–2 行 + 交接'};
  var rows = levels.map(function(lv){
    var rem = Math.max(0, (b[lv] || 0) - (u[lv] || 0));
    var isUnlocked = un.indexOf(lv) >= 0;
    var usedUp = rem <= 0;
    var btn;
    if(usedUp) btn = '<button class="btn btn-ghost btn-sm" disabled>已用完</button>';
    else if(!isUnlocked) btn = '<button class="btn btn-ghost btn-sm" data-action="use-hint" data-level="' + lv + '">未解锁 · 仍可点（后端校验）</button>';
    else btn = '<button class="btn btn-soft btn-sm" data-action="use-hint" data-level="' + lv + '">使用 ' + lv + ' · 剩 ' + rem + '</button>';
    return '<div class="hint-line' + (lv === 'L2' ? ' recommend' : '') + (usedUp || !isUnlocked ? ' off' : '') + '"><div class="hl-lv">' + lv + '</div>' +
      '<div class="hl-body"><b>' + names[lv] + '</b><span>后端预算：' + (b[lv] || 0) + ' 次 · 已用 ' + (u[lv] || 0) + ' 次</span>' +
      (!isUnlocked && !usedUp ? '<span class="hl-lock">后端未解锁（点按钮会返回 409 HINT_LOCKED）</span>' : '') + '</div>' +
      '<div class="hl-use">' + btn + '</div></div>';
  }).join('');
  var lockHtml = lockNote ? '<div class="feedback" style="border-color:var(--amber-line);background:var(--amber-bg);margin-top:10px"><b>后端返回 409 HINT_LOCKED</b><p class="small">' + esc(lockNote) + '</p><p class="small muted">解锁规则由服务端维护：L0 随时；L1 提交≥1；L2 用 L1 或连续 2 次；L3 用 L2 或 3 次；L4 用 L3 或 4 次。</p></div>' : '';
  var html = '<h3>提示阶梯 · 后端说了算</h3>' +
    '<p class="small muted">预算与解锁来自 state.budgets / used / unlocked；前端不自己扣次数。当前信息型提示剩余 <b>' + infoRemain() + '</b> 次，轮次 ' + (state.node || 1) + '/' + (state.nodeTotal || 10) + '，阶段 ' + esc(state.phaseLabel || '') + '。</p>' +
    lockHtml + '<div class="hint-ladder">' + rows + '</div>' +
    '<p class="small muted" style="margin-top:8px">L3/L4 用完后必须用一句话复述理由；同一等级不重复同一句话。预算用尽会返回 429 + softLanding。</p>' +
    '<div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-action="open-def">看定义卡</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="soft-easier">换同知识点更小题</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="soft-teacher">预算不够？转教师工单</button></div>';
  openModal(html, {wide:true});
}
async function useHint(level){
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/hint', {level:level});
    St.messages.push({kind:'hint', level:level, text:data.text, tag:data.tag || (level + ' 提示')});
    if(data.state) St.state = data.state;
    if(data.guard && data.guard.blocked){ toast('guard 拦截：' + (data.guard.rules || []).join(', '), 'warn'); }
    if(typeof modalClose === 'function' && $('#modal-root') && !$('#modal-root').hidden) modalClose();
    St.screen = screenForAttempt({state:St.state, attempt:St.attempt});
    renderStudent();
    if(St.screen === 'S3' && $('#chat-log')) $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
    toast(data.tag || (level + ' 提示已返回'));
    if(level === 'L3' || level === 'L4') toast('复述承诺：请先用一句话说出这一步的理由，再继续', 'warn');
  }catch(e){
    if(e.code === 'HINT_LOCKED'){
      var note = (e.detail && e.detail.reason) === 'NEED_PREV_LEVEL' ? '这一级提示还没解锁，先提交一次尝试或先用上一级。' : (e.message || '提示未解锁');
      openHintModal(note);
      toast('后端拒绝：' + note, 'warn');
      return;
    }
    if(e.code === 'BUDGET_EXHAUSTED'){
      showSoftLanding(e);
      return;
    }
    showApiError(e, '获取提示失败');
  }
}

/* ---------- 三段式拒绝（/answer-request） ---------- */
async function askAnswer(){
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/answer-request', {});
    if(data.state) St.state = data.state;
    St.messages.push({kind:'refusal', refusal:data.refusal || {}});
    var r = data.refusal || {};
    var details = r.alternativeDetails || (r.alternatives || []).map(function(x, i){ return {id:'alt' + i, label:x}; });
    var html = '<h3>这个请求我不能满足，但不会让你卡死</h3>' +
      '<p class="small muted">服务端拒绝模板：接住需求 → 一次说清规则 → 给一个 60 秒内能做的替代动作。</p>' +
      '<div class="refuse-steps">' +
      '<div class="refuse-step"><span class="rs-label">① 接住</span><div>' + esc(r.receive || '') + '</div></div>' +
      '<div class="refuse-step"><span class="rs-label">② 说清规则</span><div>' + esc(r.rule || '') + '</div></div>' +
      '<div class="refuse-step"><span class="rs-label ok">③ 替代动作</span><div><div class="alt-grid">' +
      details.map(function(d, i){
        return '<button class="alt-btn" data-action="choose-alt" data-id="' + esc(d.id || i) + '"><b>' + esc(d.label || d) + '</b><span>' + esc(d.desc || '选择一个 60 秒内能做的动作') + '</span></button>';
      }).join('') + '</div></div></div></div>' +
      '<div class="redline-note"><b>红线</b><span>完整证明 / 最终答案 / 可抄推导链不会因任何请求破例；输入越长越会触发 guard 粘贴标记。</span></div>';
    openModal(html, {wide:true});
    St.screen = screenForAttempt({state:St.state, attempt:St.attempt});
    renderStudent();
  }catch(e){ showApiError(e, '要答案请求失败'); }
}
function chooseAlternative(id){
  if(modalClose) modalClose();
  if(id === 'definition' || id === 'a0' || id === 'alt0'){ openDefModal(); return; }
  if(id === 'teacher' || id === 'alt3'){ toast('已生成教师工单（Demo 展示出口；契约未定义工单持久化端点）', 'warn'); return; }
  toast('已选择替代动作：回到原题，只写下一步', 'warn');
  var ta = $('#student-input'); if(ta) ta.focus();
}

/* ---------- 小白解释（/xiaobai） ---------- */
async function showXiaobai(){
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/xiaobai', {concept:'p级数'});
    var card = data.card || {};
    St.messages.push({kind:'xiaobai', card:card});
    if(data.state) St.state = data.state;
    var html = '<h3>小白解释卡 · ' + esc(card.concept || '概念解释') + '</h3>' +
      '<p class="small muted">只解释概念与定理，不解释本题做法；给完必须回到严格表述并复述。</p>' +
      '<div class="mini-explain">' +
      '<div class="me"><span class="n">1</span><div><b>一句日常类比</b><p>' + esc(card.analogy || '') + '</p></div></div>' +
      '<div class="me"><span class="n">2</span><div><b>与本题无关的最小例子</b><p>' + esc(card.example || '') + '</p></div></div>' +
      '<div class="me"><span class="n">3</span><div><b>回到严格表述</b><p>' + esc(card.formal || '') + '</p></div></div>' +
      '</div><div class="feedback"><b>后端要求你复述：</b>' + esc(card.ask || '') + '</div>' +
      '<p class="small muted" style="margin-top:8px">剩余小白解释次数：' + (data.remaining != null ? data.remaining : '—') + ' / 2（由后端计数）。</p>' +
      '<div class="row" style="margin-top:10px"><button class="btn btn-primary" data-close>记下了，回题目复述</button></div>';
    openModal(html);
    renderStudent();
  }catch(e){
    if(e.code === 'XIAOBAI_LIMIT'){ showSoftLanding(e, '小白解释次数已用完'); return; }
    showApiError(e, '小白解释请求失败');
  }
}

/* ---------- 定义卡 / 软着陆出口 ---------- */
function openDefModal(){
  if(modalClose) modalClose();
  openModal('<h3>定义原文 · 只核对，不讲课</h3><p class="small muted">这些是知识，可以直接看；本题怎么做、下一步写什么，不在这里。</p>' +
    '<div class="stack-sm" style="margin-top:10px">' +
    '<div class="feedback"><b>条件收敛</b><p class="small">若级数 ∑a<sub>n</sub> 收敛，而绝对值级数 ∑|a<sub>n</sub>| 发散，则称 ∑a<sub>n</sub> 条件收敛。</p></div>' +
    '<div class="feedback"><b>莱布尼茨判别法</b><p class="small">交错级数 ∑(−1)<sup>n−1</sup>u<sub>n</sub>（u<sub>n</sub> ≥ 0）若满足：① u<sub>n</sub> 单调递减；② lim u<sub>n</sub> = 0，则级数收敛。</p></div>' +
    '<div class="feedback"><b>p 级数</b><p class="small">∑1/n<sup>p</sup>：p &gt; 1 收敛；0 &lt; p ≤ 1 发散。</p></div>' +
    '</div><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>知道了，回题目</button></div>');
}
function showSoftLanding(err, prefix){
  var detail = (err && err.detail) || {};
  var sd = (err && err.body && err.body.softLanding) || detail.softLanding || null;
  var options = (sd && sd.options) || detail.options || [];
  var labels = {l0:'只做 L0 追问', definition:'看定义卡', easier:'换同知识点更简单题', teacher:'转教师'};
  var descs = {l0:'不再给新信息，只问依据', definition:'只给定义/定理原文', easier:'换一道更小的问题继续', teacher:'保存草稿，生成教师工单'};
  if(!options.length){ options = ['l0','definition','easier','teacher'].map(function(id){ return {id:id, label:labels[id], desc:descs[id]}; }); }
  var opts = options.map(function(o){
    if(typeof o === 'string') o = {id:o, label:labels[o] || o, desc:descs[o] || ''};
    var id = o.id || o.label;
    return '<button class="soft-opt" data-action="soft-option" data-id="' + esc(id) + '"><b>' + esc(o.label || id) + '</b><span>' + esc(o.desc || '') + '</span></button>';
  }).join('');
  openModal('<h3>' + esc(prefix || '提示预算用尽 · 软着陆') + '</h3>' +
    '<p class="small muted">后端已停止升级，也不给答案（' + esc((err && err.code) || 'BUDGET_EXHAUSTED') + '）。现在只能换一种方式继续：</p>' +
    '<div class="soft-landing">' + opts + '</div>' +
    '<div class="redline-note"><b>红线</b><span>预算用尽后不再升级、不给答案；只能 L0 追问、看定义原文、换更小题或转教师。</span></div>' +
    '<div class="row" style="margin-top:10px"><button class="btn btn-ghost" data-close>先留在原题</button></div>');
}
function softOption(id){
  if(modalClose) modalClose();
  if(id === 'definition'){ openDefModal(); return; }
  if(id === 'l0'){ toast('只做 L0 追问：在对话框继续写你的依据，不再给新信息', 'warn'); var ta = $('#student-input'); if(ta) ta.focus(); return; }
  if(id === 'easier'){ openModal('<h3>换一道同知识点更小题（只给题面）</h3><p class="small muted">不占原题提示预算；换题只给题面，不给解法。</p><div class="variant-stem" style="margin:10px 0">判断级数 ∑<sub>n=1</sub><sup>∞</sup> (−1)<sup>n−1</sup>/n 的收敛性；若收敛，是条件收敛还是绝对收敛？</div><p class="small muted">比原题小一档：分母是 n 而不是 √n。Demo 版只展示出口，不切换当前题。</p><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>返回原题</button></div>'); return; }
  if(id === 'teacher'){ toast('已生成教师工单（Demo 展示出口；契约未定义持久化端点）', 'warn'); return; }
  toast('已选择：' + id);
}


/* ================= 学生端：S4 终稿核对 + 五问复盘 ================= */
function renderS4(root){
  var state = St.state || {};
  var draft = state.draft || St.draft || [];
  var coverage = St.coverage || state.coverage || null;
  var items = (coverage && coverage.items) || [];
  var passed = !!(coverage && coverage.passed);
  var hasSubmittedFinal = !!((St.attempt && St.attempt.finalText) || items.length || (coverage && coverage.percent > 0) || St.finalInput);
  if(!hasSubmittedFinal) coverage = null;
  var finalText = (St.attempt && St.attempt.finalText) || St.finalInput || draft.map(function(d){ return d.text; }).join('\n');
  root.innerHTML =
    '<div class="breadcrumb"><span>S3 作答</span><span class="sep">›</span><strong>S4 终稿核对 + 复盘</strong></div>' +
    '<div class="page-head"><div><div class="eyebrow">S4 · 终稿核对 + 五问复盘</div><h2>交终稿：只核对覆盖，不给参考证明</h2>' +
      '<p>覆盖表来自 POST /final 的服务端关键词匹配；清单问句化，AI 不给参考证明。</p></div>' +
      '<span class="tag tag-blue">节点 ' + (state.node || 9) + ' / ' + (state.nodeTotal || 10) + ' · ' + esc(state.phaseLabel || state.phase || '') + '</span></div>' +
    '<div class="s4-grid" id="s4-grid">' +
      '<div class="card"><div class="card-title"><h3>你的终稿（学生自己写）</h3><span class="tag tag-green">只有你能看到</span></div>' +
        '<p class="small muted" style="margin-bottom:10px">这是你 S3 写下的草稿，可以继续改；提交后只对照要点给覆盖反馈。</p>' +
        '<textarea id="final-draft" class="ta ta-lg" rows="8" placeholder="把你在 S3 写的几步整理成终稿…">' + esc(finalText) + '</textarea>' +
        '<div class="compose-actions"><button class="btn btn-soft" data-action="fill-final">填入示例终稿（演示：学生示例稿，非 AI 生成）</button>' +
        '<button class="btn btn-primary" data-action="submit-final">提交终稿，核对覆盖</button></div>' +
        (coverage ? '<div style="margin-top:14px"><div class="row-between"><h4>要点覆盖表（全部问句化）</h4><span class="tag ' + (passed ? 'tag-green' : 'tag-amber') + '">覆盖 ' + (coverage.covered || 0) + ' / ' + (coverage.total || 5) + ' · ' + (coverage.percent || 0) + '%' + (passed ? '（≥80% 通过）' : '（未过 80%）') + '</span></div>' +
          '<div class="table-wrap" style="margin-top:8px"><table class="table coverage-table"><thead><tr><th>✓</th><th>AI 内部要点 → 给你的问句</th></tr></thead><tbody>' +
          (items.length ? items.map(function(it){
            var covered = it.covered !== false;
            return '<tr><td><span class="' + (covered ? 'ok-mark' : 'miss-mark') + '">' + (covered ? '✓' : '○') + '</span></td><td>' + formatMath(it.question || it.text || it.id || '') + '</td></tr>';
          }).join('') : '<tr><td>—</td><td>服务端未返回覆盖明细</td></tr>') +
          '</tbody></table></div>' +
          '<p class="small muted" style="margin-top:8px">' + (passed ? '覆盖通过，可以进入五问复盘。' : '覆盖未过 80%：按上面的问句补一补，再重新提交终稿。') + '</p>' +
          (passed ? '<button class="btn btn-primary btn-sm" data-action="focus-review">进入五问复盘 →</button>' : '') + '</div>' : '') +
        '<div class="redline-note"><b>红线</b><span>这里不会出现参考证明或「标准答案」；缺项只用问句补，由你自己改。</span></div></div>' +
      '<div class="card" id="review-card">' +
        '<div class="card-title"><h3>五问复盘卡</h3><span class="tag tag-amber">P5</span></div>' +
        (passed ? '' : '<p class="small muted">覆盖通过后开放；由 POST /review 校验 5 条答案。</p>') +
        '<div id="review-fields" style="margin-top:6px">' + REVIEW_QS.map(function(q, i){
          return '<div class="review-q"><span class="qnum">' + (i + 1) + '</span><div><div class="qtext">' + esc(q) + '</div><textarea class="ta" id="review-q' + (i + 1) + '" placeholder="用你自己的证明回答" ' + (passed ? '' : 'disabled') + '>' + esc((St.review && St.review.answers && St.review.answers[i]) || '') + '</textarea></div></div>';
        }).join('') + '</div>' +
        (passed ? '<div class="compose-actions"><button class="btn btn-soft" data-action="fill-review">填入示例答案</button><button class="btn btn-primary" data-action="submit-review">提交复盘卡</button></div>' : '') +
        (St.review && St.review.feedback && St.review.feedback.length ? '<div class="feedback"><b>后端反馈：</b>' + St.review.feedback.map(function(x){ return '<div class="small">第 ' + (x.index || '—') + ' 问：' + esc(x.comment || '') + '</div>'; }).join('') + (St.mastery != null ? '<p style="margin-top:4px"><b>掌握度：' + esc(St.mastery) + ' / 100</b></p>' : '') + '</div>' : '') +
        '<div class="redline-note"><b>说明</b><span>复盘卡是「完整讲解」的替代物：只列问句，学生一次作答，不给参考证明。</span></div></div>' +
    '</div>';
  St.reviewAnswersInitialized = true;
}
function prefillReviewExamples(){
  REVIEW_SAMPLE.forEach(function(v, i){ var ta = $('#review-q' + (i + 1)); if(ta && !ta.value) ta.value = v; });
}
function readReviewAnswers(){
  var arr = [];
  for(var i = 1; i <= 5; i++){ var ta = $('#review-q' + i); arr.push(ta ? ta.value.trim() : ''); }
  return arr;
}
async function submitFinal(){
  var ta = $('#final-draft');
  var text = ta ? (ta.value || '').trim() : '';
  if(!text){ toast('终稿还没写；可点「填入示例终稿」再提交', 'warn'); return; }
  St.finalInput = text;
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/final', {text:text});
    St.coverage = data.coverage || null;
    if(data.state) St.state = data.state;
    if(St.attempt){ St.attempt.finalText = text; }
    if(data.guard && data.guard.blocked){ toast('guard 拦截：' + (data.guard.rules || []).join(', ') + '，已替换为安全提示', 'warn'); }
    renderStudent();
    toast(St.coverage && St.coverage.passed ? ('覆盖 ' + St.coverage.covered + '/' + St.coverage.total + '，通过') : '覆盖未过 80%：按问句补一补再交', St.coverage && St.coverage.passed ? '' : 'warn');
  }catch(e){ showApiError(e, '提交终稿失败'); }
}
async function submitReview(){
  var answers = readReviewAnswers();
  if(answers.some(function(a){ return !a; })){ toast('5 个问题都要回答；可先点「填入示例答案」', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/review', {answers:answers});
    St.review = {answers:answers, feedback:data.feedback || []};
    St.mastery = data.mastery != null ? data.mastery : St.mastery;
    if(data.state) St.state = data.state;
    if(St.attempt) St.attempt.review = St.review;
    St.screen = 'S5';
    saveSession();
    renderStudent();
    toast('复盘已提交 · 掌握度 ' + (St.mastery != null ? St.mastery : '—'));
  }catch(e){
    if(e.code === 'WRONG_PHASE' && e.detail && e.detail.coverage){ toast('覆盖未通过，先补终稿', 'warn'); return; }
    showApiError(e, '提交复盘失败');
  }
}

/* ================= 学生端：S5 完成页 ================= */
function independenceLabel(code){
  return {independent:'独立（仅 L0）', semi:'半独立（L1–L2）', dependent:'依赖（L3–L4 或粘贴）'}[code] || (code || '—');
}
function renderS5(root){
  var state = St.state || {};
  var attempt = St.attempt || {};
  var mastery = St.mastery;
  if(mastery == null && attempt.review && attempt.review.mastery != null) mastery = attempt.review.mastery;
  if(mastery == null && state.mastery != null) mastery = state.mastery;
  var variant = St.variant || (attempt.variantResult ? {result:attempt.variantResult} : null);
  var finished = !!(attempt.finishedAt || state.finishedAt || variant);
  var indep = (variant && variant.state && variant.state.independence) || state.independence || attempt.independence;
  var reviews = (St.review && St.review.answers) || (attempt.review && attempt.review.answers) || [];
  var rulesKey = LS.rules + (St.attemptId || 'demo');
  var checkKey = LS.check + (St.attemptId || 'demo');
  var rules = St.rules || ''; var check = St.check || '';
  try{ rules = rules || localStorage.getItem(rulesKey) || ''; check = check || localStorage.getItem(checkKey) || ''; }catch(e){}
  var b = state.budgets || {}; var u = state.used || {};
  var hintUsed = (u.L1 || 0) + (u.L2 || 0) + (u.L3 || 0) + (u.L4 || 0);
  var timeMin = 0;
  if(attempt.startedAt){ timeMin = Math.max(1, Math.round(((attempt.finishedAt ? new Date(attempt.finishedAt) : new Date()) - new Date(attempt.startedAt)) / 60000)); }
  root.innerHTML =
    '<div class="page-head"><div><div class="eyebrow">S5 · 完成页</div><h2>这一题你走完了整条链</h2>' +
      '<p>掌握度、规律、自检卡、变式题都由过程数据或你自己填写；独立性由后端按 C1 三档判定。</p></div>' +
      '<span class="tag tag-blue">节点 ' + (state.node || 10) + ' / ' + (state.nodeTotal || 10) + '</span></div>' +
    '<div class="stack">' +
      '<div class="card"><div class="mastery">' +
        '<div class="ring" style="--p:' + (mastery != null ? mastery : 78) + '"><div class="ring-inner"><b>' + (mastery != null ? esc(mastery) : '—') + '</b><span>掌握度 / 100</span></div></div>' +
        '<div style="flex:1 1 280px;min-width:0"><div class="row-between"><h3>' + esc(independenceLabel(indep)) + '</h3><span class="tag ' + (indep === 'independent' ? 'tag-green' : (indep === 'dependent' ? 'tag-red' : 'tag-amber')) + '">C1 三档</span></div>' +
          '<p class="small muted" style="margin:4px 0 10px">覆盖 ' + (state.coverage ? (state.coverage.covered + '/' + state.coverage.total) : (attempt.coverage && attempt.coverage.percent != null ? (attempt.coverage.percent + '%') : '—')) + ' · 用时 ' + timeMin + ' 分钟 · 信息型提示 ' + hintUsed + ' 次 · 下一步：规律 + 自检卡 + 变式题。</p>' +
          '<div class="mastery-list">' +
            '<div><span class="mk">要点覆盖</span><span class="mv">' + (state.coverage ? (state.coverage.covered + ' / ' + state.coverage.total) : '—') + '</span></div>' +
            '<div><span class="mk">信息型提示</span><span class="mv">' + hintUsed + ' 次</span></div>' +
            '<div><span class="mk">小白解释</span><span class="mv">' + (u.xiaobai || 0) + ' / ' + (b.xiaobai || 2) + '</span></div>' +
            '<div><span class="mk">拒绝完整证明</span><span class="mv">' + (u.refusals || 0) + ' 次</span></div>' +
            '<div><span class="mk">独立性（C1 三档）</span><span class="mv">' + esc(independenceLabel(indep)) + '</span></div>' +
            '<div><span class="mk">复测安排</span><span class="mv">' + (St.home && St.home.retest ? (esc(St.home.retest.date) + ' · ' + St.home.retest.days + ' 天后') : '完成后安排') + '</span></div>' +
          '</div>' +
          '<p class="small" style="margin:8px 0 0;color:#8a4b08;background:var(--amber-bg);border:1px solid var(--amber-line);border-radius:8px;padding:6px 10px"><b>薄弱点：</b>极限为 0 的依据 / p 级数适用范围（来自本题卡点与提示记录）</p>' +
        '</div></div></div>' +
      '<div class="grid grid-2" style="align-items:start">' +
        '<div class="card"><div class="card-title"><h3>① 写 3–5 条可复用规律</h3><span class="tag tag-purple">由学生产出</span></div>' +
          '<p class="small muted" style="margin-bottom:8px">每条 ≤20 字，必须是可执行动作。Demo 未定义落库端点，仅保存在本机浏览器。</p>' +
          '<textarea id="rules-input" class="ta" rows="5" placeholder="每行一条，例如：交错级数先逐条核对莱布尼茨三个条件">' + esc(rules) + '</textarea>' +
          '<div class="compose-actions"><button class="btn btn-soft" data-action="fill-rules">填入示例规律</button><button class="btn btn-primary" data-action="save-rules">保存到本地</button></div>' +
          '<div class="local-note">本地暂存：契约未定义规律落库端点，刷新后仍保留在本机。</div></div>' +
        '<div class="card"><div class="card-title"><h3>② 做一张自检卡</h3><span class="tag tag-purple">≤6 行</span></div>' +
          '<p class="small muted" style="margin-bottom:8px">按做题顺序排列；同样仅保存在本机浏览器。</p>' +
          '<textarea id="check-input" class="ta" rows="5" placeholder="先判断要证几件事 → 再选判别法 → 核条件 → 写结论">' + esc(check) + '</textarea>' +
          '<div class="compose-actions"><button class="btn btn-soft" data-action="fill-check">填入示例自检卡</button><button class="btn btn-primary" data-action="save-check">保存到本地</button></div>' +
          '<div class="local-note">本地暂存：契约未定义自检卡落库端点。</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-title"><h3>③ 变式题（只给题面）</h3><span class="tag tag-amber">POST /variant</span></div>' +
        (variant ? '<div class="feedback"><b>你的结果：</b>' + (variant.result && variant.result.correct ? '<span class="tag tag-green">正确</span> ' : '<span class="tag tag-amber">需再看</span> ') + esc((variant.result && variant.result.feedback) || '') + '</div>' : '') +
        '<div class="variant-stem" style="margin-top:8px">' + formatMath((variant && variant.variant && variant.variant.stem) || VARIANT_STEM) + '</div>' +
        (finished ? '<p class="small muted" style="margin-top:8px">本题已完成并结束 attempt；变式结果与独立性已写回后端。</p>' :
          '<textarea id="variant-input" class="ta" rows="3" style="margin-top:10px" placeholder="写下你的答案和依据；后端只给对错和一条反馈。"></textarea>' +
          '<div class="compose-actions"><button class="btn btn-soft" data-action="fill-variant">填入示例作答</button><button class="btn btn-primary" data-action="submit-variant">提交变式题</button></div>') +
        '<div class="redline-note"><b>红线</b><span>变式题只给题面、不给提示；提交后后端按关键词判定并结束 attempt。</span></div></div>' +
      '<div class="card" id="retest-card"><div class="card-title"><h3>复测提醒</h3><span class="tag tag-green">闭环</span></div>' +
        '<div class="retest">' +
          '<div class="retest-item"><b>复测日期</b><span class="muted">' + (St.home && St.home.retest ? (esc(St.home.retest.date) + '（' + St.home.retest.days + ' 天后）') : '完成本题后安排') + '</span></div>' +
          '<div class="retest-item"><b>为什么复测</b><span class="muted">检验方法是否留下，而不是重做原题。</span></div>' +
          '<div class="retest-item"><b>教师端可见</b><span class="muted">复测数据会进入班级前后测，不在本页展示。</span></div>' +
        '</div></div>' +
      (finished ? '<div class="card finish-banner"><h2>演示完成 · 10 / 10 节点</h2><p class="muted" style="margin:6px 0 14px">完整链路已走通：S0 登录 → S1 首页 → S2 选题 → S3 作答 → S4 覆盖 + 复盘 → S5 变式。所有数据来自后端。</p>' +
        '<div class="row" style="justify-content:center"><button class="btn btn-primary" data-action="back-home">回到首页</button><button class="btn btn-soft" data-action="goto-s2">再做一题</button></div></div>' : '') +
    '</div>';
}

/* ================= 教师端 ================= */
async function loadTeacher(period){
  if(Teacher.loading) return;
  Teacher.loading = true;
  Teacher.period = period || Teacher.period || 'week';
  var root = $('#teacher-root');
  if(root && !Teacher.data) root.innerHTML = '<div class="card loading-card"><span class="spinner"></span>正在请求 /api/teacher/dashboard?period=' + esc(Teacher.period) + '…</div>';
  try{
    var data = await api('GET', '/api/teacher/dashboard?period=' + encodeURIComponent(Teacher.period));
    Teacher.data = data;
    renderTeacher();
  }catch(e){
    if(root) root.innerHTML = '<div class="card empty-state"><b>教师端加载失败</b><br>' + esc(e.message) +
      '<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" data-action="retry-teacher">重试</button></div>';
    showApiError(e, '教师端加载失败');
  }finally{ Teacher.loading = false; }
}
function pct(rate, percent){
  if(percent != null) return percent;
  if(rate == null) return 0;
  return Math.round(rate * 100);
}
function renderTeacher(){
  var root = $('#teacher-root');
  var d = Teacher.data;
  if(!root || !d) return;
  var k = d.kpis || {};
  var ind = k.independence || {};
  var indepPercent = ind.percent || {independent:0, semi:0, dependent:0};
  var ip = [pct(null, indepPercent.independent), pct(null, indepPercent.semi), pct(null, indepPercent.dependent)];
  var cls = d.class || {};
  var completion = pct(k.completionRate, k.completionRatePercent);
  var unfinished = d.unfinishedList || [];
  var students = d.students || [];
  var queue = d.reviewQueue || [];
  var subtitle = $('#teacher-subtitle');
  if(subtitle) subtitle.textContent = (cls.name || '班级') + ' · ' + (cls.term || '') + ' · ' + (cls.size || k.total || '—') + ' 人 · 数据由 /api/teacher/dashboard 聚合，生成于 ' + fmtDate(d.generatedAt);
  function indepLabel(code){ return {independent:'独立', semi:'半独立', dependent:'依赖'}[code] || code || '—'; }
  root.innerHTML =
    '<div class="kpi-grid">' +
      '<div class="kpi"><div class="top"><span class="lbl">本周完成率</span><span class="tag tag-green">≥80% 目标</span></div><div class="num">' + completion + '%</div><div class="lbl">' + (k.finished || 0) + ' / ' + (k.total || 0) + ' 人完成必做</div></div>' +
      '<div class="kpi"><div class="top"><span class="lbl">未完成名单</span><span class="tag tag-red">需关注</span></div><div class="num">' + (k.unfinished != null ? k.unfinished : unfinished.length) + '</div><div class="lbl">其中 3 人连续 2 周未动</div></div>' +
      '<div class="kpi" title="同题口径：全部作答的 L1–L4 平均次数；提示次数高反映题目难度/卡点，不等于不认真。"><div class="top"><span class="lbl">平均提示轮数</span><span class="tag tag-blue">同题口径</span></div><div class="num">' + (k.avgHintRounds != null ? k.avgHintRounds : '—') + '</div><div class="sub">' + esc(k.avgHintRoundsBasis || '同题口径：全部作答的 L1–L4 平均次数') + '</div></div>' +
      '<div class="kpi"><div class="top"><span class="lbl">独立性分布（C1 三档）</span><span class="tag tag-green">过程指标</span></div>' +
        '<div class="stackbar">' +
          '<i class="s1" style="width:' + ip[0] + '%"></i><i class="s2" style="width:' + ip[1] + '%"></i><i class="s3" style="width:' + ip[2] + '%"></i>' +
        '</div><div class="indep-legend"><span class="lg"><i class="sw s1"></i><b>' + ip[0] + '%</b> 独立 · 仅 L0</span><span class="lg"><i class="sw s2"></i><b>' + ip[1] + '%</b> 半独立 · L1–L2</span><span class="lg"><i class="sw s3"></i><b>' + ip[2] + '%</b> 依赖 · L3–L4 或粘贴</span></div></div>' +
    '</div>' +
    '<div class="grid grid-2" style="margin-top:14px;align-items:start">' +
      '<div class="card"><div class="card-title"><h3>卡住的知识点 Top 5</h3><span class="tag">按卡点人数占比</span></div>' +
        '<p class="small muted" style="margin-bottom:12px">口径：同一知识点连续 2 轮无进展，或触发 L2 及以上提示。</p>' +
        '<div class="bars">' + (d.stuckTop5 || []).map(function(x){
          var p = x.percent != null ? x.percent : Math.round((x.count || 0));
          return '<div class="bar-row"><span class="bar-label">' + esc(x.kp) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Math.min(100, p) + '%"></div></div><span class="bar-val">' + p + '%</span></div>';
        }).join('') + '</div></div>' +
      '<div class="card"><div class="card-title"><h3>未完成名单</h3><span class="tag tag-red">' + unfinished.length + ' 人</span></div>' +
        '<div class="todo-list">' + (unfinished.length ? unfinished.slice(0, 6).map(function(x){
          return '<div class="todo-item"><span class="dot amber"></span><div><span class="who">' + esc(x.name || x.anonId) + '</span> · ' + esc(x.phase || '未开始') + ' · 最后活动 ' + esc(x.inactiveDays != null ? (x.inactiveDays + ' 天前') : fmtDate(x.lastActive)) + '</div><span class="tag">' + (x.inactiveWeeks >= 2 ? '连续 2 周' : '进行中') + '</span></div>';
        }).join('') : '<div class="empty-state">本周无未完成学生。</div>') + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-action="unfinished-all">查看全部 ' + unfinished.length + ' 人</button></div></div>' +
    '</div>' +
    '<div class="card" style="margin-top:14px"><div class="row-between" style="margin-bottom:8px"><h3>学生列表</h3><span class="small muted">点击任意一行 / 「过程摘要」查看 attempts + events</span></div>' +
      '<div class="table-wrap"><table class="table student-table"><thead><tr><th>学生</th><th>本周完成</th><th class="hide-sm">提示</th><th class="hide-sm">独立性</th><th>卡点</th><th></th></tr></thead><tbody>' +
      students.map(function(st){
        return '<tr data-action="open-student" data-id="' + esc(st.studentId) + '"><td><div class="stu-name">' + esc(st.name || st.anonId) + '</div><div class="stu-sub">' + esc(st.anonId || '') + ' · ' + esc(st.sid || '') + '</div></td>' +
          '<td>' + (st.finished != null ? st.finished : 0) + ' / 3</td><td class="hide-sm">' + (st.hints != null ? st.hints : '—') + '</td>' +
          '<td class="hide-sm"><span class="tag ' + (st.independence === 'independent' ? 'tag-green' : (st.independence === 'dependent' ? 'tag-red' : 'tag-amber')) + '">' + esc(st.independenceLabel || indepLabel(st.independence)) + '</span></td>' +
          '<td class="small">' + esc(st.stuckPoint || '—') + '</td><td><button class="btn btn-ghost btn-sm" data-action="open-student" data-id="' + esc(st.studentId) + '">过程摘要</button></td></tr>';
      }).join('') + '</tbody></table></div></div>' +
    '<div class="card" style="margin-top:14px"><div class="card-title"><h3>题库审核队列（只读）</h3><span class="tag">' + queue.length + ' 条</span></div>' +
      '<p class="small muted" style="margin-bottom:8px">当前契约只定义 read 接口（dashboard.reviewQueue），审核动作端点尚未定义；本 Demo 如实显示队列，不伪造通过/退回操作。</p>' +
      (queue.length ? queue.map(function(q){
        return '<div class="queue-item"><div class="queue-main"><div class="queue-title">' + esc(q.title || q.problemId) + '</div><div class="queue-meta">' + esc(q.chapter || '') + ' · 状态 ' + esc(q.status || 'pending') + ' · 提交人 ' + esc(q.submittedBy || '—') + '</div></div><span class="tag tag-'+ (q.status === 'pending' ? 'amber' : 'green') + '">' + esc(q.status === 'pending' ? '待审核' : q.status) + '</span><button class="btn btn-ghost btn-sm" data-action="queue-view" data-title="' + esc(q.title || q.problemId) + '">查看</button></div>';
      }).join('') : '<div class="empty-state">暂无待审核题目。</div>') + '</div>';
}
async function openStudentDetail(id){
  try{
    var d = await api('GET', '/api/teacher/students/' + encodeURIComponent(id));
    var s = d.student || {}, sum = d.summary || {}, ats = d.attempts || [], evs = d.events || [];
    var html = '<h3>过程摘要 · ' + esc(s.name || s.anonId) + '</h3>' +
      '<div class="drawer-head"><div class="drawer-ava">' + esc((s.name || '?').slice(0, 1)) + '</div><div><div class="stu-name">' + esc(s.name || s.anonId) + ' <span class="tag">' + esc(s.anonId || '') + '</span></div><div class="small muted">' + esc(s.className || '') + ' · ' + esc(s.sid || '') + '</div></div>' +
      '<span class="tag tag-blue">' + esc(independenceLabel(sum.independence)) + '</span></div>' +
      '<div class="grid grid-2" style="gap:8px">' +
        '<div class="feedback"><b class="small">本周完成</b><p>' + (sum.finished != null ? sum.finished : '—') + ' / 3</p></div>' +
        '<div class="feedback"><b class="small">平均提示轮数</b><p>' + (sum.avgHintRounds != null ? sum.avgHintRounds : '—') + '</p></div>' +
        '<div class="feedback"><b class="small">用时</b><p>' + (sum.timeOnTaskMin != null ? (sum.timeOnTaskMin + ' 分钟') : '—') + '</p></div>' +
        '<div class="feedback"><b class="small">记录 attempts</b><p>' + ats.length + ' 条</p></div>' +
      '</div>' +
      '<h4 style="margin-top:14px">作答记录</h4><div class="table-wrap"><table class="table compact"><thead><tr><th>题号</th><th>阶段</th><th>提示</th><th>覆盖</th><th>独立性</th><th>完成</th></tr></thead><tbody>' +
      (ats.length ? ats.map(function(a){
        return '<tr><td class="log-path">' + esc(a.problemId) + '</td><td>' + esc(a.phase || '') + ' / ' + esc(a.node || '') + '</td><td>' + (a.hints != null ? a.hints : '—') + '</td><td>' + (a.coverage != null ? a.coverage + '%' : '—') + '</td><td>' + esc(independenceLabel(a.independence)) + '</td><td>' + (a.finished ? '✓' : '进行中') + '</td></tr>';
      }).join('') : '<tr><td colspan="6">暂无作答记录</td></tr>') + '</tbody></table></div>' +
      '<h4 style="margin-top:14px">事件时间线（最近 ' + Math.min(evs.length, 12) + ' 条）</h4><ul class="timeline">' +
      (evs.length ? evs.slice(0, 12).map(function(ev){
        return '<li><b>' + fmtDate(ev.ts) + '</b> · ' + esc(ev.type) + (ev.level ? (' · ' + esc(ev.level)) : '') + ' <span class="muted">' + esc((ev.text || '').slice(0, 60)) + '</span></li>';
      }).join('') : '<li class="warn">暂无事件</li>') + '</ul>' +
      '<div class="redline-note"><b>说明</b><span>教师看过程：卡点、提示次数、拒绝、小白解释、是否独立；不展示 AI 参考证明。</span></div>';
    openModal(html, {wide:true});
  }catch(e){ showApiError(e, '加载学生详情失败'); }
}
async function exportCsv(){
  var started = Date.now();
  try{
    var res = await fetch('/api/teacher/export.csv');
    var ms = Date.now() - started;
    logRequest('GET', '/api/teacher/export.csv', res.status, ms, res.ok);
    if(!res.ok) throw new Error('导出失败 HTTP ' + res.status);
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = '证明陪练场_教师过程数据_匿名.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); if(a.parentNode) a.parentNode.removeChild(a); }, 1200);
    toast('已导出 CSV（11 列 · 默认匿名 · 含 BOM）');
  }catch(e){ showApiError(e, '导出 CSV 失败'); }
}

/* ================= 后端与数据面板 ================= */
async function refreshBackend(){
  await Promise.all([refreshHealth(true), refreshRoutes(), refreshStats(), refreshEvents()]);
  renderRequestLog();
}
async function refreshRoutes(){
  try{ var r = await api('GET', '/api/admin/routes', undefined, {noAuth:true}); Backend.routes = r; renderRoutes(); }catch(e){ Backend.routes = null; renderRoutes(); }
}
async function refreshStats(){
  try{ var s = await api('GET', '/api/admin/stats', undefined, {noAuth:true}); Backend.stats = s; renderGuard(); }catch(e){ Backend.stats = null; renderGuard(); }
}
async function refreshEvents(){
  try{
    var e = await api('GET', '/api/events?limit=50');
    Backend.events = e;
    renderEvents();
  }catch(err){
    if(err.status === 401){ Backend.events = null; renderEvents(); return; }
    Backend.events = null; renderEvents();
  }
}
function renderHealth(){
  var box = $('#health-card');
  if(!box) return;
  var h = App.health;
  if(!h){
    box.innerHTML = '<div class="card-title"><h3>后端健康</h3><span class="tag tag-red">离线</span></div><div class="empty-state">等待后端启动：<code>node server/server.mjs</code><br><button class="btn btn-ghost btn-sm" data-action="retry-boot" style="margin-top:8px">重试连接</button></div>';
    return;
  }
  var db = h.db || {};
  box.innerHTML = '<div class="card-title"><h3>后端健康</h3><span class="tag tag-green">ok</span><span class="tag">' + esc(h.mode || '') + '</span></div>' +
    '<div class="health-list">' +
      '<div><span class="hk">版本</span><span class="hv">' + esc(h.version || '—') + '</span></div>' +
      '<div><span class="hk">运行时长</span><span class="hv">' + (h.uptimeSec || 0) + ' 秒</span></div>' +
      '<div><span class="hk">学生</span><span class="hv">' + (db.students || 0) + '</span></div>' +
      '<div><span class="hk">题目</span><span class="hv">' + (db.problems || 0) + '</span></div>' +
      '<div><span class="hk">attempts</span><span class="hv">' + (db.attempts || 0) + '</span></div>' +
      '<div><span class="hk">events</span><span class="hv">' + (db.events || 0) + '</span></div>' +
    '</div>' +
    '<p class="small muted" style="margin-top:10px">GET /api/health · 真实后端返回；数据库落盘在 server/data/db.json。</p>';
}
function renderGuard(){
  var box = $('#guard-card');
  if(!box) return;
  var s = Backend.stats;
  if(!s){
    box.innerHTML = '<div class="card-title"><h3>guard 红线拦截</h3><span class="tag tag-red">离线</span></div><div class="empty-state">等待后端启动后读取 /api/admin/stats。</div>';
    return;
  }
  var g = s.guard || {};
  var byRule = g.byRule || {};
  box.innerHTML = '<div class="card-title"><h3>guard 红线拦截</h3><span class="tag tag-purple">服务端执行</span><span class="tag">' + esc(s.mode || '') + '</span></div>' +
    '<div class="guard-nums">' +
      '<div class="guard-num"><b>' + (g.checked || 0) + '</b><span>已检查输出</span></div>' +
      '<div class="guard-num"><b style="color:var(--red)">' + (g.blocked || 0) + '</b><span>已拦截</span></div>' +
      '<div class="guard-num"><b>' + Object.keys(byRule).length + '</b><span>命中规则种数</span></div>' +
    '</div>' +
    '<div class="rule-list">' + (Object.keys(byRule).length ? Object.keys(byRule).map(function(k){ return '<div class="rule-item"><span>' + esc(k) + '</span><b>' + byRule[k] + ' 次</b></div>'; }).join('') : '<div class="small muted">暂无拦截记录。可以试试在终稿里粘贴「证毕 / 综上 / 答案是」。</div>') + '</div>' +
    '<p class="small muted" style="margin-top:10px">POST /api/attempts/:id/final 的 guard 拦截会写入 leak_blocked 事件，并在这里计数。</p>';
}
function renderRoutes(){
  var box = $('#routes-table');
  if(!box) return;
  var routes = Backend.routes;
  if(!routes || !routes.length){ box.innerHTML = '<div class="empty-state">等待后端启动后读取 /api/admin/routes。</div>'; return; }
  box.innerHTML = '<div class="table-wrap"><table class="table compact"><thead><tr><th>方法</th><th>路径</th><th class="hide-sm">说明</th></tr></thead><tbody>' +
    routes.map(function(r){
      return '<tr><td><span class="tag ' + (r.method === 'GET' ? 'tag-blue' : 'tag-green') + '">' + esc(r.method) + '</span></td><td class="log-path">' + esc(r.path) + '</td><td class="hide-sm small">' + esc(r.desc || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function renderRequestLog(){
  var box = $('#reqlog-table');
  if(!box) return;
  var list = Backend.log.slice();
  if(Backend.onlyErrors) list = list.filter(function(x){ return !x.ok; });
  if(!list.length){ box.innerHTML = '<div class="empty-state">还没有请求记录：切到「学生端」点一个按钮，或切到「教师端」加载看板。</div>'; return; }
  box.innerHTML = '<table class="log-table"><thead><tr><th>时间</th><th>方法</th><th>路径</th><th>状态</th><th>耗时</th></tr></thead><tbody>' +
    list.slice(0, 80).map(function(x){
      var status = x.status;
      var cls = status === 'ERR' || status >= 500 ? 'status-ERR' : (status >= 400 ? 'status-4xx' : 'status-2xx');
      return '<tr class="log-row' + (x.ok ? '' : ' err') + '"><td class="mono">' + (x.ts ? x.ts.toLocaleTimeString('zh-CN', {hour12:false}) : '') + '</td><td class="mono">' + esc(x.method) + '</td><td class="log-path">' + esc(x.path) + '</td><td class="' + cls + '">' + esc(status) + '</td><td class="mono">' + (x.ms != null ? (x.ms + 'ms') : '—') + '</td></tr>';
    }).join('') + '</tbody></table>';
}
function renderEvents(){
  var box = $('#events-list');
  if(!box) return;
  var data = Backend.events;
  var count = $('#events-count');
  if(!data){ box.innerHTML = '<div class="empty-state">等待后端启动后读取 /api/events（需要登录 token）。</div>'; if(count) count.textContent = '—'; return; }
  var items = data.items || [];
  if(count) count.textContent = (data.total != null ? data.total : items.length) + ' 条';
  if(!items.length){ box.innerHTML = '<div class="empty-state">暂无事件：去学生端点一次「提交这一步」。</div>'; return; }
  box.innerHTML = items.map(function(ev){
    var meta = '';
    if(ev.level) meta += '<span class="tag tag-blue">' + esc(ev.level) + '</span>';
    if(ev.durationMs != null) meta += '<span class="tag">' + ev.durationMs + 'ms</span>';
    return '<div class="event-item"><div class="event-top"><span class="event-type">' + esc(ev.type) + '</span>' + meta + '<span class="event-ts">' + fmtDate(ev.ts) + '</span></div>' +
      '<div class="event-text">' + esc((ev.text || '').slice(0, 160)) + (ev.meta && Object.keys(ev.meta).length ? '<span class="small muted"> · meta: ' + esc(JSON.stringify(ev.meta).slice(0, 120)) + '</span>' : '') + '</div></div>';
  }).join('');
}
function openResetModal(){
  openModal('<h3>重置演示数据？</h3><p class="small muted">会调用 POST /api/admin/reset：重新 seed 36 名学生 / 12 道题 / 60 条 attempt，并清空 guard 统计。当前作答 attempt 会被清空，页面随后刷新。</p>' +
    '<div class="redline-note"><b>注意</b><span>token 仍在内存中有效；演示学生的作答不会进入班级统计。</span></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-danger" data-action="confirm-reset">确认重置</button></div>');
}
async function doReset(){
  try{
    await api('POST', '/api/admin/reset', {}, {noAuth:true});
    St.attemptId = null; St.state = null; St.attempt = null; St.messages = []; St.coverage = null; St.review = null; St.mastery = null; St.variant = null;
    try{ localStorage.removeItem(LS.attempt); }catch(e){}
    if(modalClose) modalClose();
    toast('已重置种子数据，页面即将刷新');
    setTimeout(function(){ location.reload(); }, 900);
  }catch(e){ showApiError(e, '重置失败'); }
}

/* ================= 事件绑定 / 动作分发 ================= */
function bindStatic(){
  $$('.tab-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var tab = b.getAttribute('data-tab');
      if(location.hash !== '#/' + tab){ location.hash = '#/' + tab; }
      setTab(tab, false);
    });
  });
  var logoutBtn = $('#btn-logout');
  if(logoutBtn) logoutBtn.addEventListener('click', logout);
  $$('#period-switch .seg-btn').forEach(function(b){
    b.addEventListener('click', function(){
      $$('#period-switch .seg-btn').forEach(function(x){ x.classList.toggle('active', x === b); });
      Teacher.data = null;
      loadTeacher(b.getAttribute('data-period'));
    });
  });
  var logFilter = $('#log-only-errors');
  if(logFilter) logFilter.addEventListener('change', function(){ Backend.onlyErrors = logFilter.checked; renderRequestLog(); });
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-action]');
    if(!el) return;
    var action = el.getAttribute('data-action');
    handleAction(action, el);
  });
}
function handleAction(action, el){
  var id = el.getAttribute('data-id');
  var level = el.getAttribute('data-level');
  switch(action){
    case 'retry-boot': retryBoot(); break;
    case 'login': doLogin(false); break;
    case 'demo-login': doLogin(true); break;
    case 'logout': logout(); break;
    case 'goto-s2': gotoProblems(); break;
    case 'goto-s1': case 'back-home': St.screen = 'S1'; renderStudent(); break;
    case 'refresh-home': loadHomeAndRestore(false); break;
    case 'resume-attempt': resumeAttempt(id); break;
    case 'start-problem': startProblem(id); break;
    case 'preview-problem': previewProblem(id); break;
    case 'filter': setFilter(el.getAttribute('data-key'), el.getAttribute('data-value')); break;
    case 'reset-filters': St.filters = {chapter:'', kp:'', difficulty:'', type:''}; loadProblems(false); break;
    case 'fill-sample': fillSample(el); break;
    case 'submit-step': submitStep(); break;
    case 'open-hints': openHintModal(); break;
    case 'use-hint': useHint(level); break;
    case 'ask-answer': askAnswer(); break;
    case 'choose-alt': chooseAlternative(id); break;
    case 'xiaobai': showXiaobai(); break;
    case 'open-def': openDefModal(); break;
    case 'soft-option': softOption(id); break;
    case 'soft-easier': openModal('<h3>换一道同知识点更小题（只给题面）</h3><p class="small muted">不占原题提示预算；换题只给题面。</p><div class="variant-stem" style="margin:10px 0">判断级数 ∑<sub>n=1</sub><sup>∞</sup> (−1)<sup>n−1</sup>/n 的收敛性；若收敛，是条件收敛还是绝对收敛？</div><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>返回原题</button></div>'); break;
    case 'soft-teacher': toast('已生成教师工单（Demo 展示出口；契约未定义持久化端点）', 'warn'); break;
    case 'fill-final': var f = $('#final-draft'); if(f){ f.value = FINAL_SAMPLE; toast('已填入学生示例终稿（演示用，非 AI 生成）'); } break;
    case 'submit-final': submitFinal(); break;
    case 'focus-review': var rc = $('#review-card'); if(rc){ rc.scrollIntoView({behavior:'smooth', block:'start'}); toast('五问复盘卡在右侧：用你自己的证明回答'); } break;
    case 'fill-review': prefillReviewExamples(); toast('已填入示例答案，可修改'); break;
    case 'submit-review': submitReview(); break;
    case 'fill-rules': var ru = $('#rules-input'); if(ru){ ru.value = '交错级数先逐条核对莱布尼茨三个条件\n条件收敛要补证绝对值级数发散\np 级数先看 p 与 1 的大小'; toast('已填入示例规律'); } break;
    case 'save-rules': saveLocal('rules', '#rules-input', LS.rules + (St.attemptId || 'demo')); break;
    case 'fill-check': var ck = $('#check-input'); if(ck){ ck.value = '先判断要证几件事 → 再选判别法 → 逐条核条件 → 写清结论（条件收敛 / 绝对收敛）'; toast('已填入示例自检卡'); } break;
    case 'save-check': saveLocal('check', '#check-input', LS.check + (St.attemptId || 'demo')); break;
    case 'fill-variant': var vi = $('#variant-input'); if(vi){ vi.value = '∑1/n² 是 p=2 的 p 级数，p>1 所以收敛，因此原级数绝对收敛。'; toast('已填入示例作答'); } break;
    case 'submit-variant': submitVariant(); break;
    case 'retest-info': openModal('<h3>复测安排</h3><p class="small muted">复测检验方法是否留下，不是重考原题；数据会进入教师端前后测。</p><div class="retest" style="margin-top:12px"><div class="retest-item"><b>7 天后 · 小复测</b><span class="muted">重做 p 级数判别 1 题。</span></div><div class="retest-item"><b>30 天后 · 大复测</b><span class="muted">条件收敛 + 绝对收敛混合 2 题。</span></div></div><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>知道了</button></div>'); break;
    case 'retry-teacher': Teacher.data = null; loadTeacher(Teacher.period); break;
    case 'open-student': openStudentDetail(id); break;
    case 'unfinished-all': showUnfinishedAll(); break;
    case 'export-csv': exportCsv(); break;
    case 'queue-view': openModal('<h3>审核队列 · ' + esc(el.getAttribute('data-title') || '') + '</h3><p class="small muted">当前契约只定义 read 接口（dashboard.reviewQueue），未定义审核动作端点；本 Demo 不伪造「通过/退回」持久化。</p><p class="small muted" style="margin-top:8px">建议后端补 POST /api/teacher/review/:problemId 后再开放按钮。</p><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>知道了</button></div>'); break;
    case 'retry-teacher': Teacher.data = null; loadTeacher(Teacher.period); break;
    case 'refresh-backend': refreshMeta(); refreshHealth(); refreshBackend(); toast('正在刷新后端数据'); break;
    case 'refresh-events': refreshEvents(); toast('事件流已刷新'); break;
    case 'clear-log': Backend.log = []; renderRequestLog(); toast('请求日志已清空'); break;
    case 'open-reset': openResetModal(); break;
    case 'confirm-reset': doReset(); break;
    default: toast('未识别的操作：' + action);
  }
}
function previewProblem(id){
  var p = null;
  for(var i = 0; i < St.problems.length; i++){ if(St.problems[i].id === id){ p = St.problems[i]; break; } }
  if(!p){ toast('题目未加载'); return; }
  openModal('<h3>' + esc(problemTitle(p)) + '</h3><div class="variant-stem" style="margin:10px 0">' + formatMath(p.stem || '') + '</div>' +
    '<p class="small muted">' + esc(p.chapter || '') + ' · ' + esc((p.kp || []).join(' / ')) + ' · 预计 ' + (p.estimatedMin || '—') + ' 分钟</p>' +
    '<p class="small muted" style="margin-top:8px">这道题暂未开放完整脚本（Demo 只完整开放第 1 题）；题面通过 GET /api/problems/:id 白名单下发，不含关键步骤 / 提示 / 参考证明。</p>' +
    '<div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>知道了</button></div>');
}
function setFilter(key, value){
  St.filters = St.filters || {};
  St.filters[key] = value || '';
  loadProblems(false);
}
function fillSample(el){
  var sample = el.getAttribute('data-sample') || '';
  var ta = $('#student-input');
  if(ta){ ta.value = sample; ta.focus(); toast('已填入示例作答，可修改后提交'); }
}
function saveLocal(kind, sel, key){
  var ta = $(sel);
  if(!ta) return;
  try{ localStorage.setItem(key, ta.value); toast((kind === 'rules' ? '规律' : '自检卡') + '已保存到本机（Demo 未落库）'); }catch(e){ toast('本地保存失败', 'err'); }
}
async function submitVariant(){
  var ta = $('#variant-input');
  var answer = ta ? (ta.value || '').trim() : '';
  if(!answer){ toast('先写下你的答案和依据', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/variant', {answer:answer});
    St.variant = {variant:data.variant, result:data.result, state:data.state};
    if(data.state) St.state = data.state;
    if(St.attempt){ St.attempt.variantResult = data.result; St.attempt.finishedAt = new Date().toISOString(); }
    St.screen = 'S5';
    saveSession();
    renderStudent();
    toast(data.result && data.result.correct ? '变式题正确 · attempt 已结束' : '变式题已提交 · attempt 已结束', data.result && data.result.correct ? '' : 'warn');
  }catch(e){
    if(e.code === 'WRONG_PHASE'){ toast('先把五问复盘做完，变式题才会开放', 'warn'); return; }
    showApiError(e, '提交变式题失败');
  }
}
function showUnfinishedAll(){
  var d = Teacher.data || {};
  var list = d.unfinishedList || [];
  openModal('<h3>未完成名单（' + list.length + ' 人）</h3><p class="small muted">数据来自 dashboard.unfinishedList；演示学生不计入班级统计。</p>' +
    '<div class="todo-list" style="margin-top:10px">' + list.map(function(x){
      return '<div class="todo-item"><span class="dot amber"></span><div><span class="who">' + esc(x.name || x.anonId) + '</span> · ' + esc(x.phase || '未开始') + ' · 最后活动 ' + esc(x.inactiveDays != null ? (x.inactiveDays + ' 天前') : fmtDate(x.lastActive)) + '</div></div>';
    }).join('') + '</div><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>关闭</button></div>');
}

/* ================= 启动 ================= */
async function retryBoot(){
  await refreshMeta();
  var h = await refreshHealth();
  if(!h) return;
  if(App.token){ await loadHomeAndRestore(true); }
  else if(new URLSearchParams(location.search).get('demo') === '1'){ await doLogin(true); }
  else { St.screen = 'S0'; renderStudent(); }
  setTab(App.tab || parseHash(), false);
  toast('后端已连接');
}
async function boot(){
  loadSession();
  bindStatic();
  refreshUserChip();
  renderStudent();
  await Promise.all([refreshMeta(), refreshHealth(true)]);
  var demoTab = new URLSearchParams(location.search).get('demo') === '1';
  if(App.token){
    await loadHomeAndRestore(true);
  }else if(demoTab){
    await doLogin(true);
  }else{
    St.screen = 'S0';
    renderStudent();
  }
  setTab(parseHash(), false);
  setInterval(function(){
    if(App.tab !== 'backend') return;
    refreshHealth(true); refreshStats(); refreshEvents();
  }, 5000);
  window.__demoApp = { App:App, St:St, Teacher:Teacher, Backend:Backend, setTab:setTab, doLogin:doLogin, startProblem:startProblem, api:api, refreshBackend:refreshBackend };
}
document.addEventListener('DOMContentLoaded', boot);

})();
