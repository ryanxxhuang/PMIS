// 側欄/rail 的「現在輪到我」件數。這個數字與首頁今日待辦同源(useTodayTasks),
// 一旦分組比對寫錯,使用者會看到側欄說 3 件、點進去只有 1 件——比沒有 badge 更糟。
// 純函式,不需要 store;hook 本體的聚合由 todayTasks.test.js 把關。
import { describe, it, expect, vi } from 'vitest'

// hook 檔會 import store.jsx(整個組合根),純函式測試不需要也不該把它拉進來
vi.mock('../store.jsx', () => ({ useStore: () => ({}) }))

import { mineCountForNavItem } from './useTodayTasks.js'

const t = (to) => ({ to, title: `待辦 ${to}` })

describe('mineCountForNavItem', () => {
  const mine = [t('/quality'), t('/quality'), t('/site-log'), t('/submittals'), t('/valuation')]

  it('單層項目:只數 to 完全相同的待辦', () => {
    expect(mineCountForNavItem(mine, { to: '/quality' })).toBe(2)
    expect(mineCountForNavItem(mine, { to: '/submittals' })).toBe(1)
  })

  it('有分頁的工作面:底下每個 tab 的待辦都要算進母項(否則收合時 badge 歸零)', () => {
    const group = { to: '/site-log', tabs: [{ to: '/site-log' }, { to: '/quality' }, { to: '/itp' }] }
    expect(mineCountForNavItem(mine, group)).toBe(3) // 1 現場 + 2 品質
  })

  it('同一筆待辦既符合母項 to 又符合某個 tab → 只算一次(不得重複計數)', () => {
    const group = { to: '/site-log', tabs: [{ to: '/site-log' }] }
    expect(mineCountForNavItem([t('/site-log')], group)).toBe(1)
  })

  it('沒有對應待辦 → 0(要能讓呼叫端據此不顯示 badge)', () => {
    expect(mineCountForNavItem(mine, { to: '/admin' })).toBe(0)
    expect(mineCountForNavItem([], { to: '/quality' })).toBe(0)
  })

  it('無 tabs 欄位的項目不得因為 optional chaining 漏寫而爆掉', () => {
    expect(() => mineCountForNavItem(mine, { to: '/boq' })).not.toThrow()
    expect(mineCountForNavItem(mine, { to: '/boq' })).toBe(0)
  })

  it('前綴相同但不同路由不得誤算(/quality 不吃 /quality-report)', () => {
    expect(mineCountForNavItem([t('/quality-report')], { to: '/quality' })).toBe(0)
  })
})
