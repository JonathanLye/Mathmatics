import { describe, expect, it } from 'vitest';

import { loadContract } from '../src/contract.ts';
import { AppError } from '../src/errors.ts';

const contract = loadContract();

describe('OpenAPI contract validator', () => {
  it('accepts a valid Error body', () => {
    expect(() =>
      contract.validate('Error', { error: { code: 'NOT_FOUND', message: '找不到这道题' } }),
    ).not.toThrow();
  });

  it('rejects an invalid body with VALIDATION_FAILED', () => {
    try {
      contract.validate('Error', { error: { code: 'NOT_A_CODE', message: 'x' } });
      expect.unreachable('应当抛出 VALIDATION_FAILED');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_FAILED');
    }
  });
});
