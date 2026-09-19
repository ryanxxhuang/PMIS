import { describe, it, expect } from 'vitest'
import { periodWindow, inWindow, formVersionRefs, packageItemEvidence, pinnedDailyLogRefs, packageDailyLogs, versionKey } from './valuationPackage.js'
import { signedVersionIndex } from './fieldDocs.js'
import { unsignedDays } from './reportSources.js'

const leaves = [
  { id: 'wi-1', item_key: '1.1', item_no: '一', description: '結構混凝土', unit: 'M3' },
  { id: 'wi-2', item_key: '1.2', item_no: '二', description: '模板', unit: 'M2' },
]
const keyOf = (id) => ({ 'wi-1': '1.1', 'wi-2': '1.2' })[id] ?? null

describe('periodWindow／inWindow', () => {
  it('第 1 期:開工至本期截止日(含)', () => {
    const w = periodWindow({ period_end: '2026-09-30' }, null)
    expect(w).toMatchObject({ from: null, to: '2026-09-30', gap: null })
    expect(inWindow('2026-01-01', w)).toBe(true)
    expect(inWindow('2026-10-01', w)).toBe(false)
  })
  it('前期截止日(不含)至本期截止日(含);本期起日優先', () => {
    const w = periodWindow({ period_end: '2026-09-30' }, { period_end: '2026-08-31' })
    expect([inWindow('2026-08-31', w), inWindow('2026-09-01', w), inWindow('2026-09-30', w)]).toEqual([false, true, true])
    const w2 = periodWindow({ period_start: '2026-08-31', period_end: '2026-09-30' }, { period_end: '2026-08-31' })
    expect(inWindow('2026-08-31', w2)).toBe(true)
  })
  it('缺本期或前期截止日:回 gap,任何日期都不在範圍(不退回全部日誌)', () => {
    expect(periodWindow({ period_end: null }, null).gap).toBe('period_end')
    const w = periodWindow({ period_end: '2026-09-30' }, { period_end: null })
    expect(w.gap).toBe('prev_period_end')
    expect(inWindow('2026-09-10', w)).toBe(false)
  })
})

// 本期來源:1.1 有兩筆來源(查驗表單 v2 的確認 60、歷史遷移 5);1.2 申報未確認(DB 違反 source_mismatch)
const state = {
  items: [
    { work_item_id: 'wi-1', sources: [
      { id: 's1', kind: 'confirmation', qty: 60, batch_key: '3f版牆', confirmation_id: 'c1' },
      { id: 's2', kind: 'legacy', qty: 5, batch_key: '__legacy__', confirmation_id: null },
    ], violations: [] },
    { work_item_id: 'wi-2', sources: [], violations: [{ code: 'source_mismatch', work_item_id: 'wi-2', message: '本期增量 30 無來源' }] },
  ],
}
const confirmations = [
  { id: 'c1', work_item_id: 'wi-1', batch_key: '3f版牆', location_label: '3F 版牆', unit: 'M3', qty_cum: 60, basis: 'inspection',
    inspection_id: 'insp-1', document_id: 'form-1', document_version_no: 2, content_hash: 'c'.repeat(64), status: 'active', confirmed_by: 'u-sup', confirmed_at: '2026-09-10T02:00:00Z' },
  { id: 'c9', work_item_id: 'wi-1', document_id: 'form-9', document_version_no: 1, status: 'active' }, // 不是本期來源
]

describe('formVersionRefs', () => {
  it('只取本期來源指向的查驗表單版本', () => {
    expect(formVersionRefs(state, confirmations)).toEqual([{ document_id: 'form-1', version_no: 2 }])
  })
})

describe('packageItemEvidence', () => {
  const formVersions = new Map([[versionKey('form-1', 2), {
    document_id: 'form-1', version_no: 2, content_hash: 'c'.repeat(64),
    attachments: [{ photo_id: 'p1' }, { photo_id: 'p2', role: 'evidence' }, { photo_id: 'p3', role: 'reference' }], content: { self_check_record_id: 'rec-1' },
  }]])
  // 表單目前的簽署版本是 v3(撤銷後重簽):來源 v2 不是列印版本 → 不給會印出 v3 的連結
  const formIndex = signedVersionIndex([
    { document_id: 'form-1', doc_type: 'inspection_form', doc_date: '2026-09-10', doc_status: 'submitted', target_id: 'insp-1', version_no: 2, signed_at: '2026-09-10T02:00:00Z' },
    { document_id: 'form-1', doc_type: 'inspection_form', doc_date: '2026-09-10', doc_status: 'submitted', target_id: 'insp-1', version_no: 3, signed_at: '2026-09-12T02:00:00Z' },
  ])
  const selfCheckIndex = signedVersionIndex([{ document_id: 'sc-1', doc_type: 'self_check', doc_date: '2026-09-09', doc_status: 'received', target_id: 'rec-1', version_no: 1, content_hash: 'd'.repeat(64), signed_at: '2026-09-09T02:00:00Z' }])
  const ev = packageItemEvidence({
    leaves, state, keyOf, confirmations, formVersions, formIndex,
    inspections: [{ id: 'insp-1', title: '3F 版牆混凝土查驗', status: '部分合格' }],
    checklistRecords: [{ id: 'rec-1', check_date: '2026-09-09', rev: 0, overall: '合格' }], selfCheckIndex,
  })
  it('確認來源追到查驗表單版本(簽署當下的雜湊)、附件照片與檢附自主檢查的簽署版本', () => {
    const e = ev[0]
    expect(e.status).toBe('confirmed')
    expect(e.sources[0].form.ref).toMatchObject({ document_id: 'form-1', version_no: 2, content_hash: 'c'.repeat(64), latest_of_doc: false })
    expect(e.sources[0].inspection.title).toBe('3F 版牆混凝土查驗')
    expect(e.photoIds).toEqual(['p1', 'p2']) // 他方照片只能參考(reference),不當佐證照片
    expect(e.sources[0].selfCheck).toMatchObject({ record_id: 'rec-1', record: { rev: 0 }, ref: { document_id: 'sc-1', version_no: 1 } })
    expect(e.sources[1]).toMatchObject({ kind: 'legacy', qty: 5, form: null })
  })
  it('DB 列出違反的工項標缺件(不以照片或日誌補位)', () => {
    expect(ev[1].status).toBe('blocked')
    expect(ev[1].issues[0]).toMatchObject({ code: 'source_mismatch', label: '缺監造確認來源' })
    expect(ev[1].photoIds).toEqual([])
  })
  it('沒有後端狀態(示範／未載入)=未經核對,不假裝有來源', () => {
    expect(packageItemEvidence({ leaves, state: null, keyOf }).map((e) => e.status)).toEqual(['unchecked', 'unchecked'])
  })
})

