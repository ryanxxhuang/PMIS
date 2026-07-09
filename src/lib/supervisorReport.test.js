import { describe, it, expect } from 'vitest'
import { buildSupervisorReport } from './supervisorReport.js'

const data = {
  project: { project_name: 'A 區新建工程' },
  progress: { actualPct: 20, plannedPct: 27.4 },
  siteLogs: [
    { log_date: '2026-07-02', weather: '晴', work_summary: '4F 模板組立' },
    { log_date: '2026-07-05', weather_am: '陰', weather_pm: '短暫雨', work_summary: '4F 版筋綁紮' },
    { log_date: '2026-06-28', weather: '晴', work_summary: '上月工作（不列入）' },
  ],
  inspections: [
    { status: '合格', requested_date: '2026-07-03', title: '柱牆鋼筋查驗' },
    { status: '不合格', requested_date: '2026-07-04', title: '打樣查驗' },
    { status: '待查驗', requested_date: '2026-07-07', title: '模板查驗' },
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
  it('只計本月施工日誌', () => {
    expect(r.logs.workDays).toBe(2)
    expect(r.logs.rainDays).toBe(1)
  })
  it('查驗統計（3 件皆本月申請）', () => {
    expect(r.inspections.total).toBe(3)
    expect(r.inspections.pass).toBe(1)
    expect(r.inspections.fail).toBe(1)
    expect(r.inspections.pending).toBe(1)
  })
  it('缺失現況與本月結案', () => {
    expect(r.defects.openCount).toBe(1)
    expect(r.defects.closedThisMonth).toBe(1)
  })
  it('送審審定/待審', () => {
    expect(r.submittals.decidedCount).toBe(1)
    expect(r.submittals.pending).toBe(1)
  })
  it('監造意見含進度落後與品質語句', () => {
    expect(r.opinion).toContain('落後')
    expect(r.opinion).toContain('查驗')
    expect(typeof r.opinion).toBe('string')
  })
})
