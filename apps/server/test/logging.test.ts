import { describe, expect, it } from 'vitest';

import { redactUrl, requestSerializer } from '../src/logging.ts';

describe('访问日志脱敏（#43 A 复审 P1-1）', () => {
  it('只脱敏 token/mirrorToken，保留其余参数', () => {
    expect(redactUrl('/api/v1/teacher/attempts/x/stream?token=abc.def&afterSeq=3')).toBe(
      '/api/v1/teacher/attempts/x/stream?token=***&afterSeq=3',
    );
    expect(redactUrl('/x?mirrorToken=secret&x=1')).toBe('/x?mirrorToken=***&x=1');
  });

  it('大小写与多参数', () => {
    expect(redactUrl('/x?TOKEN=abc&Token=def&a=1')).toBe('/x?TOKEN=***&Token=***&a=1');
  });

  it('没有 token 时原样返回', () => {
    expect(redactUrl('/health?x=1')).toBe('/health?x=1');
  });

  it('请求序列化器不输出 token 原文', () => {
    const req = { method: 'GET', url: '/s?token=secret', headers: { host: 'h' }, socket: { remoteAddress: '1.1.1.1' } };
    const out = requestSerializer(req as never);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out.url).toBe('/s?token=***');
  });
});
