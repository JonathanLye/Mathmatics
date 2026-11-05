import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { canon } from '@proof-gym/engine';

import { diffTexts, editDistance } from '../src/recognition/diff.ts';
import {
  decodeInk,
  inkStats,
  InkError,
  PNG_HEIGHT,
  rasterizeStrokes,
  visibleStrokes,
  type InkDoc,
  type InkStroke,
} from '../src/recognition/ink.ts';
import { latexToMathText, latexToMathTextLines } from '../src/recognition/mathtext.ts';
// 前端实现：一致性测试用（只在测试里引用，生产代码不依赖 ui-math）
import { replayVisibleIds } from '../../../packages/ui-math/src/ink.ts';

function stroke(id: number, t: number, pts: [number, number][]): InkStroke {
  return { id, p: 'pen', pts: pts.map(([x, y], i) => [x, y, t + i * 10, 0.5]) };
}

function doc(strokes: InkStroke[], ops: InkDoc['ops'] = []): InkDoc {
  return { v: 1, w: 360, h: 120, dpr: 2, t0: 0, orientation: 'portrait', fullscreen: false, strokes, ops };
}

const b64 = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');

describe('latexToMathText（03 §3.4）', () => {
  it('\\text{} 与中文放在 $ 外，其余进 $…$', () => {
    expect(latexToMathText('\\text{任取}\\varepsilon>0')).toBe('任取 $\\varepsilon>0$');
    expect(latexToMathText('\\text{取}N=\\lceil\\frac{5}{\\varepsilon}\\rceil')).toBe('取 $N=\\lceil\\frac{5}{\\varepsilon}\\rceil$');
  });

  it('纯中文原样，不加 $；纯公式整体加 $', () => {
    expect(latexToMathText('因为所以')).toBe('因为所以');
    expect(latexToMathText('|a_n-3|<\\varepsilon')).toBe('$|a_n-3|<\\varepsilon$');
  });

  it('CJK 字符即使没写 \\text 也移到 $ 外；全角标点保留在 $ 外且前后不补空格', () => {
    expect(latexToMathText('任取\\varepsilon>0，取N=5')).toBe('任取 $\\varepsilon>0$，取 $N=5$');
  });

  it('\\mathrm{lim} → \\lim', () => {
    expect(latexToMathText('\\mathrm{lim}_{n\\to\\infty}a_n=3')).toBe('$\\lim_{n\\to\\infty}a_n=3$');
  });

  it('多行 array 拆成多行', () => {
    expect(latexToMathTextLines('\\begin{array}{l}a=1\\\\b=2\\end{array}')).toEqual(['$a=1$', '$b=2$']);
  });

  it('空输入返回空', () => {
    expect(latexToMathText('   ')).toBe('');
  });
});

describe('ink-v1 解码与重放', () => {
  const d = doc(
    [stroke(0, 0, [[10, 30], [60, 32]]), stroke(1, 100, [[10, 60], [60, 62]]), stroke(2, 200, [[80, 20], [90, 90]])],
    [
      { op: 'erase', ids: [1], t: 300 },
      { op: 'undo', t: 400 }, // 撤销擦除 → 笔画 1 回来
      { op: 'redo', t: 500 }, // 再擦
    ],
  );

  it('可见笔画与前端 replayVisibleIds 一致（含 erase/undo/redo/scratch）', () => {
    const cases: InkDoc[] = [
      d,
      doc([stroke(0, 0, [[0, 0], [5, 5]]), stroke(1, 50, [[0, 3], [9, 3]])], [{ op: 'undo', t: 100 }]),
      doc(
        [stroke(0, 0, [[0, 0], [5, 5]]), stroke(1, 50, [[0, 3], [9, 3]]), stroke(2, 60, [[1, 1], [8, 2]])],
        [{ op: 'scratch', ids: [0, 1], by: 2, t: 200 }, { op: 'undo', t: 300 }, { op: 'redo', t: 400 }],
      ),
    ];
    for (const c of cases) {
      const frontEnd = replayVisibleIds(c as never);
      expect(visibleStrokes(c).map((s) => s.id)).toEqual(frontEnd);
    }
  });

  it('decodeInk 读取 gzip+base64；坏数据给 InkError', () => {
    const out = decodeInk(b64(d));
    expect(out.doc.strokes).toHaveLength(3);
    expect(() => decodeInk('!!!')).toThrow(InkError);
    expect(() => decodeInk(Buffer.from('not gzip').toString('base64'))).toThrow(InkError);
    expect(() => decodeInk(b64({ v: 2 }))).toThrow(InkError);
    expect(() => decodeInk(b64({ ...d, strokes: [{ id: 0, p: 'laser', pts: [[0, 0, 0, 1]] }] }))).toThrow(InkError);
  });

  it('解压后过大 → too_large（gzip 炸弹）', () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20)).toString('base64');
    try {
      decodeInk(bomb);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InkError);
      expect((error as InkError).reason).toBe('too_large');
    }
  });

  it('inkStats', () => {
    const stats = inkStats(d);
    expect(stats).toMatchObject({ strokeCount: 3, pointCount: 6, pointerTypes: ['pen'] });
    expect(stats.durationMs).toBe(210);
  });
});

