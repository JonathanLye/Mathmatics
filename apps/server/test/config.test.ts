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
});
