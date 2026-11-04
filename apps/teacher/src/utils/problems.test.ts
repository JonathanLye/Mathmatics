import { describe, expect, it } from 'vitest';

import { autoChecksSummary, canReviewStatus, statusLabel, statusTheme } from './problems.ts';

describe('题库/审核展示（04 §8）', () => {
  it('审核状态中文与主题', () => {
    expect(statusLabel('draft')).toBe('草稿');
    expect(statusLabel('pending')).toBe('待审核');
    expect(statusLabel('published')).toBe('已发布');
    expect(statusTheme('published')).toBe('success');
    expect(statusTheme('returned')).toBe('warning');
  });

  it('只有 draft/pending/returned 可写审核结论', () => {
    expect(canReviewStatus('draft')).toBe(true);
    expect(canReviewStatus('pending')).toBe(true);
    expect(canReviewStatus('returned')).toBe(true);
    expect(canReviewStatus('published')).toBe(false);
    expect(canReviewStatus('retired')).toBe(false);
    expect(canReviewStatus(undefined)).toBe(false);
  });

  it('自动校验摘要：只统计布尔项，失败项列出', () => {
    expect(autoChecksSummary({ schema: true, katex: true, leakExhaustive: false })).toEqual({ total: 3, failed: ['leakExhaustive'] });
    expect(autoChecksSummary(undefined)).toEqual({ total: 0, failed: [] });
    expect(autoChecksSummary({ schema: true, lean: 'ok' })).toEqual({ total: 1, failed: [] });
  });
});
