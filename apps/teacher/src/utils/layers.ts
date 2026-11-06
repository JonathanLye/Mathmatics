// 六层的中文名（和学生端一致：回忆定义 / 搭骨架 / 写证明 / 自检 / 换题试试 / 总结）。教师端界面不出现 L1–L6 这类内部编号。
const NAMES: Record<string, string> = {
  L1: '回忆定义',
  L2: '搭骨架',
  L3: '写证明',
  L4: '自检',
  L5: '换题试试',
  L6: '总结',
};

export function layerName(layer: string | null | undefined): string {
  return layer === null || layer === undefined ? '' : (NAMES[layer] ?? layer);
}

/** “第 3 层 写证明” */
export function layerTitle(layer: string | null | undefined): string {
  const m = /^L([1-6])$/.exec(layer ?? '');
  return m ? `第 ${m[1]} 层 ${NAMES[`L${m[1]}`]}` : layerName(layer);
}
