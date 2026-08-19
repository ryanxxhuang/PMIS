import { describe, it, expect } from 'vitest'
import { isPayable, paymentStatus, summarizePayments } from './payments.js'

describe('isPayable', () => {
  it('只有已核定/已請款過得了金流閘門', () => {
    expect(isPayable('已核定')).toBe(true)
    expect(isPayable('已請款')).toBe(true)
    expect(isPayable('草稿')).toBe(false)
    expect(isPayable('監造審核')).toBe(false)
    expect(isPayable(undefined)).toBe(false)
  })
})

describe('paymentStatus', () => {
  it('未請款', () => {
    expect(paymentStatus({}).label).toBe('待請款')
    expect(paymentStatus({}).tone).toBe('slate')
  })
  it('有請款日=已請款', () => {
    const s = paymentStatus({ invoice_date: '2026-08-01' })
    expect(s.label).toBe('已請款')
    expect(s.tone).toBe('blue')
  })
  it('收款日與實收都有才算已收款', () => {
    const s = paymentStatus({ invoice_date: '2026-08-01', paid_date: '2026-08-10', paid_amount: 100 })
    expect(s.label).toBe('已收款')
    expect(s.tone).toBe('green')
  })
  it('只有收款日=已收款・實收未登錄(琥珀提醒補登)', () => {
    const s = paymentStatus({ invoice_date: '2026-08-01', paid_date: '2026-08-10' })
    expect(s.key).toBe('paid_unrecorded')
    expect(s.label).toBe('已收款・實收未登錄')
    expect(s.tone).toBe('amber')
  })
  it('實收 0 是合法登錄(0 不等於未登錄)', () => {
    expect(paymentStatus({ paid_date: '2026-08-10', paid_amount: 0 }).label).toBe('已收款')
  })
  it('實收 null 視為未登錄', () => {
    expect(paymentStatus({ paid_date: '2026-08-10', paid_amount: null }).key).toBe('paid_unrecorded')
  })
})

describe('summarizePayments', () => {
  const row = (status, net, retention, paid) => ({ v: { status, paid_amount: paid }, net, retention })

  it('只計已核定期別,未核定期數另計', () => {
    const s = summarizePayments([
      row('已核定', 1000, 100, 1000),
      row('已請款', 500, 50, null),
      row('草稿', 900, 90, null),
      row('監造審核', 700, 70, null),
    ])
    expect(s.net).toBe(1500)
    expect(s.retention).toBe(150)
    expect(s.received).toBe(1000)
    expect(s.unreceived).toBe(500)
    expect(s.draftCount).toBe(2)
  })

  it('收款日填了但實收沒登錄時不會被算成已收(卡片與列狀態同一口徑)', () => {
    const s = summarizePayments([{ v: { status: '已核定', paid_date: '2026-08-10', paid_amount: null }, net: 800, retention: 0 }])
    expect(s.received).toBe(0)
    expect(s.unreceived).toBe(800)
  })

  it('實收超過應領=負未收(資料異常,交給頁面轉紅)', () => {
    const s = summarizePayments([row('已核定', 100, 0, 300)])
    expect(s.unreceived).toBe(-200)
  })

  it('空清單與 null 皆回 0', () => {
    expect(summarizePayments([])).toEqual({ net: 0, retention: 0, received: 0, unreceived: 0, draftCount: 0 })
    expect(summarizePayments(null).draftCount).toBe(0)
  })
})
