// O2:示範模式的「已簽署示範文件版本」。示範模式不能真的簽署,但施工月報／監造月報與估驗佐證包依 P6a
// 只彙整已簽署版本——沒有這一組種子,Demo 站三張報表全是「未簽署、不列入」與「未經後端核對」。
// 這裡釘住的是:四類文書各至少一份已簽署示範版本(含簽署者／時間／版本／雜湊)、每一列標 is_demo
// (版本標示印【示範資料】,不得看起來像真簽署)、以及「拿種子餵既有彙整規則就得到正常內容」。
import { describe, it, expect } from 'vitest'
import { buildDemoData } from './demoSeed.js'
import { rehydrateWorkItems, workItemRefIndex } from '../lib/boqCalc.js'
import compact from './workItems.compact.json'
import { signedVersionIndex, signedVersionText } from '../lib/fieldDocs.js'
import { splitBySignature, unsignedDays, aggregateDailyLogs, inspectionsOfMonth } from '../lib/reportSources.js'
import { packageItemEvidence } from '../lib/valuationPackage.js'

const project = {
  project_id: 'demo-project', project_name: '示範工程', start_date: '2026-03-01', end_date: '2027-06-30',
  commencement_date: '2026-03-01', award_date: '2026-02-01', notice_date: '2026-02-15',
}
const workItems = rehydrateWorkItems(compact)
const d = buildDemoData(workItems, project)
// store 的 listSignedVersions 在 demoMode 就是這個組合(簽署列 ＋ 所屬文件的類型／日期／狀態／事實列)
const signedRows = (docType) => d.signedDocs
  .filter((e) => e.doc.doc_type === docType)
  .flatMap((e) => (e.signatures || []).map((s) => ({ ...s, doc_type: e.doc.doc_type, doc_date: e.doc.doc_date, doc_status: e.doc.status, target_id: e.doc.target_id })))
const month = d.siteLogs[0].log_date.slice(0, 7)

