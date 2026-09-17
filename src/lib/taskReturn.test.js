import { describe, it, expect } from 'vitest'
import { TASK_RETURN_SOURCES, isTaskReturnSource, taskReturnState, taskReturnOf } from './taskReturn.js'
import { routeRegistry } from './navConfig.js'

describe('taskReturn(待辦返回來源的單一定義)', () => {
  it('來源清單釘死:今日待辦、提醒中心、現場紀錄,且都是登記過的路由', () => {
    expect(TASK_RETURN_SOURCES).toEqual({ '/dashboard': '今日待辦', '/alerts': '提醒中心', '/site': '現場紀錄' })
    for (const path of Object.keys(TASK_RETURN_SOURCES)) expect(routeRegistry[path]).toBeTruthy()
  })
  it('isTaskReturnSource 只看路徑,query 不影響;單據頁不是來源', () => {
    expect(isTaskReturnSource('/dashboard?ball=waiting')).toBe(true)
    expect(isTaskReturnSource('/site')).toBe(true)
    expect(isTaskReturnSource('/quality?inspection=x')).toBe(false)
    expect(isTaskReturnSource('/site-log')).toBe(false)
    expect(isTaskReturnSource(undefined)).toBe(false)
  })
  it('taskReturnState:來源頁帶 pathname+search 與表上的標籤;非來源頁回 undefined', () => {
    expect(taskReturnState({ pathname: '/dashboard', search: '?q=第 4 期' }, 'k1'))
      .toEqual({ taskReturn: { to: '/dashboard?q=第 4 期', label: '今日待辦', key: 'k1' } })
    expect(taskReturnState({ pathname: '/site', search: '' }, 'k2'))
      .toEqual({ taskReturn: { to: '/site', label: '現場紀錄', key: 'k2' } })
    expect(taskReturnState({ pathname: '/rfi', search: '?rfi=1' }, 'k3')).toBeUndefined()
  })
  it('taskReturnOf:只信表上的來源,竄改或舊版 state 一律當沒有', () => {
    expect(taskReturnOf({ taskReturn: { to: '/alerts?type=送審', label: '提醒中心', key: 'k' } }))
      .toEqual({ to: '/alerts?type=送審', label: '提醒中心', key: 'k' })
    expect(taskReturnOf({ taskReturn: { to: '/valuation?period=1', label: '假來源', key: 'k' } })).toBeNull()
    expect(taskReturnOf(null)).toBeNull()
  })
})
