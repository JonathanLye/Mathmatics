// ink-v1 解码与栅格化（03 §2.1、§3.1 第 1 步）。
// 重放规则（哪些笔画还"可见"）与前端 packages/ui-math/src/ink.ts 的 replayVisibleIds 逐行等价；
// test/recognition-ink.test.ts 里有与前端实现的一致性测试，改一边必须同步另一边。
// 服务端不 import ui-math：那是 Vue 组件包，镜像里不应带上它。
import { gunzipSync } from 'node:zlib';

import { Resvg } from '@resvg/resvg-js';

export type InkPoint = [number, number, number, number];
export type InkPointer = 'pen' | 'touch' | 'mouse';
export interface InkStroke {
  id: number;
  p: InkPointer;
  pts: InkPoint[];
}
export type InkOp =
  | { op: 'erase'; ids: number[]; t: number }
  | { op: 'scratch'; ids: number[]; by: number; t: number }
  | { op: 'undo'; t: number }
  | { op: 'redo'; t: number };
export interface InkDoc {
  v: 1;
  w: number;
  h: number;
  dpr: number;
  t0: number;
  orientation: 'portrait' | 'landscape';
  fullscreen: boolean;
  strokes: InkStroke[];
  ops: InkOp[];
}

export class InkError extends Error {
  readonly reason: 'invalid' | 'too_large';

  constructor(reason: 'invalid' | 'too_large') {
    super(reason);
    this.name = 'InkError';
    this.reason = reason;
  }
}

// 请求体上限是 256KB（base64）；解压后的上限防 gzip 炸弹。
export const MAX_INK_JSON_BYTES = 4 * 1024 * 1024;
const MAX_STROKES = 400;
const MAX_POINTS = 60_000;
const MAX_CANVAS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function intIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((id) => finite(id) && Number.isInteger(id))) throw new InkError('invalid');
  return value as number[];
}

export function normalizeInk(raw: unknown): InkDoc {
  if (!isRecord(raw) || raw.v !== 1) throw new InkError('invalid');
  const { w, h, dpr, t0, orientation, fullscreen } = raw;
  if (!finite(w) || w <= 0 || w > MAX_CANVAS || !finite(h) || h <= 0 || h > MAX_CANVAS) throw new InkError('invalid');
  if (!finite(dpr) || dpr <= 0 || !finite(t0) || t0 < 0) throw new InkError('invalid');
  if (orientation !== 'portrait' && orientation !== 'landscape') throw new InkError('invalid');
  if (typeof fullscreen !== 'boolean') throw new InkError('invalid');
  if (!Array.isArray(raw.strokes) || raw.strokes.length > MAX_STROKES) throw new InkError('invalid');

  let points = 0;
  const seen = new Set<number>();
  const strokes: InkStroke[] = raw.strokes.map((item: unknown) => {
    if (!isRecord(item) || !finite(item.id) || !Number.isInteger(item.id) || item.id < 0 || seen.has(item.id)) {
      throw new InkError('invalid');
    }
    seen.add(item.id);
    if (item.p !== 'pen' && item.p !== 'touch' && item.p !== 'mouse') throw new InkError('invalid');
    if (!Array.isArray(item.pts) || item.pts.length === 0) throw new InkError('invalid');
    points += item.pts.length;
    if (points > MAX_POINTS) throw new InkError('too_large');
    const pts = item.pts.map((pt: unknown): InkPoint => {
      if (!Array.isArray(pt) || pt.length < 4 || !pt.slice(0, 4).every(finite)) throw new InkError('invalid');
      return [pt[0] as number, pt[1] as number, pt[2] as number, pt[3] as number];
    });
    return { id: item.id, p: item.p, pts };
  });

  let ops: InkOp[] = [];
  if (raw.ops !== undefined) {
    if (!Array.isArray(raw.ops) || raw.ops.length > 5000) throw new InkError('invalid');
    ops = raw.ops.map((item: unknown): InkOp => {
      if (!isRecord(item)) throw new InkError('invalid');
      const t = finite(item.t) && item.t >= 0 ? Math.round(item.t) : 0;
      if (item.op === 'erase') return { op: 'erase', ids: intIds(item.ids), t };
      if (item.op === 'scratch') {
        if (!finite(item.by) || !Number.isInteger(item.by)) throw new InkError('invalid');
        return { op: 'scratch', ids: intIds(item.ids), by: item.by, t };
      }
      if (item.op === 'undo' || item.op === 'redo') return { op: item.op, t };
      throw new InkError('invalid');
    });
  }
  return { v: 1, w, h, dpr, t0, orientation, fullscreen, strokes, ops };
}

// 请求里的 ink：gzip(JSON) 的 base64。返回解析后的文档和原始 gzip 字节（入库用）。
export function decodeInk(base64: string): { doc: InkDoc; gz: Buffer } {
  if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new InkError('invalid');
  const gz = Buffer.from(base64, 'base64');
  let json: string;
  try {
    json = gunzipSync(gz, { maxOutputLength: MAX_INK_JSON_BYTES }).toString('utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new InkError(code === 'ERR_BUFFER_TOO_LARGE' ? 'too_large' : 'invalid');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new InkError('invalid');
  }
  return { doc: normalizeInk(raw), gz };
}

// —— 重放（等价于 ui-math replayVisibleIds）

type Action = { kind: 'add' | 'erase' | 'scratch'; ids: number[] };
type ReplayEvent = { t: number; order: number; index: number; strokeId?: number; op?: InkOp };

function strokeStartT(stroke: InkStroke): number {
  return stroke.pts[0]?.[2] ?? 0;
}

function removeLastAdd(stack: Action[], strokeId: number): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    const action = stack[i];
    if (action && action.kind === 'add' && action.ids[0] === strokeId) {
      stack.splice(i, 1);
      return;
    }
  }
}

