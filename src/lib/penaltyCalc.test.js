import { describe, it, expect } from 'vitest'
import { zhNum, parsePenaltyRate, estimatePenalty } from './penaltyCalc.js'

describe('zhNum', () => {
  it('阿拉伯與中文數字', () => {
    expect(zhNum('3')).toBe(3)
    expect(zhNum('3.5')).toBe(3.5)
    expect(zhNum('一')).toBe(1)
    expect(zhNum('十')).toBe(10)
    expect(zhNum('十五')).toBe(15)
    expect(zhNum('二十')).toBe(20)
    expect(zhNum('二十五')).toBe(25)
  })
})

describe('parsePenaltyRate', () => {
  it('千分之(中文)+ 上限%', () => {
    const r = parsePenaltyRate('逾期完工者，每日按契約總價千分之一計算違約金，上限為契約總價百分之二十')
    expect(r.perDayFraction).toBeCloseTo(0.001)
    expect(r.capFraction).toBeCloseTo(0.2)
  })
  it('千分之(阿拉伯)', () => {
    expect(parsePenaltyRate('每日千分之3').perDayFraction).toBeCloseTo(0.003)
  })
  it('‰ 符號(公共工程契約常見:0.5‰、1‰)', () => {
    expect(parsePenaltyRate('逾期每日按契約價金總額 0.5‰ 計罰').perDayFraction).toBeCloseTo(0.0005)
    expect(parsePenaltyRate('逾查核點未達進度按日計罰 1‰').perDayFraction).toBeCloseTo(0.001)
  })
  it('每日固定額(萬元)', () => {
    const r = parsePenaltyRate('逾期每日新臺幣五萬元整')
    expect(r.perDayFixed).toBe(50000)
    expect(r.perDayFraction).toBeNull()
  })
  it('固定額「N 元/日」(元在後、含千分位逗號)', () => {
    expect(parsePenaltyRate('逾期新臺幣 10,000 元/日').perDayFixed).toBe(10000)
    expect(parsePenaltyRate('每日 2,500 元').perDayFixed).toBe(2500)
    expect(parsePenaltyRate('違約金 1 萬元/天').perDayFixed).toBe(10000)
  })
  it('上限「N成」', () => {
    expect(parsePenaltyRate('千分之二，上限二成').capFraction).toBeCloseTo(0.2)
  })
  it('抽不出罰率回 null', () => {
    expect(parsePenaltyRate('逾期依契約辦理')).toBeNull()
    expect(parsePenaltyRate('')).toBeNull()
  })
})

describe('estimatePenalty', () => {
  const contractTotal = 100_000_000 // 1 億

  it('千分之一 × 逾期10天 × 1億 = 100 萬', () => {
    const e = estimatePenalty({ penaltyText: '每日千分之一', overdueDays: 10, contractTotal })
    expect(e.amount).toBe(1_000_000)
    expect(e.capped).toBe(false)
  })

  it('套用上限 20%', () => {
    // 千分之一 × 逾期 300 天 = 3000 萬 > 上限 2000 萬 → 封頂
    const e = estimatePenalty({ penaltyText: '每日千分之一，上限百分之二十', overdueDays: 300, contractTotal })
    expect(e.amount).toBe(20_000_000)
    expect(e.capped).toBe(true)
    expect(e.capAmount).toBe(20_000_000)
  })

  it('固定額制不需契約總價', () => {
    const e = estimatePenalty({ penaltyText: '逾期每日五萬元', overdueDays: 4, contractTotal: 0 })
    expect(e.amount).toBe(200_000)
  })

  it('未逾期 / 無罰率 → null', () => {
    expect(estimatePenalty({ penaltyText: '每日千分之一', overdueDays: 0, contractTotal })).toBeNull()
    expect(estimatePenalty({ penaltyText: '依約辦理', overdueDays: 5, contractTotal })).toBeNull()
  })

  it('百分比制但無契約總價 → null(避免算出 0 誤導)', () => {
    expect(estimatePenalty({ penaltyText: '每日千分之一', overdueDays: 5, contractTotal: 0 })).toBeNull()
  })
})
