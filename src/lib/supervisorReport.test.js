import { describe, it, expect } from 'vitest'
import { buildSupervisorReport } from './supervisorReport.js'
import { signedVersionIndex } from './fieldDocs.js'

// 簽署列(store listSignedVersions 的形狀):每列帶所屬文件的類型／日期／狀態／事實列
const sig = (target, docType, date, v = 1, at = `${date}T09:00:00+00:00`) => ({
  document_id: `DOC-${target}`, doc_type: docType, doc_date: date, doc_status: 'signed', target_id: target,
  version_no: v, content_hash: 'a'.repeat(64), signer_name_snapshot: '簽署者', signed_at: at,
})

// P6a:監造月報只彙整已簽署版本——施工日誌 L1/L2 已簽署、L4 未簽署;監造日誌 S1 已簽署、S2 未簽署;
// 查驗 I1/I2 經已簽署查驗表單判定(document_id)、I4 快速判定(未經表單)、I3 待查驗
const dailyLogIndex = signedVersionIndex([sig('L1', 'daily_log', '2026-07-02'), sig('L2', 'daily_log', '2026-07-05')])
const supervisorLogIndex = signedVersionIndex([sig('S1', 'supervisor_log', '2026-07-03')])
const inspectionFormIndex = signedVersionIndex([sig('I1', 'inspection_form', '2026-07-03', 2), sig('I2', 'inspection_form', '2026-07-04')])
const data = {
  project: { project_name: 'A 區新建工程' },
  progress: { actualPct: 20, plannedPct: 27.4 },
  siteLogs: [
    { id: 'L1', log_date: '2026-07-02', weather: '晴', work_summary: '4F 模板組立' },
    { id: 'L2', log_date: '2026-07-05', weather_am: '陰', weather_pm: '短暫雨', work_summary: '4F 版筋綁紮' },
    { id: 'L3', log_date: '2026-06-28', weather: '晴', work_summary: '上月工作（不列入）' },
    { id: 'L4', log_date: '2026-07-06', weather: '雨', work_summary: '未簽署（不列入）' },
  ],
  dailyLogIndex,
  supervisorLogs: [
    { id: 'S1', log_date: '2026-07-03', attendance: [{ name: '王監造' }], supervision_items: [{ item: '鋼筋查驗' }], inspection_ids: ['I1'] },
    { id: 'S2', log_date: '2026-07-04', attendance: [{ name: '王監造' }] },
  ],
  supervisorLogIndex,
  inspections: [
    { id: 'I1', status: '合格', requested_date: '2026-07-03', title: '柱牆鋼筋查驗', document_id: 'DOC-I1', document_version_no: 2 },
    { id: 'I2', status: '不合格', requested_date: '2026-07-04', title: '打樣查驗', document_id: 'DOC-I2', document_version_no: 1 },
    { id: 'I3', status: '待查驗', requested_date: '2026-07-07', title: '模板查驗' },
    { id: 'I4', status: '合格', requested_date: '2026-07-05', title: '快速判定', inspected_at: '2026-07-05T02:00:00Z' },
  ],
  inspectionFormIndex,
  confirmations: [
    { id: 'C1', status: 'active', confirmed_at: '2026-07-03T03:00:00Z', qty_delta: 60, qty_cum: 60 },
    { id: 'C0', status: 'revoked', confirmed_at: '2026-06-20T03:00:00Z', revoked_at: '2026-07-02T03:00:00Z', reason: '複核' },
  ],
  defects: [
    { title: '蜂窩', status: '開立', due_date: '2026-01-01' }, // 逾期（相對測試執行日通常已過）
    { title: '已修', status: '已結案', closed_at: '2026-07-06T00:00:00Z' },
  ],
  submittals: [
    { status: '核准', decided_date: '2026-07-05' },
    { status: '審核中' },
  ],
}

