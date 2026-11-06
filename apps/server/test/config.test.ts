import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.ts';

const SECRETS = {
  SESSION_SECRET: 'x'.repeat(40),
  PII_KEY: Buffer.alloc(32, 1).toString('base64'),
  STUDENT_NO_PEPPER: 'y'.repeat(40),
};

describe('loadConfig：开发密钥只能留在本机回环上', () => {
  it('默认（NODE_ENV 未设、监听 127.0.0.1）：可以用开发密钥启动', () => {
    expect(() => loadConfig({})).not.toThrow();
    expect(() => loadConfig({ HOST: 'localhost' })).not.toThrow();
  });

  it('NODE_ENV 未设但监听非回环地址且没给密钥：启动失败', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow('不是回环地址');
    expect(() => loadConfig({ HOST: '0.0.0.0', SESSION_SECRET: SECRETS.SESSION_SECRET })).toThrow('不是回环地址');
  });

  it('NODE_ENV 未设、监听非回环地址，但三个密钥都给了：可以启动', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0', ...SECRETS })).not.toThrow();
  });

  it('生产环境缺密钥仍然失败', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0' })).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', ...SECRETS })).not.toThrow();
  });

  it('空串按“没提供”处理：非回环失败，回环回落开发密钥', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0', ...SECRETS, SESSION_SECRET: '' })).toThrow('不是回环地址');
    expect(() => loadConfig({ HOST: '0.0.0.0', SESSION_SECRET: '', PII_KEY: '', STUDENT_NO_PEPPER: '' })).toThrow('不是回环地址');
    const loopback = loadConfig({ HOST: '127.0.0.1', SESSION_SECRET: '', PII_KEY: '', STUDENT_NO_PEPPER: '' });
    expect(loopback.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(loopback.piiKey.length).toBe(32);
  });

  it('非回环即使显式提供密钥，也要求 32 字符；PII_KEY 空串不能回落公开 key', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0', ...SECRETS, SESSION_SECRET: 'short' })).toThrow('32 个字符');
    expect(() => loadConfig({ HOST: '0.0.0.0', ...SECRETS, STUDENT_NO_PEPPER: 'short' })).toThrow('32 个字符');
    expect(() => loadConfig({ HOST: '0.0.0.0', ...SECRETS, PII_KEY: '' })).toThrow('不是回环地址');
    expect(() => loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', ...SECRETS, PII_KEY: '' })).toThrow('PII_KEY');
  });

  it('STUDENT_PASSWORD_ENFORCE：开发/测试缺省关闭，生产缺省开启；显式值优先，写错直接报错', () => {
    expect(loadConfig({}).studentPasswordEnforce).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test' }).studentPasswordEnforce).toBe(false);
    expect(loadConfig({ STUDENT_PASSWORD_ENFORCE: 'true' }).studentPasswordEnforce).toBe(true);
    expect(loadConfig({ STUDENT_PASSWORD_ENFORCE: '1' }).studentPasswordEnforce).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', ...SECRETS }).studentPasswordEnforce).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', ...SECRETS, STUDENT_PASSWORD_ENFORCE: 'false' }).studentPasswordEnforce).toBe(false);
    expect(loadConfig({ STUDENT_PASSWORD_ENFORCE: '' }).studentPasswordEnforce).toBe(false);
    expect(() => loadConfig({ STUDENT_PASSWORD_ENFORCE: 'yes' })).toThrow('STUDENT_PASSWORD_ENFORCE');
  });
});