function apply(visible: Set<number>, action: Action, reverse: boolean): void {
  if (action.kind === 'add') {
    const id = action.ids[0];
    if (id === undefined) return;
    if (reverse) visible.delete(id);
    else visible.add(id);
    return;
  }
  for (const id of action.ids) {
    if (reverse) visible.add(id);
    else visible.delete(id);
  }
}

export function visibleStrokes(doc: InkDoc): InkStroke[] {
  const events: ReplayEvent[] = [];
  doc.strokes.forEach((stroke, index) => events.push({ t: strokeStartT(stroke), order: 0, index, strokeId: stroke.id }));
  doc.ops.forEach((op, index) => events.push({ t: op.t, order: 1, index, op }));
  events.sort((a, b) => a.t - b.t || a.order - b.order || a.index - b.index);

  const visible = new Set<number>();
  const undoStack: Action[] = [];
  const redoStack: Action[] = [];
  for (const event of events) {
    if (event.strokeId !== undefined) {
      visible.add(event.strokeId);
      undoStack.push({ kind: 'add', ids: [event.strokeId] });
      redoStack.length = 0;
      continue;
    }
    const op = event.op;
    if (!op) continue;
    if (op.op === 'erase') {
      for (const id of op.ids) visible.delete(id);
      undoStack.push({ kind: 'erase', ids: [...op.ids] });
      redoStack.length = 0;
    } else if (op.op === 'scratch') {
      for (const id of op.ids) visible.delete(id);
      visible.delete(op.by);
      removeLastAdd(undoStack, op.by);
      undoStack.push({ kind: 'scratch', ids: [...op.ids] });
      redoStack.length = 0;
    } else if (op.op === 'undo') {
      const action = undoStack.pop();
      if (!action) continue;
      apply(visible, action, true);
      redoStack.push(action);
    } else {
      const action = redoStack.pop();
      if (!action) continue;
      apply(visible, action, false);
      undoStack.push(action);
    }
  }
  return doc.strokes.filter((stroke) => visible.has(stroke.id));
}

// —— 栅格化：黑笔白底，高 160 px，左右各留 16 px（03 §3.1）

export const PNG_HEIGHT = 160;
export const PNG_PAD_X = 16;
const PAD_Y = 16;
const INNER_H = PNG_HEIGHT - 2 * PAD_Y;
const MAX_UPSCALE = 3;
const MAX_WIDTH = 4000;
const MIN_WIDTH = 64;
const STROKE_WIDTH = 5.5;

function r1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function strokePath(points: [number, number][]): string {
  const dedup: [number, number][] = [];
  for (const pt of points) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 0.3) dedup.push(pt);
  }
  const first = dedup[0];
  if (!first) return '';
  if (dedup.length === 1) return `M${r1(first[0])} ${r1(first[1])}l0.01 0`;
  let d = `M${r1(first[0])} ${r1(first[1])}`;
  for (let i = 1; i < dedup.length - 1; i++) {
    const cur = dedup[i] as [number, number];
    const next = dedup[i + 1] as [number, number];
    d += `Q${r1(cur[0])} ${r1(cur[1])} ${r1((cur[0] + next[0]) / 2)} ${r1((cur[1] + next[1]) / 2)}`;
  }
  const last = dedup[dedup.length - 1] as [number, number];
  return `${d}L${r1(last[0])} ${r1(last[1])}`;
}

export interface RasterResult {
  png: Buffer;
  width: number;
  height: number;
}

// 没有可见笔画返回 null（"空行"，不调用识别服务）。
export function rasterizeStrokes(strokes: InkStroke[]): RasterResult | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const pt of stroke.pts) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
  }
  if (!Number.isFinite(minX)) return null;

  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  let scale = Math.min(INNER_H / bh, MAX_UPSCALE);
  if (bw * scale + 2 * PNG_PAD_X > MAX_WIDTH) scale = (MAX_WIDTH - 2 * PNG_PAD_X) / bw;
  const width = Math.max(Math.ceil(bw * scale + 2 * PNG_PAD_X), MIN_WIDTH);
  const offsetX = PNG_PAD_X + (width - 2 * PNG_PAD_X - bw * scale) / 2;
  const offsetY = PAD_Y + (INNER_H - bh * scale) / 2;

  const paths = strokes
    .map((stroke) => strokePath(stroke.pts.map((pt): [number, number] => [offsetX + (pt[0] - minX) * scale, offsetY + (pt[1] - minY) * scale])))
    .filter((d) => d !== '')
    .map((d) => `<path d="${d}"/>`)
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${PNG_HEIGHT}" viewBox="0 0 ${width} ${PNG_HEIGHT}">` +
    `<rect width="${width}" height="${PNG_HEIGHT}" fill="#fff"/>` +
    `<g fill="none" stroke="#000" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  return { png: Buffer.from(png), width, height: PNG_HEIGHT };
}

export function inkStats(doc: InkDoc): { strokeCount: number; pointCount: number; durationMs: number; pointerTypes: string[] } {
  let points = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  const types = new Set<string>();
  for (const stroke of doc.strokes) {
    types.add(stroke.p);
    points += stroke.pts.length;
    for (const pt of stroke.pts) {
      if (pt[2] < minT) minT = pt[2];
      if (pt[2] > maxT) maxT = pt[2];
    }
  }
  return {
    strokeCount: doc.strokes.length,
    pointCount: points,
    durationMs: Number.isFinite(minT) ? Math.max(0, Math.round(maxT - minT)) : 0,
    pointerTypes: [...types].sort(),
  };
}