describe('packageDailyLogs(送審時點釘住的已簽署版本)', () => {
  // 9/05 的日誌 v1 送審前簽署、v2 送審後才更正簽署;9/06 送審後才首次簽署;9/07 從未簽署;8/20 在本期範圍外
  const sigRows = [
    { document_id: 'd5', doc_type: 'daily_log', doc_date: '2026-09-05', doc_status: 'submitted', target_id: 'L5', version_no: 1, content_hash: 'e'.repeat(64), signed_at: '2026-09-05T10:00:00Z' },
    { document_id: 'd5', doc_type: 'daily_log', doc_date: '2026-09-05', doc_status: 'submitted', target_id: 'L5', version_no: 2, content_hash: 'f'.repeat(64), signed_at: '2026-10-03T10:00:00Z' },
    { document_id: 'd6', doc_type: 'daily_log', doc_date: '2026-09-06', doc_status: 'signed', target_id: 'L6', version_no: 1, signed_at: '2026-10-04T10:00:00Z' },
    { document_id: 'd0', doc_type: 'daily_log', doc_date: '2026-08-20', doc_status: 'signed', target_id: 'L0', version_no: 1, signed_at: '2026-08-20T10:00:00Z' },
  ]
  const span = periodWindow({ period_end: '2026-09-30' }, { period_end: '2026-08-31' })
  const index = signedVersionIndex(sigRows, { pinAt: '2026-10-02T00:00:00Z' })
  const refs = pinnedDailyLogRefs(index, span)
  it('送審後的更正與首次簽署都不改變已提送的包', () => {
    expect(refs.map((r) => [r.document_id, r.version_no])).toEqual([['d5', 1]])
    expect(refs[0].newer).toMatchObject({ version_no: 2 })
  })
  it('內容取釘住版本;na 數量不算;只列本期工項', () => {
    const versions = new Map([[versionKey('d5', 1), {
      content: { log_date: '2026-09-05', weather_am: '晴', work_summary: '3F 版牆澆置', items: {
        'wi-1': { item_key: '1.1', qty_today: 40 }, 'wi-2': { item_key: '1.2', qty_today: 12 }, 'wi-x': { item_key: '9.9', qty_today: 3 },
      } },
      field_sources: { 'items.wi-2.qty_today': { status: 'na', reason: '本日不適用' } },
    }]])
    // 事實列 L5 已是送審後 v2 的內容(45):包只讀釘住的 v1 版本內容
    const out = packageDailyLogs({ refs, versions, leaves })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({ date: '2026-09-05', weather: '晴', summary: '3F 版牆澆置' })
    expect(out.rows[0].items).toEqual([{ item_key: '1.1', item_no: '一', description: '結構混凝土', unit: 'M3', qty: 40 }])
    expect(out.missing).toBe(0)
  })
  it('範圍內送審時未簽署(之後才簽)與從未簽署的日誌:與施工月報同一支 unsignedDays 列出', () => {
    const siteLogs = [
      { id: 'L5', log_date: '2026-09-05' }, { id: 'L6', log_date: '2026-09-06' }, { id: 'L0', log_date: '2026-08-20' },
    ]
    const unsignedRows = siteLogs.filter((l) => !index.has(l.id))
    const openDocs = [{ id: 'd7', doc_type: 'daily_log', doc_date: '2026-09-07', status: 'draft' }]
    const out = unsignedDays({ unsignedRows, signedDates: new Set(refs.map((r) => r.doc_date)), openDocs, docType: 'daily_log', inRange: (d) => inWindow(d, span) })
    expect(out.map((u) => u.date)).toEqual(['2026-09-06', '2026-09-07']) // 8/20 在範圍外
  })
  it('讀不到版本內容的如實計數,不以事實列代填', () => {
    const out = packageDailyLogs({ refs, versions: new Map(), leaves })
    expect(out).toMatchObject({ rows: [], missing: 1 })
  })
})
