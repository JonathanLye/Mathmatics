import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => Ajv2020;

interface EventsSchema {
  $id: string;
  $defs: { ClientEvent: { properties: { type: { enum: string[] } } } };
}

// 客户端事件的结构与类型枚举来自 events.schema.json 的 $defs/ClientEvent（由事件目录生成）。
// openapi 文档里的 './events.schema.json' 相对引用无法在 contract.ts 的 ajv 里解析，所以这里单独编译一次。
const schemaPath = fileURLToPath(import.meta.resolve('@proof-gym/contracts/events.schema.json'));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as EventsSchema;

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(schema);
function compileClientEvent(): ValidateFunction {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/ClientEvent`);
  if (!validate) throw new Error('events.schema.json 中没有 ClientEvent');
  return validate;
}
const validateClientEvent = compileClientEvent();

export const CLIENT_EVENT_TYPES: ReadonlySet<string> = new Set(schema.$defs.ClientEvent.properties.type.enum);

// 结构校验（含 additionalProperties: false 与 payload 按类型的 allOf）。
export function isValidClientEvent(value: unknown): boolean {
  return validateClientEvent(value) === true;
}