describe('栅格化（03 §3.1：黑笔白底，高 160，左右留 16）', () => {
  it('输出 PNG，高 160，宽 ≥ 2*16', () => {
    const out = rasterizeStrokes(visibleStrokes(doc([stroke(0, 0, [[10, 10], [100, 40], [200, 20]])])));
    expect(out).not.toBeNull();
    const png = out!.png;
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(out!.width);
    expect(png.readUInt32BE(20)).toBe(PNG_HEIGHT);
    expect(out!.width).toBeGreaterThanOrEqual(64);
  });

  it('单点笔画和水平细线也能出图；没有可见笔画返回 null', () => {
    expect(rasterizeStrokes([stroke(0, 0, [[5, 5]])])).not.toBeNull();
    expect(rasterizeStrokes([stroke(0, 0, [[0, 10], [300, 10]])])).not.toBeNull();
    expect(rasterizeStrokes([])).toBeNull();
  });
});

describe('diffTexts / editDistance', () => {
  it('前端 mock 约定：差异落在 {…} 里时报整个 \\frac', () => {
    const a = '$|a_n-3|=\\frac{5}{n+2}$';
    const b = '$|a_n-3|=\\frac{5}{n+z}$';
    expect(diffTexts(a, b)).toEqual([{ start: 9, end: 22, alt: '\\frac{5}{n+z}' }]);
  });

  it('canon 相同（\\dfrac 对 \\frac、空格）不算差异', () => {
    expect(diffTexts('$\\frac{1}{2}$', '$\\dfrac{1}{2}$')).toEqual([]);
    expect(diffTexts('$a + b$', '$a+b$')).toEqual([]);
  });

  it('单个字符不同：只报那一个字符', () => {
    expect(diffTexts('$N=5$', '$M=5$')).toEqual([{ start: 1, end: 2, alt: 'M' }]);
  });

  it('另一路多出内容：挂到相邻记号并保留 alt', () => {
    const spans = diffTexts('$x=1$', '$x=12$');
    expect(spans.length).toBe(1);
    const s = spans[0]!;
    const rebuilt = '$x=1$'.slice(0, s.start) + s.alt + '$x=1$'.slice(s.end);
    expect(canon(rebuilt)).toBe(canon('$x=12$'));
  });

  it('用 diff 还原另一路全文：canon 与交叉一致', () => {
    const pairs: [string, string][] = [
      ['任取 $\\varepsilon>0$，取 $N=5$', '任取 $\\varepsilon>0$，取 $N=6$'],
      ['$|a_n-3|<\\varepsilon$', '$|a_n-3|\\le\\varepsilon$'],
      ['$\\frac{5}{n+2}<\\varepsilon$', '$\\frac{5}{n+2}>\\varepsilon$'],
    ];
    for (const [a, b] of pairs) {
      const spans = diffTexts(a, b);
      expect(spans.length).toBeGreaterThan(0);
      let out = '';
      let pos = 0;
      for (const sp of spans) {
        out += a.slice(pos, sp.start) + sp.alt;
        pos = sp.end;
      }
      out += a.slice(pos);
      expect(canon(out)).toBe(canon(b));
    }
  });

  it('editDistance 以 canon 计：只差空格为 0', () => {
    expect(editDistance('$a + b$', '$a+b$')).toBe(0);
    expect(editDistance('$N=5$', '$N=6$')).toBe(1);
  });
});
