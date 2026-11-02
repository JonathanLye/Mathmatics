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
}

export function loadContract(): ContractValidator {
  const openapiUrl = import.meta.resolve('@proof-gym/contracts/openapi.yaml');
  const document = parseYaml(readFileSync(fileURLToPath(openapiUrl), 'utf8')) as object;

  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  ajv.addSchema(document, 'openapi.json');

  return {
    validate(schema, data) {
      const validate = ajv.getSchema(`openapi.json#/components/schemas/${schema}`);
      if (!validate) {
        throw new AppError('INTERNAL', 500, `契约里没有 schema：${schema}`);
      }
      if (!validate(data)) {
        throw new AppError('VALIDATION_FAILED', 422, '参数不合法', { errors: validate.errors ?? [] });
      }
    },
  };
}
