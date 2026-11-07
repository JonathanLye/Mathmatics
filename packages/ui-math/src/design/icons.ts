/**
 * v3 图标与角色小方（原创）。全部是静态 SVG 字符串，无用户输入，可安全 v-html。
 * 线条图标 24px、圆头描边；颜色靠 currentColor。灯泡和角色走设计 token（带兜底值，脱离样式表也能画）。
 */
export type IconName =
  | 'close' | 'back' | 'fwd' | 'check' | 'plus' | 'pen' | 'keys' | 'camera' | 'home' | 'book' | 'me'
  | 'lock' | 'clock' | 'flag' | 'eye' | 'help' | 'alert' | 'flash'
  | 'path' | 'redo' | 'flame' | 'star' | 'logout' | 'sound' | 'motion' | 'vibrate' | 'sun' | 'moon' | 'auto' | 'chevron' | 'bug'

const stroke = (d: string, w = 3, fill = 'none') => (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`

const SOFT = 'fill="currentColor" fill-opacity=".16"'

const LINE: Record<IconName, (size: number) => string> = {
  close: stroke('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: stroke('<path d="M15 5l-7 7 7 7"/>'),
  fwd: stroke('<path d="M9 5l7 7-7 7"/>'),
  check: stroke('<path d="M5 12.5l4.6 4.6L19 7"/>', 3.6),
  plus: stroke('<path d="M12 5v14M5 12h14"/>', 3.4),
  pen: stroke(`<path d="M4 20l1.2-4.6L16.6 4a2.2 2.2 0 013.1 0l.3.3a2.2 2.2 0 010 3.1L8.6 18.8z" ${SOFT}/><path d="M14.6 6l3.4 3.4"/>`, 2.6),
  keys: stroke(`<rect x="2.5" y="6" width="19" height="12" rx="3.2" ${SOFT}/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>`, 2.6),
  camera: stroke(`<path d="M4 8.5A2.5 2.5 0 016.5 6h1.2l1.3-2h6l1.3 2h1.2A2.5 2.5 0 0120 8.5v8a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5z" ${SOFT}/><circle cx="12" cy="12.5" r="3.4"/>`, 2.6),
  home: stroke(`<path d="M4 11l8-7 8 7v8a1.5 1.5 0 01-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 014 19z" ${SOFT}/>`, 2.6),
  book: stroke(`<path d="M3.5 5.8c3-1.1 6-.9 8.5 1v12.4c-2.5-1.9-5.5-2.1-8.5-1z" ${SOFT}/><path d="M20.5 5.8c-3-1.1-6-.9-8.5 1v12.4c2.5-1.9 5.5-2.1 8.5-1z" ${SOFT}/>`, 2.6),
  me: stroke(`<circle cx="12" cy="8.5" r="4" ${SOFT}/><path d="M4.5 20a7.5 7.5 0 0115 0z" ${SOFT}/>`, 2.6),
  lock: stroke(`<rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor" fill-opacity=".2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>`, 2.6),
  clock: stroke('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 2.6),
  flag: stroke(`<path d="M6 21V4M6 5h11l-2.2 3.6L17 12H6" ${SOFT}/>`, 2.6),
  // 瓢虫：圆圆的壳、一条中缝、两粒斑点、两根触角和三对小脚（捉虫小能手的奖章图标）
  bug: stroke(`<path d="M12 8.4c-3.2 0-5.6 2.5-5.6 5.8S8.8 20 12 20s5.6-2.5 5.6-5.8S15.2 8.4 12 8.4z" ${SOFT}/><path d="M12 8.4V20M9.2 6.6c.4-1.3 1.5-2.2 2.8-2.2s2.4.9 2.8 2.2M9.6 4.6L8.3 3M14.4 4.6L15.7 3M3.8 11.2l3 1.1M20.2 11.2l-3 1.1M3.8 17.6l3-1.3M20.2 17.6l-3-1.3"/><path d="M9.4 12.6h.01M14.6 12.6h.01M9.6 16.2h.01M14.4 16.2h.01" stroke-width="3.6"/>`, 2.2),
  eye: stroke('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>', 2.4),
  help: stroke(`<circle cx="12" cy="12" r="9" ${SOFT}/><path d="M9.5 9.6A2.6 2.6 0 1112.7 12c-.5.3-.7.7-.7 1.3M12 16.8h.01"/>`, 2.6),
  alert: stroke(`<path d="M12 4l9 15.5H3z" ${SOFT}/><path d="M12 10v4M12 17h.01"/>`, 2.6),
  flash: stroke('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" fill="currentColor" fill-opacity=".2"/>', 2.4),
  path: stroke('<circle cx="6.5" cy="19" r="2.5" fill="currentColor" fill-opacity=".2"/><circle cx="17.5" cy="5" r="2.5" fill="currentColor" fill-opacity=".2"/><path d="M9 19h6.5a3.5 3.5 0 000-7h-7a3.5 3.5 0 010-7H15"/>', 2.6),
  redo: stroke('<path d="M4.5 12a7.5 7.5 0 0113-5.1L20 9.5M20 4.5v5h-5"/><path d="M19.5 12a7.5 7.5 0 01-13 5.1L4 14.5M4 19.5v-5h5"/>', 2.6),
  flame: stroke(`<path d="M12 3c.6 3.4 5.5 5.7 5.5 11a5.5 5.5 0 01-11 0c0-2 1-3.4 2.2-4.6.3 1.5 1 2.4 2 2.8C10.3 9 10.7 5.6 12 3z" ${SOFT}/>`, 2.6),
  star: stroke(`<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" ${SOFT}/>`, 2.4),
  logout: stroke('<path d="M10 4H6.5A2.5 2.5 0 004 6.5v11A2.5 2.5 0 006.5 20H10M15 8l4 4-4 4M19 12H9.5"/>', 2.6),
  sound: stroke(`<path d="M4 9.5v5h3.5l5 4.5V5l-5 4.5z" ${SOFT}/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>`, 2.4),
  motion: stroke('<path d="M3.5 8h9M3.5 16h6"/><path d="M15 4.5l5.5 7.5-5.5 7.5"/>', 2.6),
  vibrate: stroke(`<rect x="8" y="4" width="8" height="16" rx="2.5" ${SOFT}/><path d="M4.5 9v6M19.5 9v6"/>`, 2.6),
  sun: stroke(`<circle cx="12" cy="12" r="4" ${SOFT}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>`, 2.4),
  moon: stroke(`<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" ${SOFT}/>`, 2.6),
  auto: stroke('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none"/>', 2.4),
  chevron: stroke('<path d="M9 5l7 7-7 7"/>', 3),
}

