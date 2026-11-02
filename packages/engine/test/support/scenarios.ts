import type { Runner } from './runner.ts';

// 三个学生场景，按 08-重构原型/index.html 的 DEMO_SC 顺序逐步对应（每个数组元素对应 DEMO_SC 的一步）。
// 没有对应命令的步骤（提问、切页、Lean 编译）以空函数占位：它们不进入状态机，v3 的对应事件在 project.ts 里以名字排除。

export const DEF_OK = '∀ε>0，∃N，∀n>N，|a_n−A|<ε';
export const DEF_WRONG_ORDER = '∃N，∀ε>0，∀n>N，|a_n−A|<ε';
export const FRAME_TEXT = '任取 ε>0。取 N=（待构造）。则当 n>N 时，… < ε。';
export const K1: [string, string] = ['|a_n−3| = 5/(n+2)', '通分化简：3n+1−3(n+2)=−5'];
export const K2: [string, string] = ['5/(n+2) < 5/n', '分母变小，分数变大'];
export const K3: [string, string] = ['取 N=⌈5/ε⌉', 'N 只依赖 ε，先于 n 取定'];
export const K4: [string, string] = ['当 n>N 时，|a_n−3| = 5/(n+2) < 5/n < ε', '前三行连成一条链'];
export const SELF_ANSWERS = [
  '第4行由第1、2、3行推出，用到化简、放大和 N 的取法',
  'N 决定从第几项起，只依赖 ε',
  '换成 n≥1，第3行取 N 那一步就断了',
];
export const SUMMARY_OK = [
  '证明了极限等于 3',
  '分三块：化简、放大、取 N 收尾',
  'N 只依赖 ε，这个选择决定成败',
  '链条落到 <ε 才算证完',
  '放大到简单式子的做法下次还能用',
];
export const SUMMARY_MISSING_POINT = [
  '证明了极限等于 3',
  '分三块：化简、放大、收尾',
  '取 N 那一步最关键',
  '链条落到 <ε 才算证完',
  '放大的做法下次还能用',
];
export const SUMMARY_FIXED = [...SUMMARY_MISSING_POINT.slice(0, 2), '取 N 那一步最关键，N 只依赖 ε', ...SUMMARY_MISSING_POINT.slice(3)];

export type Scenario = ((r: Runner) => void)[];

const NOOP = (): void => {};

export const SCENARIOS: Record<'pro' | 'mid' | 'weak', Scenario> = {
  pro: [
    (r) => r.def(DEF_OK), // 1 定义
    (r) => r.frame(FRAME_TEXT), // 2 骨架
    (r) => r.line(...K1), // 3 K1
    (r) => r.line(...K2), // 4 K2
    NOOP, // 5 概念提问（ask，不进入状态机）
    (r) => r.line(...K3), // 6 K3
    (r) => r.line(...K4), // 7 K4
    (r) => r.finish(), // 8 写完了
    (r) => r.selfcheck(SELF_ANSWERS), // 9 自检
    (r) => r.transfer(), // 10 迁移题
    (r) => r.summary(SUMMARY_OK), // 11 总结
    NOOP, // 12 切到教师页
    NOOP, // 13 本机 Lean 编译（不进入状态机）
  ],
  mid: [
    (r) => r.def(DEF_WRONG_ORDER), // 1 量词顺序写反
    (r) => r.cardOpen(), // 2 看不懂
    (r) => r.cardAnswer(1), // 3 判断题答错
    (r) => r.cardAnswer(0), // 4 判断题答对
    (r) => r.def(DEF_OK), // 5 重写定义
    (r) => r.frame(FRAME_TEXT), // 6 骨架
    (r) => r.line(...K1), // 7 K1
    (r) => r.line('取 N=n+1', '先把 N 定下来'), // 8 取 N 依赖 n
    (r) => r.hint(), // 9 H0 K2
    (r) => r.hint(), // 10 H1 K2
    (r) => r.line(...K2), // 11 K2
    (r) => r.line(...K3), // 12 K3
    (r) => r.hint(), // 13 H0 K4
    (r) => r.hint(), // 14 H1 K4
    (r) => r.line('先把 N 取大一点吧', ''), // 15 含糊
    (r) => r.hint(), // 16 H2 K4（0.5）
    (r) => r.line(...K4), // 17 K4
    (r) => r.finish(), // 18 写完了
    (r) => r.selfcheck(SELF_ANSWERS), // 19 自检
    (r) => r.skip(), // 20 跳过第 5 层
    (r) => r.summary(SUMMARY_MISSING_POINT), // 21 总结缺要点
    (r) => r.summary(SUMMARY_FIXED), // 22 补上要点
    NOOP, // 23 切到教师页
  ],
  weak: [
    NOOP, // 1 索要完整证明（pressure，不进入状态机）
    (r) => r.def('不会写'), // 2 定义不通过
    (r) => r.cardOpen(), // 3 看不懂
    (r) => r.cardAnswer(1), // 4 答错
    (r) => r.cardAnswer(0), // 5 答对
    (r) => r.def(DEF_OK), // 6 定义通过
    (r) => r.frameTemplate(), // 7 看通用骨架
    (r) => r.frame(FRAME_TEXT), // 8 骨架通过
    (r) => r.hint(), // 9 H0 K1
    (r) => r.hint(), // 10 H1 K1
    (r) => r.line('|a_n−3| = 7/(n+2)', '我算的'), // 11 分子算错
    (r) => r.hint(), // 12 H2 K1（0.5）
    (r) => r.line('不知道下一步', ''), // 13 含糊
    (r) => r.hint(), // 14 H3 K1（1，补差额 0.5）
    (r) => r.line(...K1), // 15 K1
    (r) => r.burst(3), // 16 连点 3 次：H0、H1、快速锁
    (r) => r.line('先把 N 取大一点吧', ''), // 17 含糊
    (r) => r.hint(), // 18 H2 K2（0.5）
    (r) => r.line('先把 N 取大一点吧', ''), // 19 含糊
    (r) => r.hint(), // 20 H3 K2（1，补差额 0.5）
    (r) => r.line(...K2), // 21 K2
    (r) => r.hint(), // 22 H0 K3
    (r) => r.hint(), // 23 H1 K3
    (r) => r.line('先把 N 取大一点吧', ''), // 24 含糊
    (r) => r.hint(), // 25 H2 K3：额度用尽
    (r) => r.flag(), // 26 标记求助老师
    NOOP, // 27 切到教师页
  ],
};
