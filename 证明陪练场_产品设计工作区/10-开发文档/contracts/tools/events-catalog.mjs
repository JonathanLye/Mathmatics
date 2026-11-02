// 事件目录的唯一来源。生成 contracts/events.schema.json 和 08-事件与数据字典.md 里的事件表：
//   node tools/events-catalog.mjs            → 写 events.schema.json
//   node tools/events-catalog.mjs --markdown → 打印 Markdown 表
// 新增事件只改这里。字段只增不删；改名要走"新增 + 旧字段保留一个学期"。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 'student', V = 'server', T = 'teacher';
const str = (d, extra = {}) => ({ type: 'string', description: d, ...extra });
const int = d => ({ type: 'integer', minimum: 0, description: d });
const num = d => ({ type: 'number', description: d });
const bool = d => ({ type: 'boolean', description: d });
const en = (vals, d) => ({ enum: vals, description: d });
const arr = (items, d) => ({ type: 'array', items, description: d });
const ms = d => int(`${d}（毫秒）`);
const LAYER = en(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'], '层');
const TARGET = en(['def', 'frame', 'line_statement', 'line_justification', 'selfcheck', 'summary', 'help_text'], '输入落点');

// [type, 产生方, 中文说明, payload 属性, 必填]
export const CATALOG = [
  // —— 会话与导航
  ['app.open', S, '打开应用（冷启动或从后台回来）', { entry: str('入口：direct/wechat/qr/notice'), inWeChat: bool('是否在微信内置浏览器'), standalone: bool('是否以 PWA 方式打开'), viewport: { type: 'object', properties: { w: int('宽'), h: int('高'), dpr: num('像素比') } } }, ['entry']],
  ['session.login', V, '登录成功', { method: en(['invite', 'wechat', 'password'], '方式'), newDevice: bool('是否新设备') }, ['method']],
  ['session.logout', V, '退出登录', {}, []],
  ['consent.submit', V, '提交知情同意', { version: str('同意书版本'), items: { type: 'object', properties: { service: bool('服务所需处理（必选）'), crossBorderHosting: bool('数据存储于中国香港服务器（P0 必选）'), crossBorderModel: bool('去标识化后的作答文本发送给境外决策模型 Jev（可选；不同意则网关跳过 Jev）'), monitoring: bool('作答过程监测与切屏记录（必选）'), research: bool('匿名数据用于教研（可选）') } } }, ['version', 'items']],
  ['nav.page', S, '页面切换', { page: str('页面 ID'), from: str('来源页面') }, ['page']],
  // —— 作答生命周期
  ['attempt.start', V, '开始或恢复一次作答', { resumed: bool('是否恢复'), kind: en(['main', 'transfer'], '主题或迁移题'), parentAttemptId: str('迁移题的父作答', { format: 'uuid' }) }, ['resumed', 'kind']],
  ['attempt.park', V, '学生搁置本题', { layer: LAYER }, ['layer']],
  ['attempt.complete', V, '本题完成', { reveal: num('累计透露量'), independence: num('独立度 0–1'), keysOwn: int('自己写出的关键步骤数'), keysTotal: int('关键步骤总数'), durationMs: ms('开始到完成'), activeMs: ms('前台有效时长'), teacherOverrides: arr(str(''), '经教师授权补发的 H4 关键步骤') }, ['reveal', 'independence', 'keysOwn', 'keysTotal', 'durationMs']],
  ['attempt.abandon', V, '布置关闭时仍未完成', { reason: en(['closed', 'teacher', 'timeout'], '原因'), layer: LAYER }, ['reason']],
  ['attempt.lock', V, '作答被锁（测验模式切出过多等）', { reason: str('原因'), count: int('触发次数') }, ['reason']],
  ['attempt.unlock', V, '作答解锁', { by: str('解锁人匿名 ID'), grantH4: str('解锁时补发 H4 的关键步骤 ID（可选）') }, ['by']],
  ['layer.enter', V, '进入某层', { from: en(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', null], '来自哪层'), via: en(['advance', 'nav', 'resume', 'skip'], '方式') }, ['via']],
  ['layer.done', V, '完成某层', { attempts: int('本层提交次数') }, []],
  ['layer.skip', V, '跳过某层', { reason: en(['self', 'pretest', 'history', 'teacher_config'], '跳过依据') }, ['reason']],
  ['stem.toggle', S, '展开/收起题面', { expanded: bool('展开') }, ['expanded']],
  // —— 输入与识别
  ['input.mode', S, '切换输入方式', { mode: en(['ink', 'keyboard', 'photo'], '方式'), target: TARGET }, ['mode', 'target']],
  ['ink.session', S, '一次手写会话结束（点"识别"或取消）', { draftId: str('草稿 ID', { format: 'uuid' }), target: TARGET, inkId: str('笔迹 ID（上传后由服务端返回）'), strokes: int('笔画数'), points: int('采样点数'), durationMs: ms('首笔到末笔'), erases: int('橡皮次数'), undos: int('撤销次数'), scratchOuts: int('划掉删除次数'), fullscreen: bool('是否全屏手写'), orientation: en(['portrait', 'landscape'], '方向'), pointerTypes: arr(en(['pen', 'touch', 'mouse'], ''), '输入设备') }, ['draftId', 'target', 'strokes', 'durationMs']],
  ['kbd.session', S, '一次键盘输入会话结束', { draftId: str('草稿 ID', { format: 'uuid' }), target: TARGET, keys: int('按键总数'), mathKeys: int('数学键次数'), templates: int('结构模板插入次数'), deletes: int('删除次数'), durationMs: ms('时长'), systemKeyboard: bool('是否用了系统键盘') }, ['draftId', 'target', 'keys', 'durationMs']],
  ['paste', S, '在输入框粘贴', { target: TARGET, chars: int('粘贴字符数'), blocked: bool('是否被拦下（测验模式）') }, ['target', 'chars']],
  ['photo.capture', S, '拍照或从相册选图', { photoId: str('照片 ID'), source: en(['camera', 'album'], '来源'), bytes: int('字节'), w: int('宽'), h: int('高') }, ['photoId', 'source']],
  ['recog.request', V, '发起识别', { recogId: str('识别 ID', { format: 'uuid' }), kind: en(['ink', 'photo'], '类型'), provider: str('主识别服务'), queueMs: ms('排队') }, ['recogId', 'kind', 'provider']],
  ['recog.result', V, '识别返回', { recogId: str('识别 ID', { format: 'uuid' }), provider: str('服务'), confidence: num('置信度'), latencyMs: ms('耗时'), crossProvider: str('交叉比对服务'), agree: { type: ['boolean', 'null'], description: '两路结果 canon 后是否一致' }, lines: int('切出的行数（拍照）'), status: en(['ok', 'error', 'timeout', 'empty'], '状态') }, ['recogId', 'provider', 'status']],
  ['recog.confirm', V, '学生确认识别结果（才会提交）', { recogId: str('识别 ID', { format: 'uuid' }), edited: bool('是否改过'), editDistance: int('改动的字符编辑距离') }, ['recogId', 'edited']],
  ['recog.discard', S, '丢弃识别结果重写', { recogId: str('识别 ID'), reason: en(['rewrite', 'cancel', 'switch_keyboard'], '原因') }, ['recogId', 'reason']],
  // —— 各层提交
  ['def.submit', V, '第 1 层提交定义', { lineId: str('行 ID', { format: 'uuid' }), n: int('第几次提交'), components: { type: 'object', additionalProperties: { type: 'boolean' }, description: '各成分是否具备' }, orderOk: bool('量词顺序'), pass: bool('是否通过'), path: en(['rule', 'jev', 'rule+jev', 'rule+llm'], '判定来源'), jevShadow: { type: 'object', description: 'Jev 影子判定（P0 不影响学生）' } }, ['lineId', 'n', 'pass', 'path']],
  ['lesson.open', V, '打开微课', { conceptId: str('概念'), trigger: en(['button', 'auto_after_fail', 'help', 'card'], '触发方式') }, ['conceptId', 'trigger']],
  ['lesson.step', V, '微课进入某步', { conceptId: str('概念'), stepId: str('步骤'), kind: str('步骤类型') }, ['conceptId', 'stepId']],
  ['lesson.check', V, '微课小核验作答', { conceptId: str('概念'), stepId: str('步骤'), choice: int('所选项'), correct: bool('是否正确'), tries: int('第几次') }, ['conceptId', 'stepId', 'correct']],
  ['lesson.visual', S, '图解交互汇总（离开该步时上报）', { conceptId: str('概念'), stepId: str('步骤'), visual: str('图解类型'), interactions: int('拖动次数'), lastValue: num('最后的参数值'), dwellMs: ms('停留') }, ['conceptId', 'stepId', 'visual', 'interactions']],
  ['lesson.close', V, '关闭微课', { conceptId: str('概念'), completedSteps: int('完成步数'), totalSteps: int('总步数') }, ['conceptId', 'completedSteps', 'totalSteps']],
  ['lesson.generated', V, '第 1–2 层按学生原话生成的补充讲解（已过闸门）', { conceptId: str('概念'), misconception: str('归类出的误解类型'), model: str('生成模型'), reviewers: arr(str(''), '复核方'), cached: bool('是否命中缓存') }, ['conceptId', 'model']],
  ['frame.submit', V, '第 2 层提交骨架', { lineId: str('行 ID', { format: 'uuid' }), n: int('第几次'), missing: arr(str(''), '缺失的检查项 ID'), pass: bool('通过'), path: en(['rule', 'jev', 'rule+jev', 'rule+llm'], '判定来源'), jevShadow: { type: 'object', description: 'Jev 影子判定（P0 不影响学生）' } }, ['lineId', 'n', 'pass', 'path']],
  ['frame.template', V, '查看通用骨架模板', {}, []],
  ['line.submit', V, '第 3 层（或迁移题）提交一行', { lineId: str('行 ID', { format: 'uuid' }), n: int('行号'), provenance: en(['ink', 'keyboard', 'photo', 'mixed', 'paste'], '来源'), recogId: str('识别 ID'), hasJust: bool('是否写了依据'), cls: en(['match', 'error', 'unknown', 'lowconf', 'demo_needs_reason'], '归类'), keys: arr(str(''), '命中的关键步骤'), newKeys: arr(str(''), '本行新增的关键步骤'), errorId: str('错误类型 ID'), conf: num('置信度'), path: en(['rule', 'jev', 'llm', 'rule+jev'], '归类来源'), jevShadow: { type: 'object', description: 'Jev 影子判定' } }, ['lineId', 'n', 'provenance', 'cls', 'path']],
  ['line.edit', V, '修改已提交的行（重新归类；apply 据此更新该行的关键步骤）', { lineId: str('行 ID', { format: 'uuid' }), field: en(['statement', 'justification', 'both'], '改了哪部分'), provenance: en(['ink', 'keyboard', 'photo', 'mixed', 'paste'], '新内容来源'), recogId: str('识别 ID'), hasJust: bool('是否写了依据'), cls: en(['match', 'error', 'unknown', 'lowconf', 'demo_needs_reason'], '重新归类结果'), keys: arr(str(''), '该行现在命中的关键步骤'), newKeys: arr(str(''), '因本次修改新获得的关键步骤'), lostKeys: arr(str(''), '因本次修改失去的关键步骤（其他未删除行也没有它）'), errorId: str('错误类型 ID'), conf: num('置信度'), path: en(['rule', 'jev', 'llm', 'rule+jev'], '归类来源'), jevShadow: { type: 'object', description: 'Jev 影子判定' } }, ['lineId', 'field', 'cls', 'keys', 'newKeys', 'lostKeys', 'path']],
  ['line.delete', V, '删除一行（软删除）', { lineId: str('行 ID', { format: 'uuid' }), lostKeys: arr(str(''), '因删除失去的关键步骤（其他未删除行也没有它）') }, ['lineId', 'lostKeys']],
  ['finish.try', V, '点"写完了"', { complete: bool('链条是否闭合'), route: int('闭合的路线序号') }, ['complete']],
  ['selfcheck.assign', V, '分配自检题', { items: arr({ type: 'object', properties: { id: str('题 ID'), line: int('引用学生的第几行') } }, '本次的 3 道题') }, ['items']],
  ['selfcheck.submit', V, '提交一道自检题', { itemId: str('题 ID'), refs: arr(int(''), '引用的行号'), valid: bool('引用是否有效'), path: en(['rule', 'jev', 'rule+jev', 'rule+llm'], '判定来源'), followup: bool('是否追问了一句') }, ['itemId', 'valid']],
  ['transfer.start', V, '开始迁移题', { childAttemptId: str('迁移题作答 ID', { format: 'uuid' }), problemId: str('迁移题 ID') }, ['childAttemptId', 'problemId']],
  ['summary.submit', V, '提交总结', { missing: arr(str(''), '缺失的要点 ID'), followupAsked: bool('是否追问'), pass: bool('是否完成') }, ['pass']],
  // —— 求助、提示、批注
  ['help.open', S, '打开求助抽屉', { from: en(['dock', 'line', 'stuck_offer', 'budget_panel'], '入口') }, ['from']],
  ['help.request', V, '一次求助请求', { helpId: str('求助 ID', { format: 'uuid' }), intent: en(['stuck', 'concept', 'check_line', 'free'], '学生选的意图'), routed: en(['stuck', 'concept', 'check_line', 'pressure', 'off_topic'], '最终路由'), routedBy: en(['chip', 'rule', 'jev', 'llm'], '路由依据'), conf: num('路由置信度'), textChars: int('自由输入字数') }, ['helpId', 'intent', 'routed', 'routedBy']],
  ['hint.preview', V, '展示下一条提示的代价（花之前）', { helpId: str('求助 ID'), key: str('关键步骤'), level: en(['H0', 'H1', 'H2', 'H3', 'H4'], '级别'), cost: num('将计入的透露量增量'), revealBefore: num('当前透露量'), allowed: bool('现在能否领取'), reason: str('不能领取的原因') }, ['key', 'level', 'cost', 'allowed']],
  ['hint.deliver', V, '下发一条提示', { helpId: str('求助 ID'), hintId: str('题目包内的提示 ID（key.level）'), key: str('关键步骤'), level: en(['H0', 'H1', 'H2', 'H3', 'H4'], '级别'), cost: num('该级透露量'), revealDelta: num('本次实际增量'), revealAfter: num('之后的累计透露量'), override: bool('教师补发 H4 / 额度超限授权') }, ['hintId', 'key', 'level', 'revealDelta', 'revealAfter']],
  ['hint.deny', V, '拒绝升级提示', { helpId: str('求助 ID'), reason: en(['need_attempt', 'dwell', 'rapid_lock', 'budget', 'layer', 'test_mode', 'complete'], '原因'), waitSec: int('还需等待秒数') }, ['reason']],
  ['hint.rapid_lock', V, '连点锁定', { until: str('解锁时间', { format: 'date-time' }) }, ['until']],
  ['budget.exhausted', V, '透露额度用尽', { key: str('当时卡住的关键步骤') }, ['key']],
  ['concept.answer', V, '回答概念问题', { helpId: str('求助 ID'), source: en(['glossary', 'lesson', 'generated', 'none'], '来源'), conceptId: str('概念'), glossId: str('词条') }, ['source']],
  ['annotation', V, '系统批注（锚定在某一行）', { annId: str('批注 ID', { format: 'uuid' }), lineId: str('行 ID'), kind: en(['question', 'link', 'justify', 'from_demo', 'order', 'missing'], '类型'), source: en(['rule', 'error', 'jev', 'llm', 'template'], '来源'), errorId: str('错误类型') }, ['annId', 'kind', 'source']],
  ['pressure', V, '索要答案/施压', { helpId: str('求助 ID'), kind: en(['answer_demand', 'authority', 'emotion', 'next_step', 'jailbreak'], '类型') }, ['kind']],
  ['proactive.offer', V, '连续卡住时主动询问是否要提示', { stuckMs: ms('卡住时长'), noProgress: int('无进展提交次数') }, ['stuckMs']],
  ['help.flag_teacher', V, '学生标记求助老师', { flagId: str('标记 ID', { format: 'uuid' }), layer: LAYER }, ['flagId']],
  // —— 闸门
  ['gate.block', V, '外发文本被闸门拦截', { channel: en(['hint', 'annotation', 'concept', 'lesson', 'task', 'refusal', 'nudge', 'generated', 'selfcheck', 'summary'], '通道'), stage: en(['rule', 'format', 'jev', 'cross', 'timeout'], '拦截环节'), keys: arr(str(''), '涉及关键步骤'), fragHash: str('命中片段哈希'), fallback: en(['prewritten', 'generic'], '回退') }, ['channel', 'stage', 'fallback']],
  ['gate.pass_generated', V, '生成文本通过复核', { channel: str('通道'), reviewers: arr(str(''), '复核方'), latencyMs: ms('复核耗时') }, ['channel']],
  // —— 诚信
  ['integ.visibility', S, '页面隐藏/恢复（切出、锁屏、切应用）', { state: en(['hidden', 'visible'], '状态'), awayMs: ms('离开时长（visible 时）') }, ['state']],
  ['integ.blur', S, '窗口失焦（仅桌面端）', { awayMs: ms('失焦时长') }, ['awayMs']],
  ['integ.fullscreen', S, '全屏状态变化', { state: en(['enter', 'exit', 'denied', 'unsupported'], '状态') }, ['state']],
  ['integ.copy', S, '复制', { chars: int('字符数') }, ['chars']],
  ['integ.cut', S, '剪切', { chars: int('字符数') }, ['chars']],
  ['integ.contextmenu', S, '右键/长按菜单', {}, []],
  ['integ.shortcut', S, '敏感快捷键', { combo: str('组合键') }, ['combo']],
  ['integ.devtools', S, '疑似打开开发者工具（启发式，仅桌面）', { signal: str('信号') }, ['signal']],
  ['integ.multitab', S, '同一作答在多个标签页打开', { tabs: int('标签数') }, ['tabs']],
  ['integ.network', S, '网络状态', { online: bool('在线') }, ['online']],
  ['integ.capture', S, '截屏/录屏（仅小程序）', { kind: en(['screenshot', 'record_start', 'record_stop'], '类型') }, ['kind']],
  ['integ.warn', V, '向学生发出诚信提醒', { kind: str('触发类型'), count: int('累计次数'), mode: en(['practice', 'test'], '模式') }, ['kind', 'count', 'mode']],
  ['integ.flag', V, '服务端诚信信号', { signal: en(['no_provenance', 'paste_burst', 'timing', 'similarity', 'ai_style', 'multi_device', 'away_long', 'capture'], '信号'), score: num('0–1'), evidence: { type: 'object', description: '证据（行 ID、时间、相似对象匿名 ID 等）' } }, ['signal', 'score']],
  // —— 教师
  ['t.view', T, '教师查看页面', { page: str('页面'), attemptId: str('作答 ID') }, ['page']],
  ['t.mirror', T, '打开/关闭镜像预览', { attemptId: str('作答 ID'), action: en(['open', 'close'], '动作') }, ['attemptId', 'action']],
  ['t.nudge', V, '教师给学生发一句话（过闸门）', { gated: bool('是否被闸门改写') }, ['gated']],
  ['t.resolve_flag', V, '处理求助标记', { flagId: str('标记 ID') }, ['flagId']],
  ['t.assign', V, '布置练习/测验', { assignmentId: str('布置 ID'), mode: en(['practice', 'test'], '模式'), problemId: str('题'), version: int('版本') }, ['assignmentId', 'mode']],
  ['t.publish_review', V, '题目关闭后发布参考证明与讲评', { assignmentId: str('布置 ID') }, ['assignmentId']],
  ['t.export', V, '导出数据', { exportId: str('导出 ID'), scope: str('范围'), anonymized: bool('是否匿名') }, ['exportId', 'anonymized']],
  ['t.review_package', V, '审核题目包', { problemId: str('题'), version: int('版本'), decision: en(['approve', 'return', 'edit'], '结论'), minutes: int('用时分钟') }, ['problemId', 'version', 'decision']],
  // —— 系统
  ['sys.fallback', V, '组件降级', { component: en(['jev', 'llm', 'ocr', 'ocr_cross', 'cross_review', 'lean'], '组件'), reason: en(['timeout', 'error', 'quota', 'disabled'], '原因') }, ['component', 'reason']],
  ['sys.error', S, '前端错误', { code: str('错误码'), where: str('位置') }, ['code']],
];

export function buildSchema() {
  const types = CATALOG.map(c => c[0]);
  const payloadDefs = {};
  const branches = [];
  for (const [type, , desc, props, req] of CATALOG) {
    const name = 'p_' + type.replace(/\./g, '_');
    payloadDefs[name] = { type: 'object', description: desc, properties: props, required: req, additionalProperties: true };
    branches.push({ if: { properties: { type: { const: type } } }, then: { properties: { payload: { $ref: `#/$defs/${name}` } } } });
  }
  const common = {
    id: { type: 'string', format: 'uuid', description: '事件 ID（客户端生成 uuid v7；重试时不变，用于幂等去重）' },
    type: { enum: types },
    tsClient: { type: 'string', format: 'date-time', description: '客户端时间（仅参考，排序以服务端 seq 为准）' },
    sessionId: { type: 'string', format: 'uuid', description: '前端会话 ID（每次打开应用新建）' },
    deviceId: { type: 'string', format: 'uuid', description: '设备 ID（首次打开时生成并持久化）' },
    clientSeq: { type: 'integer', minimum: 0, description: '同一前端会话内的递增序号，用于发现丢包' },
    attemptId: { type: 'string', format: 'uuid' },
    layer: { enum: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', null] },
    payload: { type: 'object' },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://proof-gym.local/contracts/events.schema.json',
    title: '事件 StoredEvent v1（只追加）',
    description: '服务端入库后的事件。前端上报用 $defs/ClientEvent；服务端补全其余字段。由 tools/events-catalog.mjs 生成，请勿手改。',
    type: 'object',
    required: ['id', 'seq', 'type', 'source', 'tsServer', 'userAnon', 'role', 'payload'],
    properties: {
      ...common,
      seq: { type: 'integer', minimum: 0, description: '服务端分配：同一作答内严格递增；无作答的事件按用户递增' },
      source: { enum: ['student', 'server', 'teacher'] },
      tsServer: { type: 'string', format: 'date-time' },
      userAnon: { type: 'string', description: '匿名码，如 S-7K2Q9M（学生）、T-3F（教师）' },
      role: { enum: ['student', 'teacher', 'admin', 'system'] },
      classId: { type: ['string', 'null'], format: 'uuid' },
      assignmentId: { type: ['string', 'null'], format: 'uuid' },
      problemId: { type: ['string', 'null'] },
      problemVersion: { type: ['integer', 'null'] },
      mode: { enum: ['practice', 'test', null] },
      arm: { enum: ['A', 'B', null], description: '实验分组（未参与实验为 null）' },
      appVersion: { type: 'string' },
      platform: { enum: ['h5-ios', 'h5-android', 'h5-desktop', 'h5-wechat-ios', 'h5-wechat-android', 'mp-weixin', 'teacher-web', 'server'] },
      promptVersion: { type: ['string', 'null'] },
      modelVersions: { type: 'object', additionalProperties: { type: 'string' } },
    },
    allOf: branches,
    $defs: {
      ClientEvent: {
        type: 'object',
        description: '前端 POST /api/v1/events:batch 的单条事件（只能上报 source=student/teacher 的类型）',
        required: ['id', 'type', 'tsClient', 'sessionId', 'deviceId', 'clientSeq', 'payload'],
        properties: { ...common, type: { enum: CATALOG.filter(c => c[1] !== V).map(c => c[0]) } },
        additionalProperties: false,
        allOf: branches.filter((_, i) => CATALOG[i][1] !== V),
      },
      ...payloadDefs,
    },
  };
}

export function markdown() {
  const who = { student: '学生端', server: '服务端', teacher: '教师端' };
  const rows = CATALOG.map(([t, src, d, props, req]) => `| \`${t}\` | ${who[src]} | ${d} | ${Object.keys(props).map(k => req.includes(k) ? `**${k}**` : k).join(', ') || '—'} |`);
  return ['| type | 产生方 | 含义 | payload 字段（粗体必填） |', '|---|---|---|---|', ...rows].join('\n');
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--markdown')) console.log(markdown());
  else { fs.writeFileSync(path.join(here, '..', 'events.schema.json'), JSON.stringify(buildSchema(), null, 2) + '\n'); console.log(`events.schema.json：${CATALOG.length} 种事件`); }
}
