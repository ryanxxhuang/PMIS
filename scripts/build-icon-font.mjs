// 產生 Material Symbols 的 subset 字型(self-host,零執行期外連)。
//
// 為什麼要 subset:@material-symbols/font-400 整包 ~480KB(3,800 枚字形),
// 全站實際只用 ~90 枚;工地弱網首載會先空白、再噴 ligature 英文字。
// Google Fonts css2 API 的 icon_names 參數可回傳只含指定字符的可變字型
// (保留 FILL 0..1 軸,選取態填滿靠它),約 30–60KB。
//
// 用法(開發期,需網路;產物 commit 進 repo,執行期不外連):
//   node scripts/build-icon-font.mjs
// 產物:
//   src/assets/material-symbols-pmis.woff2  subset 字型
//   src/assets/material-symbols.css         @font-face + .material-symbols-outlined
//   src/assets/material-symbols-names.json  manifest(included/ignored),
//                                           由 src/lib/iconFont.test.js 守門——
//                                           新增圖示忘記重跑本腳本會直接紅燈。
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { collectCandidates } from './icon-names.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const CODEPOINTS_URL = 'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints'

const candidates = collectCandidates(join(root, 'src'))

const cpText = await (await fetch(CODEPOINTS_URL)).text()
const official = new Set(cpText.split('\n').map((l) => l.split(' ')[0]).filter(Boolean))

const included = candidates.filter((n) => official.has(n))
const ignored = candidates.filter((n) => !official.has(n))
if (!included.length) throw new Error('抽不到任何圖示名,extraction 規則壞了?')

// icon_names 必須字母序,否則 css2 回 400
const cssUrl = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined'
  + ':opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
  + `&icon_names=${included.join(',')}&display=block`
const css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text()
const woffUrl = css.match(/src: url\((https:[^)]+)\) format\('woff2'\)/)?.[1]
if (!woffUrl) throw new Error(`css2 回應裡找不到 woff2 URL:\n${css.slice(0, 400)}`)
const woff2 = Buffer.from(await (await fetch(woffUrl)).arrayBuffer())

const outDir = join(root, 'src', 'assets')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'material-symbols-pmis.woff2'), woff2)
// @font-face 與 class 對齊套件原版;font-display: block——subset 檔小,
// 短暫 block 完全擋掉「先噴英文字再換圖」的閃爍
writeFileSync(join(outDir, 'material-symbols.css'), `/* 由 scripts/build-icon-font.mjs 產生,不要手改;新增圖示請重跑該腳本 */
@font-face {
  font-family: "Material Symbols Outlined";
  font-style: normal;
  font-weight: 100 700;
  font-display: block;
  src: url("./material-symbols-pmis.woff2") format("woff2");
}
.material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "liga";
}
`)
writeFileSync(join(outDir, 'material-symbols-names.json'),
  JSON.stringify({ generated_by: 'scripts/build-icon-font.mjs', included, ignored }, null, 2) + '\n')

console.log(`included ${included.length} icons(${(woff2.length / 1024).toFixed(1)} KB)、ignored ${ignored.length} 個同形業務字串`)
