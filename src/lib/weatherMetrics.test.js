import { describe, it, expect } from 'vitest'
import { isRainyLog, rainDayCount } from './weatherMetrics.js'

describe('weatherMetrics(報表同源雨天定義)', () => {
  it('任一時段含雨即為雨天(P1-7 的分家案例:上午晴、下午陣雨)', () => {
    expect(isRainyLog({ weather: '晴', weather_am: '晴', weather_pm: '短暫陣雨' })).toBe(true)
    expect(isRainyLog({ weather: '陰短暫雨' })).toBe(true)
    expect(isRainyLog({ weather_am: '雨' })).toBe(true)
  })
  it('無雨/缺欄位不是雨天', () => {
    expect(isRainyLog({ weather: '晴', weather_am: '多雲', weather_pm: '陰' })).toBe(false)
    expect(isRainyLog({})).toBe(false)
    expect(isRainyLog(null)).toBe(false)
  })
  it('rainDayCount 逐日計數', () => {
    expect(rainDayCount([
      { weather: '晴' },
      { weather: '晴', weather_pm: '雷陣雨' },
      { weather: '雨' },
    ])).toBe(2)
    expect(rainDayCount()).toBe(0)
  })
})
