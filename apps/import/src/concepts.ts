import { readFileSync } from 'node:fs';

import type { ConceptsFile } from '@proof-gym/engine';
import { parse as parseYaml } from 'yaml';

// seed/concepts.json 的结构（concepts + glossary）；也接受 YAML。
export function loadConceptsFile(file: string): ConceptsFile {
  const text = readFileSync(file, 'utf8');
  const data = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as ConceptsFile;
  if (!Array.isArray(data.concepts) || !Array.isArray(data.glossary)) {
    throw new Error(`概念库格式不合法：${file}（需要 concepts / glossary 数组）`);
  }
  return data;
}
