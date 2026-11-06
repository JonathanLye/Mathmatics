import { describe, expect, it } from 'vitest';

import { autoChecksSummary, buildListQuery, canReviewStatus, sourceLabel, statusLabel, statusTheme } from './problems.ts';

describe('题库/审核展示', () => {
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

  it('停用和下架是两回事：审核状态里的“已停用”不叫下线', () => {
    expect(statusLabel('retired')).toBe('已停用');
  });

  it('来源标签：auto 是 AI 整理，其余都是老师审核', () => {
    expect(sourceLabel('auto')).toBe('AI 整理');
    expect(sourceLabel('teacher')).toBe('老师审核');
    expect(sourceLabel(undefined)).toBe('老师审核');
  });

  it('列表查询串：带分页，空筛选不带，关键词截断到 60 字', () => {
    expect(buildListQuery({})).toBe('limit=25');
    expect(buildListQuery({ status: 'published', reviewSource: 'auto', q: ' ε-N ', cursor: 'abc', limit: 10 })).toBe(
      'limit=10&status=published&reviewSource=auto&q=%CE%B5-N&cursor=abc',
    );
    expect(new URLSearchParams(buildListQuery({ q: 'x'.repeat(80) })).get('q')).toHaveLength(60);
    expect(buildListQuery({ cursor: null })).toBe('limit=25');
  });
});
