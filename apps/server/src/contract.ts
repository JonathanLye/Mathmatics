import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';

import { AppError } from './errors.ts';

const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => Ajv2020;

export interface ContractValidator {
  validate(schema: string, data: unknown): void;
  validateRequest(path: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', data: unknown): void;
}

function jsonPointer(segments: readonly string[]): string {
  return segments.map((segment) => `/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

export function loadContract(): ContractValidator {
  const openapiUrl = import.meta.resolve('@proof-gym/contracts/openapi.yaml');
  const document = parseYaml(readFileSync(fileURLToPath(openapiUrl), 'utf8')) as object;

  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  ajv.addSchema(document, 'openapi.json');

  const check = (ref: string, data: unknown) => {
    const validate = ajv.getSchema(ref);
    if (!validate) {
      throw new AppError('INTERNAL', 500, `契约里找不到：${ref}`);
    }
    if (!validate(data)) {
      throw new AppError('VALIDATION_FAILED', 422, '参数不合法', { errors: validate.errors ?? [] });
    }
  };

  return {
    validate(schema, data) {
      check(`openapi.json#/components/schemas/${schema}`, data);
    },
    validateRequest(path, method, data) {
      const pointer = jsonPointer(['paths', path, method, 'requestBody', 'content', 'application/json', 'schema']);
      check(`openapi.json#${pointer}`, data);
    },
  };
}
