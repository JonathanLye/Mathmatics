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
  // 测验默认关求助/拍照（04 §7）；用户显式打开也不阻止，但默认值必须安全。
  const test = form.mode === 'test';
  return {
    revealBudget: Number(form.revealBudget),
    photoEnabled: test ? form.photoEnabled : form.photoEnabled,
    hintsEnabled: test ? form.hintsEnabled : form.hintsEnabled,
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
