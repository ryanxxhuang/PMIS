import { describe, it, expect } from 'vitest'
import { rfiBall, submittalBall, valuationBall, changeOrderBall, defectBall, inspectionBall, tallyBalls, myOpenItems } from './ballInCourt.js'

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
  it('估驗(含請款→機關撥款接力)', () => {
    expect(valuationBall({ status: '草稿' }).who).toBe('contractor')
    expect(valuationBall({ status: '監造審核' }).who).toBe('supervisor')
    expect(valuationBall({ status: '已核定', invoice_date: null }).who).toBe('contractor') // 待廠商請款
    const paying = valuationBall({ status: '已核定', invoice_date: '2026-07-01', paid_date: null })
    expect(paying.who).toBe('owner') // 已請款 → 球在機關撥款
    expect(paying.label).toBe('待機關撥款')
    expect(valuationBall({ status: '已核定', invoice_date: '2026-07-01', paid_date: '2026-07-20' }).who).toBe('done')
  })
  it('變更設計(監造審查 → 機關核定)', () => {
    expect(changeOrderBall({ status: '提出' }).who).toBe('supervisor')
    expect(changeOrderBall({ status: '審核中' }).who).toBe('owner')
    expect(changeOrderBall({ status: '核准' }).who).toBe('done')
    expect(changeOrderBall({ status: '駁回' }).who).toBe('done')
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
      valuations: [{ status: '監造審核' },                       // supervisor +1
        { status: '已核定', invoice_date: '2026-07-01', paid_date: null }], // owner +1 (待撥款)
      defects: [{ status: '開立' }, { status: '已結案' }],       // contractor +1
      inspections: [{ status: '待查驗' }],                       // supervisor +1
      changeOrders: [{ status: '審核中' }],                      // owner +1 (待核定)
    })
    expect(t).toEqual({ contractor: 2, supervisor: 3, owner: 2, design: 0 })
  })
})

describe('myOpenItems', () => {
  const data = {
    valuations: [
      { period_no: 5, status: '監造審核' },                                      // supervisor
      { period_no: 4, status: '已核定', invoice_date: '2026-07-01', paid_date: null }, // owner 待撥款
    ],
    changeOrders: [{ co_no: 'CO-002', title: '地坪材質變更', status: '審核中' }], // owner 待核定
    defects: [{ title: '模板殘料', status: '開立' }],                            // contractor
    submittals: [{ submittal_no: 'SUB-003', title: '假設工程計畫', status: '審核中' }], // supervisor
  }
  it('機關只看到待核定/待撥款', () => {
    const items = myOpenItems('owner', data)
    expect(items.map((i) => i.tag).sort()).toEqual(['估驗', '變更'])
    expect(items.find((i) => i.tag === '估驗').to).toBe('/payments')
  })
  it('監造只看到待審核', () => {
    const items = myOpenItems('supervisor', data)
    expect(items.map((i) => i.tag).sort()).toEqual(['估驗', '送審'])
  })
  it('廠商只看到待改善', () => {
    expect(myOpenItems('contractor', data).map((i) => i.tag)).toEqual(['缺失'])
  })
})
