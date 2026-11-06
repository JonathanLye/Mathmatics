// 教师端界面上的中文词：事件类型、行的归类、诚信信号、提示级别。后端的内部编号不直接露给老师；没见过的编号一律说“其他操作”。
import { layerName } from './layers.ts';

const EVENT_LABELS: Record<string, string> = {
  'attempt.start': '开始作答',
  'attempt.complete': '完成作答',
  'attempt.park': '搁置本题',
  'attempt.abandon': '放弃本题',
  'attempt.lock': '作答被锁定',
  'attempt.unlock': '作答已解锁',
  'def.submit': '提交定义',
  'frame.submit': '提交骨架',
  'frame.template': '查看通用骨架',
  'line.submit': '提交一行',
  'line.edit': '修改一行',
  'line.delete': '删除一行',
  'finish.try': '点了“写完了”',
  'selfcheck.submit': '提交自检回答',
  'transfer.start': '开始换题试试',
  'summary.submit': '提交总结',
  'help.open': '打开求助',
  'help.request': '请求帮助',
  'help.flag_teacher': '点了“求助老师”',
  'hint.deliver': '领取提示',
  'hint.preview': '查看提示预览',
  'hint.deny': '提示未发放',
  'hint.rapid_lock': '连续点提示被暂时限制',
  'budget.exhausted': '提示额度用完',
  annotation: '收到批注',
  'solution.revealed': '查看了解答',
  'lesson.open': '打开微课',
  'lesson.close': '关闭微课',
  'recog.request': '请求识别',
  'recog.confirm': '确认识别结果',
  'photo.capture': '拍照',
  't.nudge': '老师发来一句话',
  'integ.flag': '出现诚信提醒',
  'integ.copy': '复制内容',
  'integ.visibility': '切换页面',
};

export function eventTypeLabel(type: string): string {
  return EVENT_LABELS[type] ?? '其他操作';
}

/** 提示级别 H0–H4 → “N 级提示”。 */
export function hintLevelLabel(level: string | null | undefined): string {
  const m = /^H(\d)$/.exec(level ?? '');
  return m ? `${m[1]} 级提示` : '提示';
}

const CLS_LABELS: Record<string, string> = {
  match: '命中关键步骤',
  error: '常见错误',
  unknown: '没认出来',
  lowconf: '把握不大',
  pass: '通过',
  fail: '未通过',
};

export function lineClsLabel(cls: string | null | undefined): string {
  return cls === null || cls === undefined || cls === '' ? '' : (CLS_LABELS[cls] ?? '其他');
}

export const CLS_OPTIONS = Object.entries(CLS_LABELS).map(([value, label]) => ({ value, label }));

const SIGNAL_LABELS: Record<string, string> = {
  paste_burst: '一次粘贴了大段内容',
  multi_device: '几分钟内换了设备',
};

export function integritySignalLabel(signal: string): string {
  return SIGNAL_LABELS[signal] ?? '其他提醒';
}

const DISPOSITION_LABELS: Record<string, string> = { dismissed: '已忽略', noted: '已记录', talked: '已面谈' };

export function dispositionLabel(disposition: string | null | undefined): string {
  return disposition === null || disposition === undefined ? '' : (DISPOSITION_LABELS[disposition] ?? '已处理');
}

/** 时间线一行的说明：事件名 + 所在的层。 */
export function timelineText(type: string, layer: string | null | undefined): string {
  const where = layerName(layer);
  return where === '' ? eventTypeLabel(type) : `${eventTypeLabel(type)} · ${where}`;
}

const EXPORT_STATUS: Record<string, string> = {
  queued: '排队中',
  pending_approval: '等待管理员审批',
  running: '生成中',
  done: '已完成',
  failed: '失败',
  expired: '已过期',
};

export function exportStatusLabel(status: string): string {
  return EXPORT_STATUS[status] ?? '处理中';
}

const ASSIGNMENT_STATUS: Record<string, string> = { open: '进行中', scheduled: '未开放', closed: '已关闭', cancelled: '已取消' };

export function assignmentStatusLabel(status: string): string {
  return ASSIGNMENT_STATUS[status] ?? '未知';
}
