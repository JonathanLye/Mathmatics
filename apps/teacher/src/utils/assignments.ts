// 04 §7：布置表单 → 契约 settings 的归一化（mode 决定默认与暴露字段）。
export interface AssignmentForm {
  mode: 'practice' | 'test';
  revealBudget: number;
  photoEnabled: boolean;
  hintsEnabled: boolean;
  maxSwitches: number;
  durationMin: number;
}

export interface AssignmentSettings {
  revealBudget: number;
  photoEnabled: boolean;
  hintsEnabled: boolean;
  maxSwitches: number;
  durationMin?: number;
}

export function normalizeAssignmentSettings(form: AssignmentForm): AssignmentSettings {
  // 默认值由 defaultsForMode 决定（04 §7 测验默认关求助/拍照）；这里只负责归一化，教师显式打开也不阻止。
  const test = form.mode === 'test';
  return {
    revealBudget: Number(form.revealBudget),
    photoEnabled: form.photoEnabled,
    hintsEnabled: form.hintsEnabled,
    maxSwitches: Number(form.maxSwitches),
    ...(test && Number(form.durationMin) > 0 ? { durationMin: Number(form.durationMin) } : {}),
  };
}

export function defaultsForMode(mode: 'practice' | 'test'): Pick<AssignmentForm, 'photoEnabled' | 'hintsEnabled'> {
  return mode === 'test' ? { photoEnabled: false, hintsEnabled: false } : { photoEnabled: true, hintsEnabled: true };
}

// 发布讲评的参考证明 ID 输入：逗号/空白分隔，去重去空。
export function parseProofIds(text: string): string[] {
  return [...new Set(text.split(/[,，\s]+/).map((item) => item.trim()).filter((item) => item !== ''))];
}
