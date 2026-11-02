import type { ProblemPackageV1 } from '@proof-gym/contracts/gen/problem-package.ts';

// 类型来自契约生成物（只读）。引擎只用类型，运行时不依赖 contracts。
export type ProblemPackage = ProblemPackageV1;
export type Secret = ProblemPackageV1['secret'];
export type KeyStep = Secret['keys'][number];
export type Budget = ProblemPackageV1['public']['budget'];
export type HintLevel = KeyStep['hints'][number]['level'];
