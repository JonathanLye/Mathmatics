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
  if(screen === 'S4' || screen === 'S5'){ St.screen = St.state ? 'S3' : 'S1'; return renderStudent(); }
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
          '<div class="mini-item"><span class="mini-num">2</span><div><b>六层引导：知识点 / 解析 / 步骤 / 讲解 / 同类题 / 总结</b><br><span class="muted small">每层一个显眼的大提交按钮；AI 反馈在右侧常驻教练面板。</span></div></div>' +
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
        '<p class="small muted">' + (cont ? ('第 ' + (cont.layer || 1) + ' 层 · ' + esc(((({1:'前置知识点',2:'题目解析',3:'详细步骤',4:'完整讲解',5:'同类题',6:'总结'})[cont.layer || 1]) || '六层引导'))) : '直接从选题开始一道题。') + '</p>' +
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

/* ================= 学生端：六层引导工作台（v2） ================= */
function stopTimer(){ if(St && St.timerId){ clearInterval(St.timerId); St.timerId = null; } }
var LAYERS = [
  {n:1, name:'前置知识点', sub:'专业 + 高中', task:'先核对定义，再写你的理解'},
  {n:2, name:'题目解析', sub:'你拆，AI 查漏', task:'把题目拆成四栏，AI 逐项查漏'},
  {n:3, name:'详细步骤', sub:'一步一依据', task:'一步写「结论/操作 + 依据」'},
  {n:4, name:'完整讲解', sub:'你讲，AI 核对', task:'像给同学讲题一样讲一遍'},
  {n:5, name:'同类题', sub:'换题再做', task:'同知识点、不同题面，独立做'},
  {n:6, name:'总结', sub:'知识点 / 重难点 / 步骤', task:'用自己的话写三栏总结'}
];
var LAYER_FALLBACK = {
  1:{instruction:'先别急着写证明。你记得「条件收敛」和「莱布尼茨判别法」吗？先选一个。', placeholder:'用自己的话说：条件收敛和收敛有什么区别？', submitLabel:'提交我的理解'},
  2:{instruction:'把这道题拆成四栏：要证什么、要证几件事、关键词与量词、可能用到的知识点。', placeholder:'', submitLabel:'提交解析'},
  3:{instruction:'现在写第 1 步：先证单调递减。写「结论/操作 + 依据」，然后点提交。', placeholder:'', submitLabel:'提交这一步'},
  4:{instruction:'完整讲解由你完成，AI 只核对缺口，不提供标准讲解。说到目标、结构、关键步骤、依据、结论。', placeholder:'像给同学讲题一样，把整道题讲一遍…', submitLabel:'提交完整讲解'},
  5:{instruction:'换一道同知识点、不同题面的题，独立写出答案或关键步骤。', placeholder:'写出你的答案 / 关键步骤…', submitLabel:'提交变式题'},
  6:{instruction:'最后一步：用你自己的话写知识点、重难点、下次的解题步骤。', placeholder:'', submitLabel:'提交总结'}
};
var CONCEPT_FALLBACK = {professional:'若级数 ∑a_n 收敛，而绝对值级数 ∑|a_n| 发散，则称 ∑a_n 条件收敛。', plain:'原级数能收敛，但把每项都变成正数后就不收敛了。', checkQuestion:'条件收敛与收敛的区别是什么？'};

function layerMeta(n){
  for(var i=0;i<LAYERS.length;i++){ if(LAYERS[i].n === n) return LAYERS[i]; }
  return LAYERS[0];
}
function currentLayer(){ return (St.state && St.state.layer) || 1; }
function guidanceOf(n){
  var st = St.state || {};
  if(n === currentLayer() && st.guidance && st.guidance.instruction) return st.guidance;
  return LAYER_FALLBACK[n] || LAYER_FALLBACK[1];
}
function ensureUi(){
  if(!St.ui) St.ui = {};
  if(St.ui.lastAttempt !== St.attemptId){
    St.ui = {
      lastAttempt: St.attemptId,
      knowledgeTab:'professional',
      showPlain:false,
      feedback:null,
      proactive:null,
      coachError:null,
      softLanding:null,
      knowledgeLoading:false,
      variantLoading:false
    };
  }
}
function layerStatusOf(n){
  var ls = (St.state && St.state.layerStatus) || {};
  if(ls[n]) return ls[n];
  var cur = currentLayer();
  return n < cur ? 'done' : (n === cur ? 'active' : 'locked');
}
function mergeState(part){
  if(!part) return;
  if(!St.state){ St.state = part; return; }
  Object.keys(part).forEach(function(k){ St.state[k] = part[k]; });
}
function screenForAttempt(payload){
  if(!payload || (!payload.state && !payload.attempt)) return 'S1';
  return 'S3';
}
function applyAttemptPayload(payload){
  St.attemptId = payload.attemptId || (payload.attempt && payload.attempt.attemptId) || St.attemptId;
  St.attempt = payload.attempt || St.attempt || {};
  St.problem = payload.problem || St.problem || {};
  St.state = payload.state || St.state || {};
  St.coverage = St.state.coverage || (St.attempt && St.attempt.coverage) || null;
  St.mastery = (St.attempt && St.attempt.mastery) || (St.state && St.state.mastery) || null;
  ensureUi();
  if(St.state && St.state.proactive) St.ui.proactive = St.state.proactive;
  St.screen = 'S3';
  saveSession();
  renderStudent();
}
async function startProblem(problemId){
  try{
    var data = await api('POST', '/api/attempts', {problemId:problemId});
    St.attemptId = data.attemptId;
    ensureUi();
    St.ui.lastAttempt = null;
    var full = await api('GET', '/api/attempts/' + encodeURIComponent(data.attemptId));
    applyAttemptPayload(full);
    toast('已进入六层引导 · 第 ' + currentLayer() + ' 层');
  }catch(e){
    if(e.status === 409){ toast(e.message || '当前题目暂未开放完整引导', 'warn'); return; }
    showApiError(e, '开始作答失败');
  }
}
async function resumeAttempt(id){
  if(!id && St.attemptId) id = St.attemptId;
  if(!id) return startProblem('p-cond-series');
  try{
    var full = await api('GET', '/api/attempts/' + encodeURIComponent(id));
    applyAttemptPayload(full);
    toast('已恢复到第 ' + currentLayer() + ' 层');
  }catch(e){ showApiError(e, '恢复作答失败'); }
}
function syncFromResponse(data){
  if(data && data.state) mergeState(data.state);
  if(data && data.coverage){ St.coverage = data.coverage; if(St.state) St.state.coverage = data.coverage; }
  if(data && data.passed != null && St.state) St.state.passed = data.passed;
  if(data && data.mastery != null){ St.mastery = data.mastery; if(St.state) St.state.mastery = data.mastery; }
  if(data && data.independence && St.state) St.state.independence = data.independence;
  if(data && data.attempt) St.attempt = data.attempt;
  if(St.attempt && data && data.state){ if(data.state.finishedAt) St.attempt.finishedAt = data.state.finishedAt; }
  saveSession();
}

