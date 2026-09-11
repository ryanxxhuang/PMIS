// P-05 欄式編碼的等價護欄:rehydrate(compact) 必須與原 workItems.json 完全相同。
// 若 scripts/import_boq.py 重新產出標單而忘了跑 scripts/compact_workitems.py,
// 這裡會紅——demo 站吃的是 compact,兩檔不同步=demo 資料悄悄過期。
//
// 斷言順序刻意分三層(筆數 → 整體指紋 → 逐項差異摘要):原本用 for 迴圈逐項
// expect,3,262 項只要有一項不合就在第一筆炸掉,訊息看不出「是漏跑 compact
// 腳本(整份都不一樣)還是標單真的改了(只差幾項)」。
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { rehydrateWorkItems } from './boqCalc.js'
import original from '../data/workItems.json'
import compact from '../data/workItems.compact.json'

const RESYNC = '請重跑 scripts/compact_workitems.py 讓 workItems.compact.json 追上 workItems.json'

// 鍵序不算差異(rehydrate 的欄位順序與 workItems.json 本來就不同,原本的 toEqual
// 也不看鍵序),所以字串化前先把鍵排序,指紋才只反映「值」的差異。
const canon = (o) => (o ? JSON.stringify(o, Object.keys(o).sort()) : JSON.stringify(o))
const fingerprint = (items) => createHash('sha256').update(items.map(canon).join('\n')).digest('hex')

// 不合時要能一眼判讀:差幾項、第一批差在哪個 item_key 的哪個欄位
function diffSummary(got, want, limit = 3) {
  const diffs = []
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const a = got[i], b = want[i]
    if (canon(a) === canon(b)) continue
    const fields = a && b
      ? [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        .map((k) => `${k}: compact=${JSON.stringify(a[k])} / json=${JSON.stringify(b[k])}`)
      : [a ? 'compact 多出這一項' : 'compact 缺這一項']
    diffs.push({ index: i, item_key: (a || b)?.item_key ?? '(無)', fields })
  }
  const head = diffs.slice(0, limit)
    .map((d) => `  #${d.index} ${d.item_key} → ${d.fields.join('; ')}`).join('\n')
  return `共 ${diffs.length} / ${want.length} 項不一致(列出前 ${head ? Math.min(limit, diffs.length) : 0} 筆):\n${head}\n${RESYNC}`
}

describe('workItems 欄式編碼等價性', () => {
  it('meta 完全相同', () => {
    expect(compact.meta, RESYNC).toEqual(original.meta)
  })

  it('項數相同(先比總數:差在筆數就是漏跑 compact 腳本或標單增刪項)', () => {
    const { items } = rehydrateWorkItems(compact)
    expect(items.length, `compact ${items.length} 項 vs workItems.json ${original.items.length} 項。${RESYNC}`)
      .toBe(original.items.length)
  })

  it('整份內容指紋相同(不合時列出差異項數與前幾筆欄位差)', () => {
    const { items } = rehydrateWorkItems(compact)
    const got = fingerprint(items)
    const want = fingerprint(original.items)
    if (got !== want) throw new Error(diffSummary(items, original.items))
    expect(got).toBe(want)
  })
})

// 護欄的護欄:上面那支測試靠 diffSummary 說人話,摘要本身壞了等於沒測到。
describe('diffSummary(不合時的失敗訊息)', () => {
  const base = [{ item_key: 'A1', quantity: 1 }, { item_key: 'A2', quantity: 2 }]

  it('單一欄位差:指出 item_key、欄名與兩邊的值', () => {
    const msg = diffSummary([{ item_key: 'A1', quantity: 1 }, { item_key: 'A2', quantity: 99 }], base)
    expect(msg).toContain('共 1 / 2 項不一致')
    expect(msg).toContain('A2')
    expect(msg).toContain('quantity: compact=99 / json=2')
    expect(msg).toContain('compact_workitems.py')
  })

  it('筆數不同:多出/缺少的那一項也要點名,不能只噴 undefined', () => {
    expect(diffSummary([base[0]], base)).toContain('compact 缺這一項')
    expect(diffSummary([...base, { item_key: 'A3' }], base)).toContain('compact 多出這一項')
  })

  it('整份都不一樣時,差異數等於總項數(足以判斷是漏跑腳本而非個別改標單)', () => {
    const msg = diffSummary(base.map((b) => ({ ...b, quantity: 0 })), base)
    expect(msg).toContain('共 2 / 2 項不一致')
    expect(msg.split('\n').filter((l) => l.startsWith('  #'))).toHaveLength(2)
  })
})
