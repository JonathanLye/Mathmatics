// 求助意图路由（09 §3 C4、C5；06 §4.2–4.3）。
// 按钮意图直接路由。自由提问先看规则：索要答案、权威或情绪施压、注入指令 → pressure（拒绝 + H0）。
// 规则判不出时默认 concept（09 §3 C4 "否则按 concept"）。Jev 的意图判定在 P0 只是影子，不参与路由。
// 规则宁可多拦（09 §3 G2 的原则）：误拦时拒绝文案仍要给出一个可做的下一步。

export const BUTTON_INTENTS = ['stuck', 'concept', 'check_line'] as const;
export type ButtonIntent = (typeof BUTTON_INTENTS)[number];
export type Routed = ButtonIntent | 'pressure';

export type RouteInput = { intent: 'stuck' | 'concept' | 'check_line' } | { intent: 'free'; text: string };

// 施压与注入的规则。只用于路由；正文中的每个词都不进入任何响应。
const PRESSURE_PATTERNS: readonly RegExp[] = [
  /答案|完整证明|完整的证明|全部证明|标准答案|参考答案|直接给我|直接告诉我/,
  /下一步(写|是|做)什么|下一步.*内容|接下来写什么/,
  /老师(说|允许|同意)|罗老师|助教|我是(老师|助教|教研)|测试一下提示/,
  /求你|求求|快崩溃|明天就考试|很急|不会就完了|拜托/,
  /忽略(之前|以上|前面)的?(规则|指令|要求)|系统[:：]|以\s*JSON|输出.*题目包|输出.*K\d/i,
  /假装你是|扮演|没有限制|不受限制|越狱/,
];

export function routeIntent(input: RouteInput): Routed {
  if (input.intent !== 'free') return input.intent;
  const text = input.text.trim();
  if (PRESSURE_PATTERNS.some((pattern) => pattern.test(text))) return 'pressure';
  return 'concept';
}
