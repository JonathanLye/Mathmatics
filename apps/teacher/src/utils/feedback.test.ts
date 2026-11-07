import { describe, expect, it } from 'vitest';

import {
  areaLabel,
  breadcrumbLines,
  buildInboxQuery,
  categoryLabel,
  closeReasonLabel,
  confirmBlockedReason,
  contextRows,
  errorLines,
  feedbackErrorMessage,
  statusLabel,
  statusTheme,
  validateStatusChange,
} from './feedback.ts';

describe('反馈收件箱的说法', () => {
  it('状态与分类、区域、关闭原因都有中文，未知值原样返回', () => {
    expect(statusLabel('need_info')).toBe('待补充');
    expect(statusLabel('weird')).toBe('weird');
    expect(statusTheme('new')).toBe('danger');
    expect(statusTheme('resolved')).toBe('success');
    expect(categoryLabel('display')).toBe('显示异常');
    expect(categoryLabel(null)).toBe('未分类');
    expect(areaLabel('practice')).toBe('做题');
    expect(areaLabel(undefined)).toBe('—');
    expect(closeReasonLabel('no_repro')).toBe('无法复现');
    expect(closeReasonLabel(null)).toBe('');
  });
});

describe('查询串', () => {
  it('空的筛选项不带；关键词最长 80；偏移不为负', () => {
    expect(buildInboxQuery({})).toBe('limit=30&offset=0');
    expect(buildInboxQuery({ status: 'open', category: 'bug', area: 'practice', unread: true, q: '  分数线 ', offset: -5 })).toBe(
      'limit=30&offset=0&status=open&category=bug&area=practice&unread=true&q=%E5%88%86%E6%95%B0%E7%BA%BF',
    );
    expect(new URLSearchParams(buildInboxQuery({ q: 'x'.repeat(200) })).get('q')).toHaveLength(80);
    expect(buildInboxQuery({ unread: false })).not.toContain('unread');
  });
});

describe('改状态前的校验', () => {
  it('已解决和已关闭必须写说明，已关闭必须选原因', () => {
    expect(validateStatusChange({ status: 'resolved', note: '   ' })).toMatch(/写一句说明/);
    expect(validateStatusChange({ status: 'closed', note: '重复了' })).toMatch(/选一个原因/);
    expect(validateStatusChange({ status: 'closed', closeReason: 'duplicate', note: '和 #1 一样' })).toBeNull();
    expect(validateStatusChange({ status: 'open', note: '' })).toBeNull();
    expect(validateStatusChange({ status: 'resolved', note: 'x'.repeat(2001) })).toMatch(/太长/);
  });

  it('确认复现要先分类，且只能一次', () => {
    expect(confirmBlockedReason({ category: null, confirmed: false })).toMatch(/先把分类/);
    expect(confirmBlockedReason({ category: 'suggestion', confirmed: false })).toMatch(/先把分类/);
    expect(confirmBlockedReason({ category: 'bug', confirmed: true })).toBe('已经确认过了');
    expect(confirmBlockedReason({ category: 'display', confirmed: false })).toBeNull();
  });

  it('已关闭的错误码有人话提示', () => {
    expect(feedbackErrorMessage('FEEDBACK_CLOSED', 'x')).toMatch(/改回/);
    expect(feedbackErrorMessage('OTHER', '原话')).toBe('原话');
  });
});

describe('探针上下文展示（纯文本）', () => {
  it('位置、版本、设备按行展示；没有的字段不出现', () => {
    const rows = contextRows({
      route: '/pages/practice/index',
      pageName: '做题',
      problemId: 'epsN',
      layer: 'L3',
      mode: 'test',
      stepNo: 2,
      targets: ['step:2', 'answer-input'],
      app: { version: '0.1.0', sha: 'abcdef1234567' },
      env: { os: 'iOS', browser: 'Safari', viewport: '390x844', dpr: 3, theme: 'dark', online: false },
    });
    expect(Object.fromEntries(rows.map((r) => [r.label, r.value]))).toEqual({
      页面: '做题 · /pages/practice/index',
      题目: 'epsN',
      层: 'L3',
      模式: '测验',
      第几步: '2',
      圈到的元素: 'step:2、answer-input',
      版本: '0.1.0 · abcdef1',
      系统与浏览器: 'iOS · Safari',
      视口: '390x844 @3x',
      外观与网络: '深色 · 离线',
    });
    expect(contextRows({})).toEqual([]);
    expect(contextRows(null)).toEqual([]);
  });

  it('操作与错误按行输出；学生传来的 HTML 不会被当成标签处理（只是字符串）', () => {
    const ctx = {
      errors: [{ name: 'TypeError', message: '<img src=x onerror=alert(1)>', where: 'window' }],
      breadcrumbs: [
        { kind: 'nav' as const, text: '/pages/home/index' },
        { kind: 'api' as const, text: 'POST /attempts/1/lines', status: 500, ms: 120, reqId: 'rAbC12345678' },
        { kind: 'tap' as const, text: 'step:2' },
      ],
    };
    expect(errorLines(ctx)).toEqual(['TypeError: <img src=x onerror=alert(1)>  (window)']);
    expect(breadcrumbLines(ctx)).toEqual(['打开 /pages/home/index', '请求 POST /attempts/1/lines  500 120ms rAbC12345678', '点击 step:2']);
  });
});