/* ---------- v2 页面：题目卡 + 六层 stepper + 60/40 工作台 ---------- */
function renderS3(root){
  var state = St.state || {};
  ensureUi();
  var problem = St.problem || {};
  var layer = currentLayer();
  var guidance = guidanceOf(layer);
  var finished = !!(state.finishedAt || (St.attempt && St.attempt.finishedAt));
  var stepName = layerMeta(layer).name;
  root.innerHTML =
    '<div class="breadcrumb"><span>S2 选题</span><span class="sep">›</span><strong>S3 六层引导工作台</strong><span class="sep">·</span><span>' + esc(problemTitle(problem)) + '</span>' +
      '<button class="lesson-link" data-action="back-home">保存并返回今日任务</button></div>' +
    '<div class="card v2-problem"><div class="row-between" style="align-items:flex-start;gap:12px;flex-wrap:wrap">' +
      '<div><div class="eyebrow">当前题目 · 六层引导</div><h2 style="font-size:20px;margin:4px 0 2px">' + esc(problemTitle(problem)) + '</h2>' +
      '<p class="small muted">' + esc(problem.chapter || '') + ' · ' + esc((problem.kp || []).join(' / ')) + ' · 预计 ' + (problem.estimatedMin || '—') + ' 分钟</p></div>' +
      '<div class="row"><span class="tag tag-blue">六层全部显式可见</span><span class="tag ' + (finished ? 'tag-green' : 'tag-amber') + '">' + (finished ? '已完成' : ('当前第 ' + layer + ' 层')) + '</span></div></div>' +
      '<div class="stem-box v2-stem">' + formatMath(problem.stem || '题目加载中…') + '<span class="stem-note">每一步都由你写；AI 只给最小提示，不给完整证明/最终答案。</span></div>' +
      stepperHtml() +
    '</div>' +
    '<div class="workbench">' +
      '<div class="workbench-main">' + layerPanelHtml(layer, guidance) + '</div>' +
      '<div class="workbench-side">' + coachHtml(layer, guidance) + '</div>' +
    '</div>';
  if(layer === 1) autoKnowledgeHint();
  if(layer === 5) ensureVariantLoaded();
  window.scrollTo(0, 0);
}
function stepperHtml(){
  var cur = currentLayer();
  return '<div class="stepper-wrap"><div class="stepper">' + LAYERS.map(function(l){
    var st = layerStatusOf(l.n);
    var cls = st === 'done' ? 'done' : (l.n === cur ? 'active' : 'locked');
    var icon = st === 'done' ? '✓' : (l.n === cur ? '▶' : l.n);
    return '<button class="stepper-step ' + cls + '" data-action="jump-layer" data-layer="' + l.n + '" title="' + esc(l.name) + '">' +
      '<span class="stepper-icon">' + icon + '</span><span class="stepper-name">' + esc(l.name) + '</span><span class="stepper-sub">' + esc(l.sub) + '</span></button>';
  }).join('') + '</div><p class="small muted stepper-tip">六层按顺序完成；当前层高亮，完成打勾。提交按钮在左侧输入区正下方。</p></div>';
}
function layerPanelHtml(layer, guidance){
  var head = '<div class="layer-head"><div><div class="eyebrow">六层引导 · 当前任务</div>' +
    '<h3>' + esc(guidance.title || ('第 ' + layer + ' 层 · ' + layerMeta(layer).name)) + '</h3>' +
    '<p class="small muted">' + esc(layerMeta(layer).task) + '</p></div>' +
    '<span class="layer-badge">' + (layerStatusOf(layer) === 'done' ? '已完成' : '进行中') + '</span></div>';
  if(layer === 1) return '<div class="card layer-card">' + head + layer1Html(guidance) + '</div>';
  if(layer === 2) return '<div class="card layer-card">' + head + layer2Html(guidance) + '</div>';
  if(layer === 3) return '<div class="card layer-card">' + head + layer3Html(guidance) + '</div>';
  if(layer === 4) return '<div class="card layer-card">' + head + layer4Html(guidance) + '</div>';
  if(layer === 5) return '<div class="card layer-card">' + head + layer5Html(guidance) + '</div>';
  return '<div class="card layer-card">' + head + layer6Html(guidance) + '</div>';
}
function layerRecord(label, body){
  return '<div class="record"><div class="record-title">' + esc(label) + '</div>' + body + '</div>';
}
function feedbackList(list){
  if(!list || !list.length) return '';
  var LABELS = {knowledge:'我学到的知识点', difficulty:'最容易错的重难点', steps:'下次的解题步骤', keywords:'关键词校正', goal:'要证什么', parts:'要证几件事', keywords_text:'关键词与量词', tools:'可能用到的知识点', structure:'结构'};
  return '<div class="check-list">' + list.map(function(f){
    var ok = f.status === 'ok' || f.status === 'pass' || f.passed === true;
    var icon = ok ? '✓' : '○';
    var cls = ok ? 'ok' : 'need';
    var key = f.criterion || f.field || '';
    return '<div class="check-item ' + cls + '"><span class="check-icon">' + icon + '</span><div><b>' + esc(LABELS[key] || key) + '</b>' +
      (f.message ? '<span>' + formatMath(f.message) + '</span>' : '') + '</div></div>';
  }).join('') + '</div>';
}
function submitBar(label, action){
  return '<div class="submit-bar"><button class="btn btn-primary btn-lg" data-action="' + action + '">' + esc(label) + '</button>' +
    '<p class="small muted">提交后 AI 教练在右侧给反馈；这里不会显示你的最终答案。</p></div>';
}
function layer1Html(guidance){
  var k = (St.state && St.state.knowledge) || {};
  var tab = St.ui.knowledgeTab || 'professional';
  var hasCard = !!k.requested && !!(k.professional || k.plain);
  var cardHtml = '';
  if(hasCard){
    cardHtml = '<div class="knowledge-card"><div class="tabs-row"><button class="tab-pill' + (tab === 'professional' ? ' active' : '') + '" data-action="knowledge-tab" data-tab="professional">专业知识点</button>' +
      '<button class="tab-pill' + (tab === 'plain' ? ' active' : '') + '" data-action="knowledge-tab" data-tab="plain">高中水平解读</button></div>' +
      '<div class="knowledge-body">' + formatMath(tab === 'plain' ? (k.plain || '') : (k.professional || '')) + '</div>' +
      (k.checkQuestion ? '<p class="small muted" style="margin-top:6px">核对问题：' + formatMath(k.checkQuestion) + '</p>' : '') + '</div>';
  }
  var choice = '<div class="choice-row"><button class="btn btn-soft btn-sm" data-action="focus-answer">我记得，直接核对</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="request-knowledge" data-tab="professional">我忘了，看知识点卡</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="request-knowledge" data-tab="plain">完全没学过，只看高中版</button></div>';
  var rec = (k.answer ? layerRecord('我的记录 · 已提交理解', '<div class="record-line">' + formatMath(k.answer) + '</div>' +
    '<div class="small ' + (k.passed ? 'ok-text' : 'warn-text') + '">' + (k.passed ? '✓ 通过' : '○ 待补') + ' ' + esc(k.feedback || '') + '</div>') : '');
  return choice + cardHtml +
    '<div class="input-block"><label for="k-answer">' + esc(guidance.placeholder || LAYER_FALLBACK[1].placeholder) + '</label>' +
    '<textarea id="k-answer" class="ta ta-lg" placeholder="只用你自己的话，不用背原文…">' + esc(k.answer || '') + '</textarea></div>' +
    submitBar(guidance.submitLabel || '提交我的理解', 'submit-knowledge') + rec;
}
function layer2Html(guidance){
  var p = (St.state && St.state.parse) || {};
  var plain = p.plainRestatement || '';
  var rec = (p.passed ? layerRecord('我的记录 · 已提交解析', '<div class="small ok-text">✓ 通过：' + esc((p.feedback && p.feedback[0] && p.feedback[0].message) || '四栏齐全') + '</div>') : '');
  return '<div class="parse-grid">' +
    '<label>要证什么<textarea id="p-goal" class="ta" placeholder="例如：判断原级数收敛……">' + esc(p.goal || '') + '</textarea></label>' +
    '<label>要证几件事<textarea id="p-parts" class="ta" placeholder="例如：两件：先证收敛，再证不绝对收敛">' + esc(p.parts || '') + '</textarea></label>' +
    '<label>关键词与量词<textarea id="p-keywords" class="ta" placeholder="例如：交错级数、(−1)^(n−1)、n→∞">' + esc(p.keywords || '') + '</textarea></label>' +
    '<label>可能用到的知识点<textarea id="p-tools" class="ta" placeholder="例如：莱布尼茨判别法、p 级数">' + esc(p.tools || '') + '</textarea></label>' +
    '</div>' +
    (plain ? '<div class="plain-box"><b>高中版题意（只换说法，不给解法）</b><p>' + formatMath(plain) + '</p></div>' : '<button class="btn btn-ghost btn-sm" data-action="show-plain">看高中版题意（只换说法）</button>') +
    feedbackList(p.feedback) +
    submitBar(guidance.submitLabel || '提交解析', 'submit-parse') + rec;
}
function stepStatusLabel(s){
  return {passed:'通过', ok:'通过', revision:'待改', needs_work:'待改', editing:'编辑中', marked:'被标疑点', suspect:'被标疑点'}[s] || (s || '待提交');
}
function layer3Html(guidance){
  var steps = (St.state && St.state.steps) || [];
  var cov = (St.state && St.state.coverage) || null;
  var list = steps.length ? '<div class="proof-list">' + steps.map(function(st){
    var status = stepStatusLabel(st.status);
    var cls = (st.status === 'passed' || st.status === 'ok') ? 'ok' : (st.status === 'revision' || st.status === 'marked' || st.status === 'needs_work' ? 'need' : '');
    return '<div class="proof-item ' + cls + '"><div class="proof-head"><span class="proof-no">第 ' + (st.no || '') + ' 步</span><span class="proof-status">' + esc(status) + '</span></div>' +
      (st.conclusion ? '<div><b>结论/操作：</b>' + formatMath(st.conclusion) + '</div>' : '') +
      (st.evidence ? '<div><b>依据：</b>' + formatMath(st.evidence) + '</div>' : '') +
      (st.feedback ? '<div class="small muted">AI：' + formatMath(st.feedback) + '</div>' : '') + '</div>';
  }).join('') + '</div>' : '<div class="empty-state">还没有步骤。写下第 1 步：结论/操作 + 依据，然后点下面的大按钮。</div>';
  var coverage = cov && (cov.total || cov.covered != null) ? '<div class="coverage-line"><b>覆盖度：' + (cov.covered || 0) + ' / ' + (cov.total || 5) + '（' + (cov.percent || 0) + '%）</b>' +
    (cov.passed ? '<span class="tag tag-green">已达标</span>' : '<span class="tag tag-amber">未到 80%</span>') + '</div>' : '';
  var finishedBtn = steps.length ? '<div class="finish-row"><button class="btn btn-green" data-action="finish-steps">写完了 · 进入第 4 层</button><span class="small muted">覆盖 ≥80% 才能进入完整讲解</span></div>' : '';
  return '<div class="step-guide">' + esc(guidance.instruction || LAYER_FALLBACK[3].instruction) + '</div>' +
    '<div class="step-inputs"><label>结论 / 操作<textarea id="s-conclusion" class="ta" placeholder="例如：证明 {u_n} 单调递减"></textarea></label>' +
    '<label>依据<textarea id="s-evidence" class="ta" placeholder="例如：因为 n+1 > n，所以 1/√(n+1) < 1/√n"></textarea></label></div>' +
    '<div class="submit-bar"><button class="btn btn-primary btn-lg" data-action="submit-step">提交这一步</button><p class="small muted">提交后 AI 只指出第一处可疑，不整题判分。</p></div>' +
    '<div class="record"><div class="record-title">我的证明（已提交步骤）</div>' + list + '</div>' + coverage + finishedBtn;
}
function layer4Html(guidance){
  var ex = (St.state && St.state.explanation) || {};
  var rec = ex.text ? layerRecord('我的记录 · 已提交讲解', '<div class="record-line">' + formatMath(ex.text) + '</div>' +
    (ex.passed ? '<div class="small ok-text">✓ 通过</div>' : '')) : '';
  return '<div class="redline-soft"><b>说明：</b>完整讲解由你完成，AI 只核对缺口，不提供标准讲解。</div>' +
    '<div class="input-block"><label for="e-text">' + esc(guidance.placeholder || LAYER_FALLBACK[4].placeholder) + '</label>' +
    '<textarea id="e-text" class="ta ta-xl" placeholder="要证什么 → 分几段 → 每段依据 → 结论">' + esc(ex.text || '') + '</textarea></div>' +
    '<div class="checklist-title">五项 checklist（AI 只核对这五项）</div>' + feedbackList(ex.feedback) +
    submitBar(guidance.submitLabel || '提交完整讲解', 'submit-explain') + rec;
}
function layer5Html(guidance){
  var v = (St.state && St.state.variant) || {};
  var result = v.result || null;
  var stem = v.stem || (St.ui && St.ui.variantStem) || '正在向后端读取变式题…';
  var rec = v.answer ? layerRecord('我的记录 · 已提交变式题', '<div class="record-line">' + formatMath(v.answer) + '</div>' +
    (result ? '<div class="small ' + (result.correct ? 'ok-text' : 'warn-text') + '">' + (result.correct ? '✓ 正确' : '○ 再想想') + '：' + formatMath(result.feedback || '') + '</div>' : '')) : '';
  return '<div class="variant-box"><div class="small muted">同知识点、不同题面 · 只给题面，不给提示</div><div class="variant-stem">' + formatMath(stem) + '</div></div>' +
    '<div class="input-block"><label for="v-answer">' + esc(guidance.placeholder || LAYER_FALLBACK[5].placeholder) + '</label>' +
    '<textarea id="v-answer" class="ta ta-lg" placeholder="写出你的答案和关键步骤…">' + esc(v.answer || '') + '</textarea></div>' +
    submitBar(guidance.submitLabel || '提交变式题', 'submit-variant') + rec;
}
function layer6Html(guidance){
  var sm = (St.state && St.state.summary) || {};
  var card = sm.card || null;
  var mastery = (St.state && St.state.mastery);
  var finished = !!(St.state && St.state.finishedAt);
  var rec = (sm.knowledge || sm.difficulty || sm.steps) ? layerRecord('我的记录 · 已提交总结', feedbackList(sm.feedback) +
    (card ? '<div class="summary-card"><b>' + esc(typeof card === 'string' ? '你的总结卡' : (card.title || '你的总结卡')) + '</b><p>' + formatMath(typeof card === 'string' ? card : (card.items && card.items.length ? card.items.join('\n') : (card.text || [card.knowledge ? ('知识点：' + card.knowledge) : '', card.difficulty ? ('重难点：' + card.difficulty) : '', card.steps ? ('步骤：' + card.steps) : ''].filter(Boolean).join('\n')))) + '</p></div>' : '')) : '';
  var done = finished ? '<div class="finish-banner"><h2>六层全部完成 · 掌握度 ' + (mastery != null ? mastery : '—') + '</h2><p class="muted">总结卡与独立性判定已由后端生成；可回首页或再做一题。</p>' +
    '<div class="row" style="justify-content:center"><button class="btn btn-primary" data-action="back-home">回到首页</button><button class="btn btn-soft" data-action="goto-s2">再做一题</button></div></div>' : '';
  if(finished){
    return rec + done;
  }
  return '<div class="summary-grid"><label>我学到的知识点<textarea id="sum-knowledge" class="ta" placeholder="例如：条件收敛要证两件事……">' + esc(sm.knowledge || '') + '</textarea></label>' +
    '<label>最容易错的重难点<textarea id="sum-difficulty" class="ta" placeholder="例如：莱布尼茨的单调性条件容易漏……">' + esc(sm.difficulty || '') + '</textarea></label>' +
    '<label>下次的解题步骤<textarea id="sum-steps" class="ta" placeholder="先……再……最后……">' + esc(sm.steps || '') + '</textarea></label></div>' +
    submitBar(guidance.submitLabel || '提交总结', 'submit-summary') + rec + done;
}

