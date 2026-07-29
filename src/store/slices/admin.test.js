// Admin slice 純邏輯測試:期間換算(半開區間)、佔比計算、三態覆寫的值對應、台幣參考換算。
// hook 本身(RPC 呼叫)不在此測——admin RPC 的權限與行為由 DB 端 pgTAP 把關。
import { describe, it, expect, vi } from 'vitest'

// 模組 import 鏈會建立真的 supabase client(node 環境無 WebSocket),照慣例 mock 掉
vi.mock('../../lib/supabase.js', () => ({ supabase: null, isSupabaseConfigured: false }))

import {
  TWD_PER_USD, toTwd, presetRange, customRange, pctOfTotal, overrideToRpcValue, overrideFromDb,
} from './admin.js'

// 固定「現在」:2026-07-28(週二)14:30 本地時間
const NOW = new Date(2026, 6, 28, 14, 30, 0)

describe('presetRange(期間預設 → 半開區間 [from, to))', () => {
  it('今日:from=本地午夜,to=null(到現在不設上界)', () => {
    const { from, to } = presetRange('today', NOW)
    expect(from.getTime()).toBe(new Date(2026, 6, 28, 0, 0, 0).getTime())
    expect(to).toBeNull()
  })
  it('近 7 日:含今日,從 6 天前的整日邊界起算', () => {
    const { from, to } = presetRange('7d', NOW)
    expect(from.getTime()).toBe(new Date(2026, 6, 22, 0, 0, 0).getTime())
    expect(to).toBeNull()
  })
  it('近 30 日:含今日,從 29 天前的整日邊界起算(跨月正確)', () => {
    const { from } = presetRange('30d', NOW)
    expect(from.getTime()).toBe(new Date(2026, 5, 29, 0, 0, 0).getTime()) // 6/29
  })
  it('近 7 日跨月:8/3 往前 6 天 → 7/28', () => {
    const { from } = presetRange('7d', new Date(2026, 7, 3, 9, 0, 0))
    expect(from.getTime()).toBe(new Date(2026, 6, 28, 0, 0, 0).getTime())
  })
  it('未知 preset:兩端都不設界(全部歷史)', () => {
    expect(presetRange('all', NOW)).toEqual({ from: null, to: null })
  })
})

describe('customRange(自訂起訖:迄日含當天 → to=迄日+1 的本地午夜)', () => {
  it('起訖都填:from=起日午夜,to=迄日隔天午夜(半開區間涵蓋迄日整天)', () => {
    const { from, to } = customRange('2026-07-01', '2026-07-28')
    expect(from.getTime()).toBe(new Date(2026, 6, 1, 0, 0, 0).getTime())
    expect(to.getTime()).toBe(new Date(2026, 6, 29, 0, 0, 0).getTime())
  })
  it('迄日在月底:+1 天正確跨月', () => {
    const { to } = customRange('', '2026-07-31')
    expect(to.getTime()).toBe(new Date(2026, 7, 1, 0, 0, 0).getTime()) // 8/1
  })
  it('單填一端:另一端 null(不設界)', () => {
    expect(customRange('2026-07-01', '').to).toBeNull()
    expect(customRange('', '2026-07-05').from).toBeNull()
  })
  it('兩端都空:全不設界', () => {
    expect(customRange('', '')).toEqual({ from: null, to: null })
  })
  it('起訖同一天:涵蓋整天(to = 隔天午夜)', () => {
    const { from, to } = customRange('2026-07-15', '2026-07-15')
    expect(from.getTime()).toBe(new Date(2026, 6, 15).getTime())
    expect(to.getTime()).toBe(new Date(2026, 6, 16).getTime())
  })
})

describe('pctOfTotal(佔總成本百分比)', () => {
  it('一般情形:50/200 → 25%', () => {
    expect(pctOfTotal(50, 200)).toBe(25)
  })
  it('總額為 0:回 0,不得 NaN/Infinity(空期間的表格佔比)', () => {
    expect(pctOfTotal(0, 0)).toBe(0)
    expect(pctOfTotal(5, 0)).toBe(0)
  })
  it('無效輸入(null/undefined/字串數字)不炸', () => {
    expect(pctOfTotal(null, 100)).toBe(0)
    expect(pctOfTotal(undefined, 100)).toBe(0)
    expect(pctOfTotal('25', '100')).toBe(25) // RPC numeric 常以字串回來
    expect(pctOfTotal(10, null)).toBe(0)
  })
})

describe('三態覆寫 ⇄ admin_set_project_override 的 p_enabled 值', () => {
  it('follow → null(刪除覆寫,回歸方案預設)', () => {
    expect(overrideToRpcValue('follow')).toBeNull()
  })
  it('on → true(強制開啟)、off → false(強制關閉)', () => {
    expect(overrideToRpcValue('on')).toBe(true)
    expect(overrideToRpcValue('off')).toBe(false)
  })
  it('未知值一律視為 follow(不得誤送 true/false)', () => {
    expect(overrideToRpcValue('')).toBeNull()
    expect(overrideToRpcValue(undefined)).toBeNull()
  })
  it('DB 值 → 三態:null/undefined=follow、true=on、false=off', () => {
    expect(overrideFromDb(null)).toBe('follow')
    expect(overrideFromDb(undefined)).toBe('follow')
    expect(overrideFromDb(true)).toBe('on')
    expect(overrideFromDb(false)).toBe('off')
  })
  it('雙向轉換 roundtrip 一致', () => {
    for (const s of ['follow', 'on', 'off']) {
      expect(overrideFromDb(overrideToRpcValue(s))).toBe(s)
    }
  })
})

describe('台幣參考換算(固定參考匯率)', () => {
  it('固定匯率常數為 32', () => {
    expect(TWD_PER_USD).toBe(32)
  })
  it('USD → TWD:線性換算;無效輸入回 0', () => {
    expect(toTwd(1)).toBe(32)
    expect(toTwd(2.5)).toBe(80)
    expect(toTwd(null)).toBe(0)
    expect(toTwd('1.5')).toBe(48) // RPC numeric 常以字串回來
  })
})
