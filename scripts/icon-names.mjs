// Material Symbols 名稱抽取(單一實作,兩個消費者):
//   scripts/build-icon-font.mjs —— 產生 subset 字型時決定要包哪些字符
//   src/lib/iconFont.test.js    —— 守門:程式碼用到的名字必須在 manifest 裡
// 兩邊共用同一支抽取,才不會「build 抓得到、測試抓不到」各說各話。
//
// 策略:寬鬆收集 src 內所有 lowercase_underscore 字串字面值(icon 名的形狀),
// 再由 build script 用官方 codepoints 清單分流成 included(真圖示,進字型)與
// ignored(業務字串恰好同形,如 'contractor')。寬鬆收集寧可多不可漏——
// 漏掉的圖示在畫面上會渲染成原始英文字。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NAME_RE = /['"]([a-z][a-z0-9_]{2,})['"]/g

export function collectCandidates(srcDir) {
  const names = new Set()
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!/\.(jsx|js)$/.test(f) || /\.test\./.test(f)) continue
      const text = readFileSync(p, 'utf8')
      for (const m of text.matchAll(NAME_RE)) names.add(m[1])
    }
  }
  walk(srcDir)
  return [...names].sort()
}