/* ---------- 右侧 AI 教练 ---------- */
function coachHtml(layer, guidance){
  var fb = (St.ui && St.ui.feedback) || null;
  var offer = (St.ui && St.ui.proactive) || (St.state && St.state.proactive) || null;
  var err = (St.ui && St.ui.coachError) || null;
  var soft = (St.ui && St.ui.softLanding) || null;
  var b = (St.state && St.state.budgets) || {};
  var u = (St.state && St.state.used) || {};
  var unlocked = (St.state && St.state.unlocked) || ['L0'];
  var labels = {L0:'L0 追问', L1:'L1 概念', L2:'L2 方向', L3:'L3 一步', L4:'L4 示范'};
  var hints = ['L0','L1','L2','L3','L4'].map(function(lv){
    var rem = Math.max(0, (b[lv] || 0) - (u[lv] || 0));
    var locked = unlocked.indexOf(lv) < 0;
    return '<button class="hint-btn' + (locked || rem <= 0 ? ' off' : '') + '" data-action="use-hint" data-level="' + lv + '" title="' + (locked ? '后端未解锁' : '剩余 ' + rem + ' 次') + '">' +
      '<span>' + labels[lv] + '</span><b>剩 ' + rem + '</b></button>';
  }).join('');
  var fbHtml = '<div class="coach-empty">提交后我会在这里指出第一处可疑，只给最小提示，不写完整证明。</div>';
  if(fb){
    if(fb.ai){
      fbHtml = '<div class="tri">' +
        (fb.ai.judge ? '<p><span class="seg-label seg-judge">【判断】</span>' + formatMath(fb.ai.judge) + '</p>' : '') +
        (fb.ai.hint ? '<p><span class="seg-label seg-hint">【提示】</span>' + formatMath(fb.ai.hint) + '</p>' : '') +
        (fb.ai.ask ? '<p><span class="seg-label seg-ask">【提问】</span>' + formatMath(fb.ai.ask) + '</p>' : '') + '</div>' +
        (fb.ai.tag ? '<div class="small muted" style="margin-top:4px">' + esc(fb.ai.tag) + '</div>' : '');
    } else if(fb.hint){
      fbHtml = '<div class="hint-feedback"><span class="msg-tag amber">' + esc(fb.tag || '提示') + '</span>' +
        '<p><span class="seg-label seg-hint">【提示】</span>' + formatMath(fb.hint) + '</p>' +
        (fb.plain ? '<div class="plain-mini"><b>这一步在干什么（小白版）：</b>' + formatMath(fb.plain) + '</div>' : '') + '</div>';
    } else if(fb.list){
      fbHtml = feedbackList(fb.list) + (fb.text ? '<p class="small">' + formatMath(fb.text) + '</p>' : '');
    } else if(fb.text){
      fbHtml = '<p>' + formatMath(fb.text) + '</p>';
    }
  }
  var offerHtml = offer ? '<div class="offer-bubble"><b>要不要给你一个方向提示？</b><p>不会给答案。连续卡住时，我可以只指一个方向。</p>' +
    '<button class="btn btn-amber btn-sm" data-action="proactive-offer">给我一个方向提示（L2）</button></div>' : '';
  var softHtml = soft ? '<div class="soft-box"><b>提示预算用尽</b><p>不再升级、不给答案。可以：只做 L0 追问、看知识点卡、换更小题或转教师。</p>' +
    '<div class="row"><button class="btn btn-ghost btn-sm" data-action="soft-l0">只做 L0</button><button class="btn btn-ghost btn-sm" data-action="soft-knowledge">看知识点卡</button><button class="btn btn-ghost btn-sm" data-action="soft-teacher">转教师</button></div></div>' : '';
  var errHtml = err ? '<div class="coach-error">' + esc(err) + '</div>' : '';
  return '<div class="card coach"><div class="coach-head"><span class="ai-ava">AI</span><div><b>AI 教练</b><div class="small muted">当前第 ' + layer + ' 层 · ' + esc(layerMeta(layer).name) + '</div></div></div>' +
    '<div class="coach-now"><div class="coach-label">现在请你做：</div><p>' + esc(guidance.instruction || LAYER_FALLBACK[layer].instruction) + '</p></div>' +
    '<div class="coach-feedback"><div class="coach-label">最新反馈</div>' + fbHtml + '</div>' + errHtml + softHtml + offerHtml +
    '<div class="coach-hints"><div class="coach-label">提示（常驻 · 后端计预算）<span class="small muted" style="display:block;margin-top:2px">不用自己问：点对应级别，AI 按后端预算给最小提示。</span></div><div class="hint-grid">' + hints + '</div>' +
    '<div class="small muted" style="margin-top:4px">已解锁：' + esc(unlocked.join(' / ')) + '；点未解锁的按钮会由后端返回 409。</div></div>' +
    '<div class="coach-actions"><button class="btn btn-danger btn-sm" data-action="ask-answer">我要答案</button><span class="small muted">会被三段式拒绝</span></div>' +
    '<div class="redline-note"><b>红线</b><span>AI 不写完整证明 / 最终答案 / 可抄推导链；六层内容由你产出。</span></div></div>';
}

