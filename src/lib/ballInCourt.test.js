import { describe, it, expect } from 'vitest'
import { rfiBall, submittalBall, valuationBall, changeOrderBall, defectBall, inspectionBall, myOpenItems, collaborationItems, detailLink } from './ballInCourt.js'

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

// 規範 §9.7:有「清單＋詳情」殼的頁,協作項的 to 帶單條 query 直達那一筆。
// 這份組裝同時餵首頁收件匣與 Agent 的「待我處理」——連結只有一個答案。
describe('detailLink / collaborationItems 的直達連結', () => {
  it('detailLink:有 id 才帶 query,值經 URL 編碼且能被 URLSearchParams 原樣讀回', () => {
    expect(detailLink('/rfi', 'rfi', 'R1')).toBe('/rfi?rfi=R1')
    expect(detailLink('/rfi', 'rfi', null)).toBe('/rfi')
    expect(detailLink('/rfi', 'rfi', undefined)).toBe('/rfi')
    expect(detailLink('/rfi', 'rfi', '')).toBe('/rfi')
    const odd = 'a b&c=d/e'
    expect(new URL(detailLink('/rfi', 'rfi', odd), 'http://x').searchParams.get('rfi')).toBe(odd)
  })
  it('疑義 / 送審 / 變更直達該列 id;缺失 / 查驗 / 觀察 / 估驗仍是頁面連結', () => {
    const items = collaborationItems({
      rfis: [{ id: 'R1', rfi_no: 'RFI-001', title: '疑義', status: '待回覆' }],
      submittals: [{ id: 'S1', submittal_no: 'SUB-001', title: '送審', status: '已提送' }],
      changeOrders: [{ id: 'C1', co_no: 'CO-001', title: '變更', status: '提出' }],
      defects: [{ id: 'D1', title: '缺失', status: '開立' }, { id: 'DS', title: '工安', status: '開立', domain: 'safety' }],
      inspections: [{ id: 'I1', title: '查驗', status: '待查驗' }],
      observations: [{ id: 'O1', title: '觀察', status: '待處理', assigned_to: 'contractor' }],
      valuations: [{ id: 'V1', period_no: 5, status: '監造審核' }],
    })
    const to = Object.fromEntries(items.map((i) => [i.tag, i.to]))
    expect(to).toEqual({
      疑義: '/rfi?rfi=R1', 送審: '/submittals?submittal=S1', 變更: '/change-orders?co=C1',
      缺失: '/quality', 工安缺失: '/safety', 查驗: '/quality', 觀察: '/quality', 估驗: '/valuation',
    })
  })
  it('無 id 的列(demo 舊形狀)退回頁面連結', () => {
    const items = collaborationItems({
      rfis: [{ rfi_no: 'RFI-001', title: '疑義', status: '待回覆' }],
      submittals: [{ submittal_no: 'SUB-001', title: '送審', status: '已提送' }],
      changeOrders: [{ co_no: 'CO-001', title: '變更', status: '提出' }],
    })
    expect(items.map((i) => i.to)).toEqual(['/rfi', '/submittals', '/change-orders'])
  })
})
