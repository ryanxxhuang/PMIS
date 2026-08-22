// 錯誤訊息外洩凍結測試(政府合規常駐基線:資通系統防護基準附表十構面五
// 「錯誤時使用者頁面僅顯示簡短訊息及代碼,不含詳細錯誤訊息」)。
//
// 規則:src/pages 與 src/components 的畫面層,不得把 raw error.message
// (可能含 Postgres 錯誤、constraint/RLS policy 名稱、edge function 原始回應)
// 直接放進使用者看得到的字串——一律改走 friendlyError(error, '情境 fallback')。
// 我們自己的業務規則訊息(P0001/繁中)friendlyError 會原樣放行,不會被蓋掉。
//
// 這支測試是「掃描式凍結」:全站已於 2026-08-22 收斂為 0,之後任何新增的
// raw 用法都會讓它紅——新 code 請用 friendlyError;真有例外(確定不上畫面)
// 才加進 WHITELIST,並在旁邊寫清楚為什麼安全。
//
// 已知限制:排除是「整行」判定——同一行裡同時有 friendlyError( 與另一個
// raw error.message 的寫法擋不到;console.error 行也整行放行。這兩種都靠
// code review 把關,掃描只負責抓最常見的「模板字串直塞」型態。
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/pages', 'src/components']

// error 形狀的接收者才算(error/err/e/*Error/*Err),result.message、snack.message
// 這類我們自己組好的顯示字串不在此列;String(e) 直轉字串同樣視為外洩。
const LEAK = /\b(?:error|err|e|[A-Za-z]*Error|[A-Za-z]*Err)\??\.message\b|String\(\s*(?:e|err|error)\b/
const SAFE = /console\.|friendlyError\(/

// 例外白名單:'相對路徑:行內容片段'。目前為空——新增前先想清楚該行為什麼
// 不會把原始錯誤帶上畫面。
const WHITELIST = new Set([])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.jsx') && !name.includes('.test.')) out.push(p)
  }
  return out
}

describe('畫面層 raw error.message 外洩凍結', () => {
  it('src/pages 與 src/components 不得直接顯示 raw error.message', () => {
    const offenders = []
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, i) => {
          if (!LEAK.test(line) || SAFE.test(line)) return
          const key = `${file}:${line.trim().slice(0, 60)}`
          if (WHITELIST.has(key)) return
          offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`)
        })
      }
    }
    expect(offenders,
      `以下位置疑似把 raw error.message 直接顯示給使用者,請改用 friendlyError(error, '情境 fallback')`
      + `(src/lib/errorMessage.js);確定安全的例外請加進本檔 WHITELIST:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