/* ---------- 六层提交 ---------- */
async function submitKnowledge(){
  var ta = $('#k-answer'); var answer = ta ? (ta.value || '').trim() : '';
  if(!answer){ toast('先用自己的话写一句，再提交', 'warn'); if(ta) ta.focus(); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/knowledge', {action:'answer', answer:answer});
    St.ui.feedback = data.passed ? {text:'✓ 复述通过，进入下一层。'} : {text:data.feedback || '还差一点：请再补充定义的关键区别。'};
    syncFromResponse(data);
    renderStudent();
    toast(data.passed ? '第 1 层通过 · 进入题目解析' : 'AI 指出缺口，再补一次', data.passed ? '' : 'warn');
  }catch(e){ handleLayerError(e, '提交我的理解失败'); }
}
async function requestKnowledge(tab){
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/knowledge', {action:'request-card'});
    St.ui.knowledgeTab = tab || 'professional';
    syncFromResponse(data);
    renderStudent();
    toast('知识点卡已由后端返回（专业版 / 高中版）');
  }catch(e){ handleLayerError(e, '调取知识点卡失败'); }
}
async function submitParse(){
  var fields = {goal:'#p-goal', parts:'#p-parts', keywords:'#p-keywords', tools:'#p-tools'};
  var body = {};
  Object.keys(fields).forEach(function(k){ var el = $(fields[k]); body[k] = el ? el.value.trim() : ''; });
  if(!body.goal && !body.parts){ toast('至少先写「要证什么」和「要证几件事」', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/parse', body);
    St.ui.feedback = {list:data.feedback || []};
    if(data.plainRestatement && St.state && St.state.parse) St.state.parse.plainRestatement = data.plainRestatement;
    syncFromResponse(data);
    renderStudent();
    toast(data.passed ? '解析通过 · 进入详细步骤' : 'AI 已逐项查漏，补齐后再提交', data.passed ? '' : 'warn');
  }catch(e){ handleLayerError(e, '提交解析失败'); }
}
async function showPlainRestatement(){
  St.ui.showPlain = true;
  if(!(St.state && St.state.parse && St.state.parse.plainRestatement)){
    toast('还没有高中版题意：提交一次解析后由后端返回', 'warn');
  }
  renderStudent();
}
async function submitStep(){
  var c = $('#s-conclusion'); var e = $('#s-evidence');
  var conclusion = c ? (c.value || '').trim() : '';
  var evidence = e ? (e.value || '').trim() : '';
  if(!conclusion || !evidence){ toast('这一步要写「结论/操作 + 依据」两栏', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/step', {conclusion:conclusion, evidence:evidence});
    St.ui.feedback = {ai:data.ai || null};
    St.ui.proactive = data.proactive || null;
    if(data.step && St.state){
      St.state.steps = St.state.steps || [];
      var found = false;
      for(var i=0;i<St.state.steps.length;i++){ if(St.state.steps[i].no === data.step.no){ St.state.steps[i] = data.step; found = true; } }
      if(!found) St.state.steps.push(data.step);
    }
    syncFromResponse(data);
    renderStudent();
    toast('AI 已反馈 · 只指第一处可疑');
  }catch(e2){ handleLayerError(e2, '提交这一步失败'); }
}
async function finishSteps(){
  var steps = (St.state && St.state.steps) || [];
  if(!steps.length){ toast('至少先写一步，再点「写完了」', 'warn'); return; }
  var text = steps.map(function(st){ return '第 ' + st.no + ' 步：' + (st.conclusion || '') + '；依据：' + (st.evidence || ''); }).join('\n');
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/final', {text:text});
    var cov = data.coverage || (St.state && St.state.coverage) || {};
    syncFromResponse(data);
    var fbList = (cov.items || []).map(function(it){ return {field:it.question || it.id, status:it.covered ? 'ok' : 'need', message:it.covered ? '已覆盖' : '缺这一项，补一句'}; });
    St.ui.feedback = fbList.length ? {list:fbList} : {text:'覆盖未到 80%：再补一步结论或依据。'};
    renderStudent();
    toast(cov.passed ? ('覆盖 ' + (cov.percent || 0) + '% · 进入完整讲解') : ('覆盖 ' + (cov.percent || 0) + '%：按缺口再补一步'), cov.passed ? '' : 'warn');
  }catch(e){ handleLayerError(e, '提交「写完了」失败'); }
}
async function submitExplain(){
  var ta = $('#e-text'); var text = ta ? (ta.value || '').trim() : '';
  if(!text){ toast('像给同学讲题一样，先把整道题讲一遍', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/explain', {text:text});
    St.ui.feedback = {list:data.feedback || []};
    syncFromResponse(data);
    renderStudent();
    toast(data.passed ? '讲解通过 · 进入同类题' : 'AI 只核对缺口，按 checklist 补一补', data.passed ? '' : 'warn');
  }catch(e){ handleLayerError(e, '提交完整讲解失败'); }
}
async function submitVariant(){
  var ta = $('#v-answer'); var answer = ta ? (ta.value || '').trim() : '';
  if(!answer){ toast('先写出变式题的答案或关键步骤', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/variant', {answer:answer});
    St.ui.feedback = {text:(data.result ? ((data.result.correct ? '✓ 正确：' : '○ 再想想：') + (data.result.feedback || '')) : '已提交')};
    if(data.state && data.state.variant) St.state.variant = data.state.variant;
    syncFromResponse(data);
    renderStudent();
    toast(data.result && data.result.correct ? '同类题通过 · 进入总结' : 'AI 只判对错 + 一条追问', data.result && data.result.correct ? '' : 'warn');
  }catch(e){ handleLayerError(e, '提交变式题失败'); }
}
async function submitSummary(){
  var body = {knowledge:(($('#sum-knowledge')||{}).value||'').trim(), difficulty:(($('#sum-difficulty')||{}).value||'').trim(), steps:(($('#sum-steps')||{}).value||'').trim()};
  if(!body.knowledge || !body.difficulty || !body.steps){ toast('三栏都要写：知识点 / 重难点 / 解题步骤', 'warn'); return; }
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/summary', body);
    St.ui.feedback = {list:data.feedback || []};
    if(data.mastery != null) St.mastery = data.mastery;
    syncFromResponse(data);
    renderStudent();
    toast('六层完成 · 总结卡与掌握度已生成');
  }catch(e){ handleLayerError(e, '提交总结失败'); }
}

/* ---------- 提示 / 我要答案 / 错误 ---------- */
async function useHintV2(level){
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/hint', {level:level});
    St.ui.feedback = {hint:data.text, tag:(data.tag || level), plain:data.plain || ''};
    St.ui.proactive = null;
    St.ui.coachError = null;
    syncFromResponse(data);
    renderStudent();
    toast((data.tag || level) + ' 已返回');
  }catch(e){
    if(e.code === 'HINT_LOCKED'){
      St.ui.coachError = '后端拒绝 409 HINT_LOCKED：这一级还没解锁。先提交一次尝试，或先用上一级。';
      St.ui.feedback = null;
      renderStudent();
      toast('提示未解锁（409）：先试上一级或再提交一次', 'warn');
      return;
    }
    if(e.code === 'BUDGET_EXHAUSTED'){
      St.ui.softLanding = true;
      St.ui.coachError = '后端 429 BUDGET_EXHAUSTED：信息型提示预算用尽。';
      St.ui.feedback = null;
      renderStudent();
      toast('信息型提示已用尽：不再升级、不给答案', 'warn');
      return;
    }
    handleLayerError(e, '获取提示失败');
  }
}
async function askAnswerV2(){
  try{
    var data = await api('POST', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/answer-request', {});
    var r = data.refusal || {};
    var details = r.alternativeDetails || (r.alternatives || []).map(function(x,i){ return {id:'alt'+i, label:x}; });
    openModal('<h3>这个请求我不能满足，但不会让你卡死</h3><p class="small muted">服务端拒绝模板：接住 → 说清规则 → 60 秒替代动作。</p>' +
      '<div class="refuse-steps"><div class="refuse-step"><span class="rs-label">① 接住</span><div>' + esc(r.receive || '') + '</div></div>' +
      '<div class="refuse-step"><span class="rs-label">② 说清规则</span><div>' + esc(r.rule || '') + '</div></div>' +
      '<div class="refuse-step"><span class="rs-label ok">③ 替代动作</span><div><div class="alt-grid">' + details.map(function(d){
        return '<button class="alt-btn" data-action="choose-alt" data-label="' + esc(d.label || d) + '"><b>' + esc(d.label || d) + '</b><span>' + esc(d.desc || '60 秒内可做') + '</span></button>';
      }).join('') + '</div></div></div></div>' +
      '<div class="redline-note"><b>红线</b><span>完整证明 / 最终答案不会因任何请求破例。</span></div>', {wide:true});
    syncFromResponse(data);
  }catch(e){ handleLayerError(e, '要答案请求失败'); }
}
function handleLayerError(e, fallback){
  if(!e) return;
  if(e.offline){ toast(e.message, 'warn'); return; }
  if(e.status === 409 || e.code === 'WRONG_PHASE'){
    St.ui.coachError = '后端返回 409：' + (e.message || '当前步骤不允许此操作') + '。我会重新同步你的进度。';
    toast('阶段/节点不允许（409）：' + (e.message || ''), 'warn');
    if(St.attemptId){ api('GET', '/api/attempts/' + encodeURIComponent(St.attemptId)).then(function(p){ applyAttemptPayload(p); }).catch(function(){}); }
    renderStudent();
    return;
  }
  showApiError(e, fallback);
}
async function autoKnowledgeHint(){
  var k = (St.state && St.state.knowledge) || {};
  if(!k.professional && !k.plain && !St.ui.knowledgeLoading && !St.ui.knowledgeTried){
    St.ui.knowledgeLoading = true;
    try{
      var data = await api('GET', '/api/problems/' + encodeURIComponent((St.problem && St.problem.id) || (St.state && St.state.problemId) || 'p-cond-series') + '/knowledge');
      if(St.state){ St.state.knowledge = St.state.knowledge || {}; ['professional','plain','checkQuestion','question'].forEach(function(f){ if(data[f]) St.state.knowledge[f] = data[f]; }); }
      St.ui.knowledgeTried = true;
    }catch(e){ St.ui.knowledgeTried = true; /* 知识点卡可选，失败时不阻塞 */ }
    St.ui.knowledgeLoading = false;
    if(currentLayer() === 1 && St.screen === 'S3') renderStudent();
  }
}
async function ensureVariantLoaded(){
  var v = (St.state && St.state.variant) || {};
  if(v.stem || St.ui.variantLoading || St.ui.variantTried) return;
  St.ui.variantLoading = true;
  try{
    var data = await api('GET', '/api/attempts/' + encodeURIComponent(St.attemptId) + '/variant');
    if(St.state && data.variant){ St.state.variant = St.state.variant || {}; St.state.variant.title = data.variant.title; St.state.variant.stem = data.variant.stem; }
    St.ui.variantTried = true;
    St.ui.variantLoading = false;
    if(currentLayer() === 5 && St.screen === 'S3') renderStudent();
  }catch(e){ St.ui.variantTried = true; St.ui.variantLoading = false; }
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
  var layer = parseInt(el.getAttribute('data-layer'), 10);
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
    case 'jump-layer':
      if(layer === currentLayer()){ var lc = document.querySelector('.layer-card'); if(lc) lc.scrollIntoView({behavior:'smooth', block:'start'}); }
      else if(layerStatusOf(layer) === 'done'){ toast('第 ' + layer + ' 层已完成；当前在第 ' + currentLayer() + ' 层', 'warn'); }
      else { toast('第 ' + layer + ' 层未解锁：先完成第 ' + currentLayer() + ' 层', 'warn'); }
      break;
    case 'focus-answer': var ka = $('#k-answer'); if(ka) ka.focus(); break;
    case 'request-knowledge': requestKnowledge(el.getAttribute('data-tab')); break;
    case 'knowledge-tab': St.ui.knowledgeTab = el.getAttribute('data-tab') || 'professional'; renderStudent(); break;
    case 'submit-knowledge': submitKnowledge(); break;
    case 'submit-parse': submitParse(); break;
    case 'show-plain': St.ui.showPlain = true; toast((St.state && St.state.parse && St.state.parse.plainRestatement) ? '高中版题意已显示' : '提交一次解析后，后端会返回高中版题意', 'warn'); renderStudent(); break;
    case 'submit-step': submitStep(); break;
    case 'finish-steps': finishSteps(); break;
    case 'submit-explain': submitExplain(); break;
    case 'submit-variant': submitVariant(); break;
    case 'submit-summary': submitSummary(); break;
    case 'use-hint': useHintV2(level); break;
    case 'ask-answer': askAnswerV2(); break;
    case 'proactive-offer': toast('按后端 offer 走 L2 方向提示（不给答案）'); useHintV2('L2'); break;
    case 'choose-alt': if(modalClose) modalClose(); toast('已选择替代动作：' + (el.getAttribute('data-label') || '') + '。回到当前层继续写。'); break;
    case 'soft-l0': St.ui.softLanding = false; St.ui.coachError = '只做 L0：在左侧提交区继续写依据，不再给新信息。'; renderStudent(); break;
    case 'soft-knowledge': requestKnowledge('professional'); break;
    case 'soft-teacher': toast('已生成教师工单（Demo 展示出口；契约未定义持久化端点）', 'warn'); break;
    case 'retest-info': openModal('<h3>复测安排</h3><p class="small muted">六层完成后，复测检验方法是否留下，不是重考原题。</p><div class="retest" style="margin-top:12px"><div class="retest-item"><b>7 天后 · 小复测</b><span class="muted">重做 p 级数判别 1 题。</span></div><div class="retest-item"><b>30 天后 · 大复测</b><span class="muted">条件收敛 + 绝对收敛混合 2 题。</span></div></div><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>知道了</button></div>'); break;
    case 'retry-teacher': Teacher.data = null; loadTeacher(Teacher.period); break;
    case 'open-student': openStudentDetail(id); break;
    case 'unfinished-all': showUnfinishedAll(); break;
    case 'export-csv': exportCsv(); break;
    case 'queue-view': openModal('<h3>审核队列 · ' + esc(el.getAttribute('data-title') || '') + '</h3><p class="small muted">当前契约只定义 read 接口（dashboard.reviewQueue），未定义审核动作端点；本 Demo 不伪造「通过/退回」持久化。</p><div class="row" style="margin-top:12px"><button class="btn btn-primary" data-close>知道了</button></div>'); break;
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
  if(demoTab && App.token && St.screen !== 'S3'){
    if(St.home && St.home.continue && St.home.continue.attemptId){ await resumeAttempt(St.home.continue.attemptId); }
    else { await startProblem('p-cond-series'); }
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
