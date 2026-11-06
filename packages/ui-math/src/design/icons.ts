/**
 * v2 图标与角色 ∎ 小方（原创）。全部是静态 SVG 字符串，无用户输入，可安全 v-html。
 * 线条图标 24px、3px 圆头描边；灯泡/星为实心双层。颜色靠 currentColor（灯泡写死黄色语义）。
 */
export type IconName =
  | 'close' | 'back' | 'fwd' | 'check' | 'plus' | 'pen' | 'keys' | 'camera' | 'home' | 'book' | 'me'
  | 'lock' | 'clock' | 'flag' | 'eye' | 'help' | 'alert' | 'flash'

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
  eye: stroke('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>', 2.4),
  help: stroke(`<circle cx="12" cy="12" r="9" ${SOFT}/><path d="M9.5 9.6A2.6 2.6 0 1112.7 12c-.5.3-.7.7-.7 1.3M12 16.8h.01"/>`, 2.6),
  alert: stroke(`<path d="M12 4l9 15.5H3z" ${SOFT}/><path d="M12 10v4M12 17h.01"/>`, 2.6),
  flash: stroke('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" fill="currentColor" fill-opacity=".2"/>', 2.4),
}

const BULB = 'M12 2.2a7 7 0 00-4.1 12.7c.7.6 1.1 1.3 1.1 2.1v.7h6V17c0-.8.4-1.5 1.1-2.1A7 7 0 0012 2.2z'

/** tone: on=黄色实心（可用）；off=灰色描边（已用）；ink=深色实心（黄底上） */
export function bulbSvg(size = 24, tone: 'on' | 'off' | 'ink' = 'on'): string {
  if (tone === 'off') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${BULB}" fill="none" stroke="#afafaf" stroke-width="2"/><path d="M9 19.4h6M10.2 22h3.6" stroke="#afafaf" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
  }
  if (tone === 'ink') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${BULB}" fill="#4a3600"/><path d="M9 19.4h6M10.2 22h3.6" stroke="#4a3600" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${BULB}" fill="#ffc800"/><path d="M9.2 5.6a4.6 4.6 0 013.2-1.5" stroke="#fff" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M9 19.4h6M10.2 22h3.6" stroke="#e5b400" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
}

export function iconSvg(name: IconName, size = 24): string {
  return LINE[name](size)
}

/** ∎ QED 方块：路径节点“已完成”的面、证明末尾印章 */
export function qedSvg(size = 20, color = 'currentColor'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="15" height="15" rx="4.2" fill="${color}"/></svg>`
}

export type MascotExpr = 'idle' | 'think' | 'happy' | 'oops' | 'cheer'
export type MascotTone = 'sea' | 'bee' | 'grass'

const TONES: Record<MascotTone, [string, string]> = {
  sea: ['#1cb0f6', '#1899d6'],
  bee: ['#ffc800', '#e5b400'],
  grass: ['#58cc02', '#58a700'],
}

/** 角色 ∎ 小方（原创）：QED 方块长出脸。仅在 首页当前节点 / 助教抽屉 / 微课反馈 / 完成页 / 空状态 出场。 */
export function mascotSvg(expr: MascotExpr = 'idle', size = 96, tone: MascotTone = 'sea'): string {
  const [f, l] = TONES[tone]
  const eyeW = (cx: number) => `<ellipse cx="${cx}" cy="58" rx="14" ry="17" fill="#fff"/>`
  const pup = (cx: number, dx = 0, dy = 0, r: [number, number] = [7, 9]) =>
    `<ellipse cx="${cx + 2 + dx}" cy="${60 + dy}" rx="${r[0]}" ry="${r[1]}" fill="#1b2b34"/><circle cx="${cx + 4.4 + dx}" cy="${55 + dy}" r="2.6" fill="#fff"/>`
  const armPair = (a: string, b: string) => `${a}${b}`
  let eyes = ''
  let mouth = ''
  let extra = ''
  let arms = armPair(
    `<rect x="1" y="64" width="13" height="26" rx="6.5" fill="${l}" transform="rotate(14 7 77)"/>`,
    `<rect x="106" y="64" width="13" height="26" rx="6.5" fill="${l}" transform="rotate(-14 113 77)"/>`,
  )
  if (expr === 'idle') {
    eyes = eyeW(44) + eyeW(76) + pup(44) + pup(76)
    mouth = '<path d="M51 84q9 8 18 0" fill="none" stroke="#1b2b34" stroke-width="4.4" stroke-linecap="round"/>'
  } else if (expr === 'think') {
    eyes = eyeW(44) + eyeW(76) + pup(44, 4, -5) + pup(76, 4, -5) + '<path d="M30 38l24-5" stroke="#1b2b34" stroke-width="4.4" stroke-linecap="round"/>'
    mouth = '<ellipse cx="66" cy="86" rx="5" ry="4.2" fill="#1b2b34"/>'
    arms = armPair(
      `<rect x="1" y="64" width="13" height="26" rx="6.5" fill="${l}" transform="rotate(14 7 77)"/>`,
      `<rect x="84" y="86" width="13" height="26" rx="6.5" fill="${l}" transform="rotate(-62 90 99)"/>`,
    )
  } else if (expr === 'happy' || expr === 'cheer') {
    eyes = '<path d="M30 62q14-22 28 0M62 62q14-22 28 0" fill="none" stroke="#1b2b34" stroke-width="5.4" stroke-linecap="round"/>'
    mouth = '<path d="M46 78q14 0 28 0q-1 18-14 18t-14-18z" fill="#1b2b34"/><path d="M52 90q8-6 16 0q-3 5-8 5t-8-5z" fill="#ff6b7a"/>'
    if (expr === 'cheer') {
      arms = armPair(
        `<rect x="-2" y="30" width="13" height="30" rx="6.5" fill="${l}" transform="rotate(-24 4 45)"/>`,
        `<rect x="109" y="30" width="13" height="30" rx="6.5" fill="${l}" transform="rotate(24 115 45)"/>`,
      )
    }
  } else {
    eyes = eyeW(44) + eyeW(76) + pup(44, 0, 2, [5, 6.5]) + pup(76, 0, 2, [5, 6.5])
    mouth = '<path d="M48 90q4-8 9 0t9 0t9 0" fill="none" stroke="#1b2b34" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>'
    extra = '<path d="M100 6q10 14 0 22t-10-8q0-6 10-14z" fill="#bdebff" stroke="#fff" stroke-width="2"/>'
  }
  const cheeks = expr === 'oops' ? '' : '<circle cx="28" cy="80" r="6.5" fill="#ff8fa3" fill-opacity=".55"/><circle cx="92" cy="80" r="6.5" fill="#ff8fa3" fill-opacity=".55"/>'
  return `<svg width="${size}" height="${Math.round((size * 128) / 120)}" viewBox="-4 0 128 128" aria-hidden="true" focusable="false">
<ellipse cx="60" cy="121" rx="36" ry="5" fill="#000" fill-opacity=".1"/>
<rect x="32" y="102" width="22" height="16" rx="8" fill="${l}"/><rect x="66" y="102" width="22" height="16" rx="8" fill="${l}"/>
${arms}
<rect x="10" y="24" width="100" height="88" rx="34" fill="${l}"/>
<rect x="10" y="18" width="100" height="88" rx="34" fill="${f}"/>
<path d="M24 42q1-12 14-15" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="6" stroke-linecap="round"/>
${eyes}${cheeks}${mouth}${extra}</svg>`
}