const BULB = 'M12 2.2a7 7 0 00-4.1 12.7c.7.6 1.1 1.3 1.1 2.1v.7h6V17c0-.8.4-1.5 1.1-2.1A7 7 0 0012 2.2z'

/** tone: on=金色实心（可用）；off=灰色描边（已用）；ink=深色实心（金色底上）。 */
export function bulbSvg(size = 24, tone: 'on' | 'off' | 'ink' = 'on'): string {
  if (tone === 'off') {
    const c = 'var(--ink-3, #8b99a5)'
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${BULB}" fill="none" stroke="${c}" stroke-width="2"/><path d="M9 19.4h6M10.2 22h3.6" stroke="${c}" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
  }
  if (tone === 'ink') {
    const c = 'var(--on-bee, #3d2c00)'
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${BULB}" fill="${c}"/><path d="M9 19.4h6M10.2 22h3.6" stroke="${c}" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${BULB}" fill="var(--bee, #ffc233)"/><path d="M9.2 5.6a4.6 4.6 0 013.2-1.5" stroke="var(--shine, #ffffff)" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M9 19.4h6M10.2 22h3.6" stroke="var(--bee-lip, #d99a00)" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
}

export function iconSvg(name: IconName, size = 24): string {
  return LINE[name](size)
}

/** ∎ QED 方块：路径节点“已完成”的面、证明末尾印章 */
export function qedSvg(size = 20, color = 'currentColor'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="15" height="15" rx="4.2" fill="${color}"/></svg>`
}

export type MascotExpr = 'idle' | 'think' | 'happy' | 'oops' | 'cheer' | 'sleepy'
export type MascotTone = 'indigo' | 'sea' | 'bee' | 'grass'

export const MASCOT_EXPRESSIONS: readonly MascotExpr[] = ['idle', 'think', 'happy', 'oops', 'cheer', 'sleepy']

const TONES: Record<MascotTone, [string, string]> = {
  indigo: ['var(--indigo, #5b6cff)', 'var(--indigo-lip, #4152d9)'],
  sea: ['var(--sea, #4c8dff)', 'var(--sea-lip, #2f6fde)'],
  bee: ['var(--bee, #ffc233)', 'var(--bee-lip, #d99a00)'],
  grass: ['var(--accent, #0fb5a6)', 'var(--accent-lip, #0b8e83)'],
}

const INK = 'var(--mascot-ink, #1c2252)'
const WHITE = 'var(--mascot-eye, #ffffff)'
const CHEEK = 'var(--mascot-cheek, #ff9db0)'
const DROP = 'var(--mascot-drop, #a8d4ff)'
const SPARK = 'var(--bee, #ffc233)'

/** 一只睁开的眼：白底 + 瞳孔 + 高光；dx/dy 让视线转向。 */
function openEye(cx: number, dx = 0, dy = 0, rx = 6.5, ry = 8): string {
  return `<ellipse cx="${cx}" cy="54" rx="12" ry="14" fill="${WHITE}"/><ellipse cx="${cx + 1 + dx}" cy="${55 + dy}" rx="${rx}" ry="${ry}" fill="${INK}"/><circle cx="${cx + 3 + dx}" cy="${51 + dy}" r="2.2" fill="${WHITE}"/>`
}

const HAPPY_EYES = `<path d="M32 58q12-17 24 0M64 58q12-17 24 0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`

function restArms(lip: string): [string, string] {
  return [
    `<rect x="4" y="58" width="13" height="28" rx="6.5" fill="${lip}" transform="rotate(12 10 72)"/>`,
    `<rect x="103" y="58" width="13" height="28" rx="6.5" fill="${lip}" transform="rotate(-12 110 72)"/>`,
  ]
}

interface MascotParts {
  eyes: string
  mouth: string
  extra: string
  arms: [string, string]
  cheeks: boolean
}

function mascotParts(expr: MascotExpr, lip: string): MascotParts {
  const rest = restArms(lip)
  switch (expr) {
    case 'think':
      return {
        eyes: openEye(44, 3.5, -4) + openEye(76, 3.5, -4),
        mouth: `<ellipse cx="66" cy="81" rx="4.5" ry="3.8" fill="${INK}"/>`,
        extra: `<path d="M33 35l20-4" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="101" cy="22" r="3" fill="${lip}"/><circle cx="109" cy="12" r="4.5" fill="${lip}"/>`,
        arms: [rest[0], `<rect x="84" y="78" width="13" height="26" rx="6.5" fill="${lip}" transform="rotate(-58 90 91)"/>`],
        cheeks: true,
      }
    case 'happy':
      return {
        eyes: HAPPY_EYES,
        mouth: `<path d="M47 73h26q-1.5 16-13 16t-13-16z" fill="${INK}"/><path d="M53 84q7-5 14 0-3 5-7 5t-7-5z" fill="${CHEEK}"/>`,
        extra: '',
        arms: rest,
        cheeks: true,
      }
    case 'cheer':
      return {
        eyes: HAPPY_EYES,
        mouth: `<path d="M44 71h32q-1 21-16 21t-16-21z" fill="${INK}"/><path d="M51 85q9-6 18 0-3 7-9 7t-9-7z" fill="${CHEEK}"/>`,
        extra: `<path d="M12 12l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM108 4l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="${SPARK}"/>`,
        arms: [
          `<rect x="0" y="24" width="13" height="32" rx="6.5" fill="${lip}" transform="rotate(-22 6 40)"/>`,
          `<rect x="107" y="24" width="13" height="32" rx="6.5" fill="${lip}" transform="rotate(22 113 40)"/>`,
        ],
        cheeks: true,
      }
    case 'oops':
      return {
        eyes: openEye(44, 0, 3, 5, 6) + openEye(76, 0, 3, 5, 6),
        mouth: `<path d="M50 84q5-6 10 0t10 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
        extra: `<path d="M34 38l18-5M86 38l-18-5" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M99 22q7 10 0 15.5t-7-5.5q0-4 7-10z" fill="${DROP}"/>`,
        arms: rest,
        cheeks: false,
      }
    case 'sleepy':
      return {
        eyes: `<path d="M33 56q11 8 22 0M65 56q11 8 22 0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
        mouth: `<ellipse cx="60" cy="80" rx="4.5" ry="3" fill="${INK}"/>`,
        extra: `<path d="M94 14h11l-11 12h11M110 2h7l-7 8h7" fill="none" stroke="${lip}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
        arms: rest,
        cheeks: true,
      }
    default:
      return {
        eyes: openEye(44) + openEye(76),
        mouth: `<path d="M51 77q9 8 18 0" fill="none" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/>`,
        extra: '',
        arms: rest,
        cheeks: true,
      }
  }
}

/**
 * 角色小方（原创）：QED 方块 ∎ 长出脸，靛蓝身子、硬下唇，轮廓干净。
 * 表情是静态 SVG；动作由 PgMascot.vue 的 CSS 作用在 .pgm-* 分组上（眨眼、呼吸、跳跃……）。
 */
export function mascotSvg(expr: MascotExpr = 'idle', size = 96, tone: MascotTone = 'indigo'): string {
  const [body, lip] = TONES[tone]
  const { eyes, mouth, extra, arms, cheeks } = mascotParts(expr, lip)
  const cheekMarks = cheeks
    ? `<circle cx="29" cy="72" r="6" fill="${CHEEK}" fill-opacity=".6"/><circle cx="91" cy="72" r="6" fill="${CHEEK}" fill-opacity=".6"/>`
    : ''
  return `<svg width="${size}" height="${Math.round((size * 128) / 120)}" viewBox="0 0 120 128" aria-hidden="true" focusable="false"><ellipse cx="60" cy="122" rx="34" ry="4.5" fill="var(--ink, #23303a)" fill-opacity=".1"/><g class="pgm-figure"><rect x="33" y="102" width="20" height="17" rx="8" fill="${lip}"/><rect x="67" y="102" width="20" height="17" rx="8" fill="${lip}"/><g class="pgm-arm pgm-arm-l">${arms[0]}</g><g class="pgm-arm pgm-arm-r">${arms[1]}</g><rect x="14" y="20" width="92" height="88" rx="26" fill="${lip}"/><rect x="14" y="14" width="92" height="88" rx="26" fill="${body}"/><path d="M27 37q1-10 11-12" fill="none" stroke="var(--shine, #ffffff)" stroke-width="5" stroke-linecap="round"/><g class="pgm-eyes">${eyes}</g>${cheekMarks}${mouth}<g class="pgm-extra">${extra}</g></g></svg>`
}
