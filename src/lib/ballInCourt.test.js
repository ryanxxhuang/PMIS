import { describe, it, expect } from 'vitest'
import { rfiBall, submittalBall, valuationBall, defectBall, inspectionBall, tallyBalls } from './ballInCourt.js'

describe('ball-in-court per record', () => {
  it('RFI', () => {
    expect(rfiBall({ status: '待回覆' }).who).toBe('supervisor')
    expect(rfiBall({ status: '已回覆' }).who).toBe('contractor')
    expect(rfiBall({ status: '已結案' }).who).toBe('done')
  })
  it('送審', () => {
    expect(submittalBall({ status: '已提送' }).who).toBe('supervisor')
    expect(submittalBall({ status: '審核中' }).who).toBe('supervisor')
    expect(submittalBall({ status: '退回補正' }).who).toBe('contractor')
    expect(submittalBall({ status: '核准' }).who).toBe('done')
  })
  it('估驗(含請款收款接力)', () => {
    expect(valuationBall({ status: '草稿' }).who).toBe('contractor')
    expect(valuationBall({ status: '監造審核' }).who).toBe('supervisor')
    expect(valuationBall({ status: '已核定', invoice_date: null }).label).toBe('待廠商請款')
    expect(valuationBall({ status: '已核定', invoice_date: '2026-07-01', paid_date: null }).label).toBe('待收款')
    expect(valuationBall({ status: '已核定', invoice_date: '2026-07-01', paid_date: '2026-07-20' }).who).toBe('done')
  })
  it('缺失 / 查驗', () => {
    expect(defectBall({ status: '開立' }).who).toBe('contractor')
    expect(defectBall({ status: '待複查' }).who).toBe('supervisor')
    expect(defectBall({ status: '已結案' }).who).toBe('done')
    expect(inspectionBall({ status: '待查驗' }).who).toBe('supervisor')
    expect(inspectionBall({ status: '合格' }).who).toBe('done')
  })
})

describe('tallyBalls', () => {
  it('跨模組加總、排除已完成', () => {
    const t = tallyBalls({
      rfis: [{ status: '待回覆' }, { status: '已結案' }],       // supervisor +1
      submittals: [{ status: '退回補正' }],                      // contractor +1
      valuations: [{ status: '監造審核' }],                      // supervisor +1
      defects: [{ status: '開立' }, { status: '已結案' }],       // contractor +1
      inspections: [{ status: '待查驗' }],                       // supervisor +1
    })
    expect(t).toEqual({ contractor: 2, supervisor: 3, design: 0 })
  })
})
