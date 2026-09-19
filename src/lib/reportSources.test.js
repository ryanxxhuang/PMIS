import { describe, it, expect } from 'vitest'
import { splitBySignature, unsignedDays, aggregateDailyLogs, inspectionsOfMonth, confirmationsOfMonth } from './reportSources.js'
import { signedVersionIndex } from './fieldDocs.js'

const sig = (target, date, v = 1) => ({
  document_id: `DOC-${target}`, doc_type: 'daily_log', doc_date: date, doc_status: 'signed', target_id: target,
  version_no: v, content_hash: 'b'.repeat(64), signer_name_snapshot: '廠商', signed_at: `${date}T10:00:00+00:00`,
})

// 兩份已簽署(A、B)＋一份未簽署(C,事實列存在但沒有任何簽署列指向)
const logs = [
  { id: 'A', log_date: '2026-09-02', weather_am: '晴', labor: [{ type: '鋼筋工', count: 6 }, { type: '模板工', count: 4 }], items: { '1.1': 10, '1.2': 5 } },
  { id: 'B', log_date: '2026-09-03', weather_pm: '陣雨', labor: [{ type: '鋼筋工', count: 5 }], items: { '1.1': 20 } },
  { id: 'C', log_date: '2026-09-04', weather_am: '雨', labor: [{ type: '雜工', count: 9 }], items: { '1.1': 999 } },
  { id: 'Z', log_date: '2026-08-30', labor: [], items: { '1.1': 7 } },
]
const index = signedVersionIndex([sig('A', '2026-09-02'), sig('B', '2026-09-03', 2), sig('Z', '2026-08-30')])

describe('splitBySignature', () => {
  it('依簽署索引分已簽署／未簽署,只取該月、按日期排序,已簽署附版本', () => {
    const { signed, unsigned } = splitBySignature(logs, index, { month: '2026-09' })
    expect(signed.map((l) => l.id)).toEqual(['A', 'B'])
    expect(signed[1].ref).toMatchObject({ document_id: 'DOC-B', version_no: 2 })
    expect(unsigned.map((l) => l.id)).toEqual(['C'])
  })
  it('空索引=全部未簽署(讀取失敗或示範模式不得當成已簽署)', () => {
    expect(splitBySignature(logs, new Map(), { month: '2026-09' }).signed).toEqual([])
  })
})

describe('aggregateDailyLogs', () => {
  it('兩份已簽署＋一份未簽署:數量、出工、雨天只算已簽署兩份;累計含前月已簽署', () => {
    const month = splitBySignature(logs, index, { month: '2026-09' }).signed
    const cum = splitBySignature(logs, index).signed
    const a = aggregateDailyLogs(month, cum)
    expect(a.workDays).toBe(2)
    expect(a.rainDays).toBe(1) // B 下午陣雨;C 下雨但未簽署
    expect(a.qtyMonth.get('1.1')).toBe(30) // 999 未簽署不列入
    expect(a.qtyMonth.get('1.2')).toBe(5)
    expect(a.qtyCum.get('1.1')).toBe(37) // 8/30 已簽署 7 + 本月 30
    expect(a.laborTotal).toBe(15)
    expect(a.labor).toEqual([{ type: '鋼筋工', count: 11 }, { type: '模板工', count: 4 }])
  })
})

describe('unsignedDays', () => {
  it('未簽署事實列標舊流程或文件狀態;同月尚無事實列的活草稿也列入;已簽署日期不出現', () => {
    const { signed, unsigned } = splitBySignature(logs, index, { month: '2026-09' })
    const openDocs = [
      { id: 'D4', doc_type: 'daily_log', doc_date: '2026-09-04', status: 'pending_input' },
      { id: 'D5', doc_type: 'daily_log', doc_date: '2026-09-05', status: 'draft' },
      { id: 'D2', doc_type: 'daily_log', doc_date: '2026-09-02', status: 'draft' }, // 簽後更正草稿:日期已簽署
      { id: 'D6', doc_type: 'daily_log', doc_date: '2026-09-06', status: 'signed' }, // 已簽署但事實列尚未載入:不列未簽署
      { id: 'S7', doc_type: 'supervisor_log', doc_date: '2026-09-07', status: 'draft' },
    ]
    const inRange = (d) => (d || '').startsWith('2026-09')
    const signedDates = new Set(signed.map((l) => l.log_date))
    const out = unsignedDays({ unsignedRows: unsigned, signedDates, openDocs, docType: 'daily_log', inRange })
    expect(out.map((u) => [u.date, u.legacy, u.doc?.id ?? null])).toEqual([
      ['2026-09-04', false, 'D4'], ['2026-09-05', false, 'D5'],
    ])
    const legacyOnly = unsignedDays({ unsignedRows: unsigned, signedDates, openDocs: [], docType: 'daily_log', inRange })
    expect(legacyOnly).toEqual([{ date: '2026-09-04', doc: null, legacy: true }])
  })
})

describe('inspectionsOfMonth', () => {
  const insp = [
    { id: 'I1', status: '部分合格', requested_date: '2026-09-01', document_id: 'F1' },
    { id: 'I2', status: '合格', requested_date: '2026-08-20', inspected_at: '2026-08-31T17:30:00Z', document_id: 'F2' }, // 台北 9/1 判定
    { id: 'I3', status: '不合格', requested_date: '2026-09-02' }, // 快速判定
    { id: 'I4', status: '待查驗', requested_date: '2026-09-03' },
    { id: 'I5', status: '待查驗', requested_date: '2026-07-01' },
  ]
  it('本月申請或判定;判定只算經簽署查驗表單者,快速判定另列;待查驗為現況', () => {
    const r = inspectionsOfMonth(insp, '2026-09', new Map([['I1', { version_no: 3 }]]))
    expect(r.list.map((i) => i.id)).toEqual(['I1', 'I2', 'I3', 'I4'])
    expect([r.pass, r.partial, r.fail]).toEqual([1, 1, 0])
    expect(r.unsigned.map((i) => i.id)).toEqual(['I3'])
    expect(r.signed.find((i) => i.id === 'I1').ref).toEqual({ version_no: 3 })
    expect(r.signed.find((i) => i.id === 'I2').ref).toBeNull()
    expect(r.pendingNow).toBe(2)
  })
})

describe('confirmationsOfMonth', () => {
  it('本月確認與本月撤銷(台北日曆日)', () => {
    const r = confirmationsOfMonth([
      { id: 'a', status: 'active', confirmed_at: '2026-08-31T16:30:00Z' }, // 台北 9/1
      { id: 'b', status: 'revoked', confirmed_at: '2026-08-10T00:00:00Z', revoked_at: '2026-09-05T00:00:00Z' },
      { id: 'c', status: 'active', confirmed_at: '2026-08-31T15:00:00Z' }, // 台北 8/31
    ], '2026-09')
    expect(r.confirmed.map((c) => c.id)).toEqual(['a'])
    expect(r.revoked.map((c) => c.id)).toEqual(['b'])
  })
})