describe('buildSupervisorReport', () => {
  const r = buildSupervisorReport(data, '2026-07')
  it('只計本月已簽署施工日誌;未簽署的揭露件數、不列入', () => {
    expect(r.logs.workDays).toBe(2)
    expect(r.logs.rainDays).toBe(1) // L4 下雨但未簽署,不算
    expect(r.logs.unsigned.map((u) => u.date)).toEqual(['2026-07-06'])
  })
  it('同月尚未簽署、也還沒有事實列的活文件(草稿)一併列未簽署——與施工月報同一條', () => {
    const r2 = buildSupervisorReport({ ...data, openDocs: [
      { id: 'D9', doc_type: 'daily_log', doc_date: '2026-07-09', status: 'pending_input' },
      { id: 'S9', doc_type: 'supervisor_log', doc_date: '2026-07-09', status: 'draft' },
    ] }, '2026-07')
    expect(r2.logs.unsigned.map((u) => u.date)).toEqual(['2026-07-06', '2026-07-09'])
    expect(r2.supervisorLogs.unsigned.map((u) => [u.date, u.legacy])).toEqual([['2026-07-04', true], ['2026-07-09', false]])
  })
  it('監造日誌只列已簽署版本(附版本);未簽署的另列', () => {
    expect(r.supervisorLogs.signed.map((l) => l.id)).toEqual(['S1'])
    expect(r.supervisorLogs.signed[0].ref).toMatchObject({ document_id: 'DOC-S1', version_no: 1 })
    expect(r.supervisorLogs.unsigned).toEqual([{ date: '2026-07-04', doc: null, legacy: true }])
    expect(r.supervisorLogs.attendedDays).toBe(1)
  })
  it('查驗判定只列經已簽署查驗表單者;快速判定不列入、待查驗為現況', () => {
    expect(r.inspections.total).toBe(2)
    expect(r.inspections.pass).toBe(1)
    expect(r.inspections.fail).toBe(1)
    expect(r.inspections.pending).toBe(1)
    expect(r.inspections.unsigned.map((i) => i.id)).toEqual(['I4'])
    expect(r.inspections.list.find((i) => i.id === 'I1').ref).toMatchObject({ version_no: 2 })
  })
  it('監造確認量:本月確認與本月撤銷', () => {
    expect(r.confirmations.confirmed.map((c) => c.id)).toEqual(['C1'])
    expect(r.confirmations.revoked.map((c) => c.id)).toEqual(['C0'])
  })
  it('缺失現況與本月結案', () => {
    expect(r.defects.openCount).toBe(1)
    expect(r.defects.closedThisMonth).toBe(1)
  })
  it('送審審定/待審', () => {
    expect(r.submittals.decidedCount).toBe(1)
    expect(r.submittals.pending).toBe(1)
  })
  it('監造意見含進度落後、已簽署文件件數與不列入的揭露', () => {
    expect(r.opinion).toContain('落後')
    expect(r.opinion).toContain('本月已簽署施工日誌計 2 日（含雨天 1 日）')
    expect(r.opinion).toContain('本月已簽署監造日誌 1 份（監造到場 1 日），另 1 份未簽署、不列入')
    expect(r.opinion).toContain('本月經簽署監造查驗表單判定 2 件')
    expect(r.opinion).toContain('另 1 件判定未經簽署查驗表單')
    expect(r.opinion).toContain('本月寫入監造確認紀錄 1 筆、撤銷 1 筆')
  })
  it('監造意見不預填資料不能支持的既成事實(W04):到場、促請、品質符合由人填', () => {
    const r0 = buildSupervisorReport({ ...data, supervisorLogs: [], supervisorLogIndex: new Map() }, '2026-07')
    for (const phrase of ['按日到場', '已促請', '尚符合契約', '均符合設計圖說', '督導情形良好', '追蹤改善']) {
      expect(r0.opinion).not.toContain(phrase)
    }
    expect(r0.opinion).toContain('請依監造日誌補充')
    expect(r0.opinion).toContain('請補充')
    expect(r0.opinion).toContain('整體品質評述請由監造依本月查核結果填寫')
  })
  it('沒有簽署索引(讀不到／示範模式)=全部未簽署,不把事實列當已簽署', () => {
    const r0 = buildSupervisorReport({ siteLogs: data.siteLogs, supervisorLogs: data.supervisorLogs, inspections: data.inspections }, '2026-07')
    expect(r0.logs.workDays).toBe(0)
    expect(r0.supervisorLogs.signed).toEqual([])
    expect(r0.inspections.list.map((i) => i.id)).toEqual(['I1', 'I2']) // 判定依據是 document_id(簽署路徑才寫),不靠索引
    expect(r0.inspections.list.every((i) => i.ref === null)).toBe(true)
  })

  it('台北凌晨(UTC 還在前一天):月份回退與逾期判斷都不退一天', () => {
    // UTC 7/31 16:30 = 台北 8/1 00:30——舊寫法會把「本月」算成 2026-07、
    // 7/31 到期的缺失也不會列逾期
    const t = new Date('2026-07-31T16:30:00Z')
    const r2 = buildSupervisorReport({
      defects: [
        { title: '昨日到期', status: '開立', due_date: '2026-07-31' },
        { title: '今日到期', status: '開立', due_date: '2026-08-01' },
      ],
    }, null, t)
    expect(r2.monthLabel).toBe('2026-08')
    expect(r2.defects.overdue).toBe(1) // 7/31 首日即逾期;8/1 今天到期不算
  })

  it('closed_at／inspected_at／confirmed_at 以台北日曆日歸月(UTC 月底晚間=台北下月初)', () => {
    const r3 = buildSupervisorReport({
      defects: [{ title: '月初結案', status: '已結案', closed_at: '2026-06-30T17:00:00Z' }], // 台北 7/1 01:00
      inspections: [{ id: 'X', status: '合格', title: '月初判定', inspected_at: '2026-06-30T18:00:00Z', document_id: 'DOC-X' }],
      confirmations: [{ id: 'CX', status: 'active', confirmed_at: '2026-06-30T18:00:00Z' }],
    }, '2026-07')
    expect(r3.defects.closedThisMonth).toBe(1)
    expect(r3.inspections.total).toBe(1)
    expect(r3.confirmations.confirmed).toHaveLength(1)
  })
})