describe('示範已簽署文件版本', () => {
  it('四類文書各至少一份,且都有簽署者／簽署時間／版本號／內容雜湊', () => {
    for (const t of ['daily_log', 'supervisor_log', 'self_check', 'inspection_form']) {
      const rows = signedRows(t)
      expect(rows.length, t).toBeGreaterThan(0)
      for (const r of rows) {
        expect(r.signer_name_snapshot, t).toBeTruthy()
        expect(r.signed_at, t).toBeTruthy()
        expect(Number(r.version_no), t).toBe(1)
        expect(r.content_hash, t).toBeTruthy()
        expect(r.target_id, t).toBeTruthy() // 沒綁事實列的文件不會進索引,報表就彙整不到
      }
    }
  })

  it('每一列都標 is_demo,版本標示印【示範資料】——不得偽裝成真實簽署', () => {
    const all = ['daily_log', 'supervisor_log', 'self_check', 'inspection_form'].flatMap(signedRows)
    expect(all.every((r) => r.is_demo === true)).toBe(true)
    const ref = signedVersionIndex(signedRows('daily_log')).values().next().value
    expect(signedVersionText(ref)).toContain('【示範資料】')
    expect(ref.signer_name).toContain('示範資料')
  })

  it('版本標示的短碼與雜湊逐份不同:示範資料也要看得出「版本可核對」', () => {
    const ids = d.signedDocs.map((e) => String(e.doc.id).slice(0, 8))
    const hashes = d.signedDocs.map((e) => String(e.signatures[0].content_hash).slice(0, 12))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(hashes).size).toBe(hashes.length)
    for (const h of d.signedDocs.map((e) => e.signatures[0].content_hash)) expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('每份已簽署文件都有對應的版本內容可取(佐證包要印的就是版本內容)', () => {
    for (const e of d.signedDocs) {
      const v = e.versions.find((x) => x.version_no === 1)
      expect(v, e.doc.id).toBeTruthy()
      expect(v.content_hash).toBe(e.signatures[0].content_hash)
      expect(v.content).toBeTruthy()
    }
  })
})

describe('施工月報:示範資料彙整得出內容', () => {
  const idx = signedVersionIndex(signedRows('daily_log'))
  it('本月施工日誌多數已簽署,最新一天刻意留未簽署(兩種列都演得到)', () => {
    const { signed, unsigned } = splitBySignature(d.siteLogs, idx, { month })
    expect(signed.length).toBeGreaterThan(0)
    expect(unsigned.length).toBe(1)
    expect(unsigned[0].log_date).toBe(d.siteLogs[0].log_date) // 最新一天
    const days = unsignedDays({ unsignedRows: unsigned, signedDates: new Set(signed.map((l) => l.log_date)), openDocs: [], docType: 'daily_log' })
    expect(days.map((x) => x.date)).toEqual([d.siteLogs[0].log_date])
  })
  it('已簽署日誌彙整得出施工天數、出工與工項數量(不再是全 0)', () => {
    const { signed } = splitBySignature(d.siteLogs, idx, { month })
    const agg = aggregateDailyLogs(signed, signed)
    expect(agg.workDays).toBe(signed.length)
    expect(agg.laborTotal).toBeGreaterThan(0)
    expect(agg.qtyMonth.size).toBeGreaterThan(0)
  })
  it('查驗判定:經已簽署查驗表單的才列入,合格與不合格各一,另有一件未經表單', () => {
    const insp = inspectionsOfMonth(d.inspections, month, signedVersionIndex(signedRows('inspection_form')))
    expect(insp.pass).toBe(1)
    expect(insp.fail).toBe(1)
    expect(insp.unsigned.length).toBe(1)
    // 事實列的 document_id 只由簽署路徑寫入:示範資料也必須照這條才算數
    expect(d.inspections.filter((i) => i.document_id).length).toBe(2)
  })
})

describe('監造月報:示範監造日誌事實列', () => {
  it('有事實列,且多數已簽署、留一天未簽署', () => {
    expect(d.supervisorLogs.length).toBeGreaterThan(0)
    const { signed, unsigned } = splitBySignature(d.supervisorLogs, signedVersionIndex(signedRows('supervisor_log')))
    expect(signed.length).toBe(3)
    expect(unsigned.length).toBe(1)
    expect(signed[0].attendance.length).toBeGreaterThan(0) // 到場人員是人填欄,示範資料要填得出來
  })
})

describe('估驗佐證包:示範監造確認量', () => {
  const lastVal = d.valuations[d.valuations.length - 1]
  const prevVal = d.valuations[d.valuations.length - 2]
  const state = d.valuationStates[lastVal.id]
  const wiRefs = workItemRefIndex(workItems.items)
  const leaves = workItems.items.filter((it) => ((lastVal.items[it.item_key] || 0) - (prevVal.items[it.item_key] || 0)) > 0)

  it('期別狀態與確認紀錄對得起來,示範標單沒有工項 id 也解析得到工項', () => {
    expect(state.items.length).toBe(d.confirmations.length)
    for (const c of d.confirmations) expect(wiRefs.resolve(c.work_item_id), c.work_item_id).toBeTruthy()
  })

  it('逐工項證據判為「已確認」,不再整欄「未經後端核對」', () => {
    const ev = packageItemEvidence({
      leaves, state, keyOf: (ref) => wiRefs.resolve(ref)?.item_key ?? null,
      confirmations: d.confirmations, formVersions: new Map(), formIndex: new Map(),
      inspections: d.inspections, checklistRecords: d.checklistRecords, selfCheckIndex: new Map(),
    })
    expect(ev.length).toBeGreaterThan(0)
    expect(ev.every((e) => e.status === 'confirmed')).toBe(true)
    expect(ev.some((e) => e.sources.some((s) => s.confirmation?.basis === 'inspection'))).toBe(true)
    expect(ev.some((e) => e.sources.some((s) => s.confirmation?.basis === 'supervisor_certificate'))).toBe(true)
  })

  it('走查驗表單的那一筆指得到已簽署表單版本與檢附的自主檢查', () => {
    const viaForm = d.confirmations.find((c) => c.basis === 'inspection')
    const form = d.signedDocs.find((e) => e.doc.id === viaForm.document_id)
    expect(form.doc.doc_type).toBe('inspection_form')
    expect(form.versions[0].content.self_check_record_id).toBe('CLR-DEMO-1')
    expect(d.signedDocs.some((e) => e.doc.doc_type === 'self_check' && e.doc.target_id === 'CLR-DEMO-1')).toBe(true)
    expect(viaForm.content_hash).toBe(form.signatures[0].content_hash)
  })

  it('送審時點有值:佐證包才不會標「查無送審稽核紀錄」', () => {
    expect(d.valuationSubmittedAt[lastVal.id]).toBeTruthy()
  })
})
