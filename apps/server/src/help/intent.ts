// 求助意图路由（09 §3 C4、C5；06 §4.2–4.3）。
// 按钮意图直接路由。自由提问先看规则，分两层（U15）：
// - 硬规则（HARD_PRESSURE）：索要答案或完整步骤、注入指令、冒充老师测试。直接拒绝（pressure：一句拒绝 + H0）。
// - 软规则（SOFT_PRESSURE）：情绪（求求你、拜托、很急）和权威说法（老师说、助教）。这些词本身不构成违规，
//   去掉这些词以后看剩下的话：要提示 → stuck；问概念 → concept；还在索要答案的口气 → pressure；其余 → concept（free 答概念卡 + 一个问题）。
//   开了模型时由 classifySoft 的替换实现复核（Task 8），失败才拒绝。
// 规则宁可多拦（09 §3 G2 的原则），但不能把正常提问当成施压：误拦时拒绝文案仍要给出一个可做的下一步。

export const BUTTON_INTENTS = ['stuck', 'concept', 'check_line'] as const;
export type ButtonIntent = (typeof BUTTON_INTENTS)[number];
export type Routed = ButtonIntent | 'pressure';

export type RouteInput = { intent: 'stuck' | 'concept' | 'check_line' } | { intent: 'free'; text: string };

// 只用于路由；正文中的每个词都不进入任何响应。
export const HARD_PRESSURE: readonly RegExp[] = [
  // 索要答案或完整过程：必须带“要”的动作，单纯提到“答案”不算。
  /(给|告诉|发|说|看|报|抄|贴)(我|一下|下)?(看|看看)?(一下|下)?(标准答案|参考答案|答案|完整的?证明|全部证明|完整的?过程|完整的?解答)/,
  /(写|列|输出)出(来)?(完整|全部)的?(证明|过程|解答|步骤)/,
  /把[^，。？！]{0,4}(标准答案|参考答案|答案|完整的?证明|全部证明|完整的?过程)[^，。？！]{0,4}(给我|发给|告诉我|写给我|写出来|贴出来|说出来)/,
  /(直接|马上|立刻)(给|告诉|写出|说出|看|报)/,
  /(答案|结果)[^，。？！]{0,3}(给我|发我|告诉我|发给我)/,
  /下一步(写|是|做)什么|下一步.*内容|接下来写什么|给我下一步/,
  // 冒充老师或助教来“测试”
  /我是(老师|助教|教研|管理员|开发)|测试一下提示|教研组允许/,
  // 注入与越权
  /忽略(之前|以上|前面|上面)的?(所有)?(规则|指令|要求|设定)|系统[:：]|系统指令|以\s*JSON|输出.*题目包|输出.*K\d|把.*K\d.*(写|放|贴)进/i,
  /假装你是|假装自己是|扮演|越狱/,
];

// 情绪与权威：单独出现不构成违规。
export const SOFT_PRESSURE: readonly RegExp[] = [
  /求求你了?|求你|拜托|快崩溃|崩溃了|明天就考试|很急|急死|不会就完了|救命/,
  /(罗|王|李|张|刘|陈|杨|黄|赵|周)?老师(说|允许|同意|让)|助教(说|允许|同意|让)?|教研组/,
  /没有限制|不受限制|无限制|没有任何限制/,
];

// 剩余的话里的三类特征。
const HINT_REQUEST = /(给|来|要|想要|需要)[^，。？！]{0,3}(个|一个|点|些)?[^，。？！]{0,2}(提示|线索|思路|帮助)|提示一下|点拨|提点|帮我想想|怎么开始|从哪(里)?(开始|入手)|卡住了|不会做|做不出来|想不出来|没思路|没有思路/;
const CONCEPT_QUESTION = /什么是|是什么意思|什么意思|怎么理解|如何理解|为什么|为何|怎么回事|定义|概念|区别|含义|是什么|有什么用|有何用|怎样|如何/;
const ANSWER_SEEKING = /告诉我|给我|回答我|说出来|说吧|快说|答案|直接|完整|全部|下一步|写出来|算出来/;

function stripSoft(text: string): string {
  let rest = text;
  for (const pattern of SOFT_PRESSURE) rest = rest.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), ' ');
  return rest.replace(/[\s，。！？,.!?；;：:、…]+/g, ' ').trim();
}

export function isHardPressure(text: string): boolean {
  return HARD_PRESSURE.some((pattern) => pattern.test(text));
}

export function isSoftPressure(text: string): boolean {
  return SOFT_PRESSURE.some((pattern) => pattern.test(text));
}

// 软规则命中时的规则判定（没有模型，或模型不可用时的结果）。可替换：Task 8 在模型可用时传入复核实现。
export function classifySoft(text: string): Routed {
  const rest = stripSoft(text);
  if (rest === '') return 'concept';
  if (HINT_REQUEST.test(rest)) return 'stuck';
  if (CONCEPT_QUESTION.test(rest)) return 'concept';
  if (ANSWER_SEEKING.test(rest)) return 'pressure';
  return 'concept';
}

export type SoftClassifier = (text: string) => Routed;

export function routeIntent(input: RouteInput, soft: SoftClassifier = classifySoft): Routed {
  if (input.intent !== 'free') return input.intent;
  const text = input.text.trim();
  if (isHardPressure(text)) return 'pressure';
  if (isSoftPressure(text)) return soft(text);
  return 'concept';
}
