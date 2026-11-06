/**
 * 生成 PWA 图标：把小方（packages/ui-math 的 mascotSvg）铺到带品牌底色的方块上，写进 src/static/pwa/。
 * 产物提交进仓库；只有改了小方才需要重新运行（需要本机有 Chromium）：
 *
 *   PG_CHROMIUM=/path/to/chrome node scripts/gen-pwa-icons.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../src/static/pwa')
const iconsTs = path.resolve(here, '../../../packages/ui-math/src/design/icons.ts')

/** icons.ts 是纯字符串模板：用 TypeScript 转成 ESM 后导入，不必再维护一份小方。 */
async function loadMascotSvg() {
  const require = createRequire(import.meta.url)
  const ts = require('typescript')
  const js = ts.transpileModule(fs.readFileSync(iconsTs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const tmp = path.join(outDir, '.icons.tmp.mjs')
  fs.writeFileSync(tmp, js)
  try {
    return (await import(pathToFileURL(tmp).href)).mascotSvg
  } finally {
    fs.rmSync(tmp)
  }
}

/** SVG 里的 var(--x, #hex) 换成 hex：图标在 CSS 之外单独显示。 */
const flatten = (svg) => svg.replace(/var\(--[\w-]+,\s*(#[0-9a-fA-F]{3,8})\)/g, '$1')

function iconSvg(mascotSvg, size, paddingRatio) {
  const inner = Math.round(size * (1 - paddingRatio * 2))
  const offset = Math.round((size - inner) / 2)
  const mascot = flatten(mascotSvg('happy', inner))
    .replace('<svg ', `<svg x="${offset}" y="${offset}" `)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#d9f7f3"/>${mascot}</svg>`
}

async function main() {
  const executablePath = process.env.PG_CHROMIUM
  if (!executablePath) throw new Error('缺少 PG_CHROMIUM')
  fs.mkdirSync(outDir, { recursive: true })
  const mascotSvg = await loadMascotSvg()
  fs.writeFileSync(path.join(outDir, 'icon.svg'), iconSvg(mascotSvg, 512, 0.12))

  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  try {
    const outputs = [
      ['icon-192.png', 192, 0.12],
      ['icon-512.png', 512, 0.12],
      // maskable：安全区是中间 80%，四周多留一点
      ['icon-maskable-512.png', 512, 0.2],
      ['icon-180.png', 180, 0.12],
    ]
    for (const [file, size, padding] of outputs) {
      const page = await browser.newPage({ viewport: { width: size, height: size } })
      await page.setContent(`<!doctype html><body style="margin:0">${iconSvg(mascotSvg, size, padding)}</body>`)
      await page.screenshot({ path: path.join(outDir, file) })
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

await main()
