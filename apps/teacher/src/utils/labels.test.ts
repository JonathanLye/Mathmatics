import { describe, expect, it } from 'vitest';

import { assignmentStatusLabel, eventTypeLabel, exportStatusLabel, hintLevelLabel, integritySignalLabel, lineClsLabel, timelineText } from './labels.ts';

describe('教师端中文词表', () => {
  it('事件类型翻成中文，没见过的说“其他操作”，不露内部编号', () => {
    expect(eventTypeLabel('line.submit')).toBe('提交一行');
    expect(eventTypeLabel('help.flag_teacher')).toBe('点了“求助老师”');
    expect(eventTypeLabel('some.future_event')).toBe('其他操作');
    expect(timelineText('hint.deliver', 'L3')).toBe('领取提示 · 写证明');
    expect(timelineText('attempt.start', null)).toBe('开始作答');
  });

  it('提示级别、行的归类、诚信信号、导出和布置状态', () => {
    expect(hintLevelLabel('H2')).toBe('2 级提示');
    expect(hintLevelLabel(undefined)).toBe('提示');
    expect(lineClsLabel('lowconf')).toBe('把握不大');
    expect(lineClsLabel('')).toBe('');
    expect(lineClsLabel('zzz')).toBe('其他');
    expect(integritySignalLabel('paste_burst')).toBe('一次粘贴了大段内容');
    expect(integritySignalLabel('x')).toBe('其他提醒');
    expect(exportStatusLabel('pending_approval')).toBe('等待管理员审批');
    expect(exportStatusLabel('???')).toBe('处理中');
    expect(assignmentStatusLabel('open')).toBe('进行中');
    expect(assignmentStatusLabel('scheduled')).toBe('未开放');
    expect(assignmentStatusLabel('???')).toBe('未知');
  });
});
