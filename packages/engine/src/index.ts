export const ENGINE_NAME = 'proof-gym-engine';

export { canon, latexToLinear, matchesAny, splitMath } from './canon.ts';
export { classifyLine, nextKey, type Classification } from './classify.ts';
export { gateRule, hintAllow, type GateResult, type LeakHit } from './gate.ts';
export { initialHintState, selectHint, type HintDecision, type HintState } from './hint.ts';
export { leakExhaustive, type ConceptsFile, type LeakFailure } from './leak.ts';
export type { Budget, HintLevel, KeyStep, ProblemPackage, Secret } from './types.ts';
