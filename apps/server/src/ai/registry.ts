import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

// 09 §2 模型注册表。字段里的 "${VAR}" 在加载时从环境变量展开。
// 一个 provider 引用的变量只要有一个为空，它就未配置；这只影响该 provider，不阻止启动。
// values 含密钥：不得打印、不得写入日志或响应。错误信息只写变量名，不写值。

export type Region = 'overseas' | 'cn';

export interface ProviderEntry {
  name: string;
  region: Region;
  timeoutMs: number;
  values: Record<string, string>;
  missing: string[];
  configured: boolean;
}

export interface ModelEntry {
  role: string;
  provider: string;
  model: string | null;
  endpoint: string | null;
  thinking: boolean | null;
}

export interface ModelRegistry {
  providers: Record<string, ProviderEntry>;
  models: Record<string, ModelEntry>;
  flags: Record<string, boolean | string>;
}

interface RawConfig {
  providers?: Record<string, Record<string, unknown>>;
  models?: Record<string, Record<string, unknown>>;
  flags?: Record<string, boolean | string>;
}

const VAR_REF = /\$\{([A-Z][A-Z0-9_]*)\}/g;
const REGIONS: readonly string[] = ['overseas', 'cn'];

export function loadModelRegistry(path: string, env: NodeJS.ProcessEnv): ModelRegistry {
  const raw = (parse(readFileSync(path, 'utf8')) ?? {}) as RawConfig;

  const providers: Record<string, ProviderEntry> = {};
  for (const [name, rawProvider] of Object.entries(raw.providers ?? {})) {
    const { region, timeoutMs, ...fields } = rawProvider;
    if (typeof region !== 'string' || !REGIONS.includes(region)) {
      throw new Error(`provider ${name} 的 region 不合法`);
    }
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`provider ${name} 的 timeoutMs 不合法`);
    }

    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const [key, template] of Object.entries(fields)) {
      if (typeof template !== 'string') throw new Error(`provider ${name} 的字段 ${key} 必须是字符串`);
      values[key] = template.replace(VAR_REF, (_, variable: string) => {
        const value = env[variable];
        if (value === undefined || value === '') {
          if (!missing.includes(variable)) missing.push(variable);
          return '';
        }
        return value;
      });
    }
    providers[name] = { name, region: region as Region, timeoutMs, values, missing, configured: missing.length === 0 };
  }

  const models: Record<string, ModelEntry> = {};
  for (const [role, rawModel] of Object.entries(raw.models ?? {})) {
    const provider = rawModel.provider;
    if (typeof provider !== 'string' || providers[provider] === undefined) {
      throw new Error(`models.${role} 引用了未知的 provider：${String(provider)}`);
    }
    // 部署时可用 MODEL_<ROLE>（如 MODEL_CROSS=qwen-flash）覆盖模型 ID，不必改 yaml；模型名不是密钥，可写日志。
    const override = env[`MODEL_${role.toUpperCase()}`];
    models[role] = {
      role,
      provider,
      model: override !== undefined && override !== '' ? override : typeof rawModel.model === 'string' ? rawModel.model : null,
      endpoint: typeof rawModel.endpoint === 'string' ? rawModel.endpoint : null,
      thinking: typeof rawModel.thinking === 'boolean' ? rawModel.thinking : null,
    };
  }

  return { providers, models, flags: raw.flags ?? {} };
}
