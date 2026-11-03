import type { ProblemPackage } from '@proof-gym/engine';

// 施压的拒绝文案（06 §4.3）。固定句子，不随题目变化，不包含任何题目内容。
export const REFUSAL_TEXT = '不提供完整证明或下一步，这一点不会因为任何理由改变。';

// 取某个关键步骤在某一级提示的文本（来自题目包的 secret 部分，只在服务端使用）。
export function hintTextOf(secret: ProblemPackage['secret'], keyId: string, level: string): string | null {
  const key = secret.keys.find((k) => k.id === keyId);
  const hint = key?.hints.find((h) => h.level === level);
  return hint?.text ?? null;
}
