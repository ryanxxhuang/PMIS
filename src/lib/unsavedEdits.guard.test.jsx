// @vitest-environment jsdom
// 站內離頁保護(W01):有未存檔登記時,點站內連結先問;取消留在原頁(預設行為被擋),
// 確認後清空登記並放行同一個連結;同路徑只改 query、外部連結、沒有登記時都不攔。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { guardInAppNavigation, setUnsavedEdit, unsavedEditLabels, clearUnsavedEdits } from './unsavedEdits.js'

let a
beforeEach(() => {
  window.location.hash = '#/site-log?d=2026-09-15'
  a = document.createElement('a')
  document.body.append(a)
})
afterEach(() => { a.remove(); clearUnsavedEdits() })

describe('guardInAppNavigation', () => {
  it('沒有未存檔登記:不攔', () => {
    a.setAttribute('href', '#/quality')
    const confirm = vi.fn()
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    Object.defineProperty(e, 'target', { value: a })
    expect(guardInAppNavigation(e, confirm)).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('有登記且換路徑:攔下並問;取消就不放行、登記仍在', async () => {
    setUnsavedEdit('site-log', '施工日誌 2026-09-15（未存檔）')
    a.setAttribute('href', '#/quality')
    const confirm = vi.fn().mockResolvedValue(false)
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    Object.defineProperty(e, 'target', { value: a })
    expect(guardInAppNavigation(e, confirm)).toBe(true)
    expect(e.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledWith(['施工日誌 2026-09-15（未存檔）'])
    await Promise.resolve(); await Promise.resolve()
    expect(unsavedEditLabels()).toEqual(['施工日誌 2026-09-15（未存檔）'])
  })

  it('確認放棄:清空登記並重新觸發同一個連結的點擊', async () => {
    setUnsavedEdit('site-log', '施工日誌（未存檔）')
    a.setAttribute('href', '#/quality')
    const reclick = vi.fn()
    a.addEventListener('click', reclick)
    const confirm = vi.fn().mockResolvedValue(true)
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    Object.defineProperty(e, 'target', { value: a })
    guardInAppNavigation(e, confirm)
    await Promise.resolve(); await Promise.resolve()
    expect(unsavedEditLabels()).toEqual([])
    expect(reclick).toHaveBeenCalledTimes(1)
  })

  it('同路徑只改 query、外部連結、修飾鍵點擊:不攔', () => {
    setUnsavedEdit('site-log', '施工日誌（未存檔）')
    const confirm = vi.fn()
    for (const [href, init] of [['#/site-log?d=2026-09-16', {}], ['https://example.com/x', {}], ['#/quality', { metaKey: true }]]) {
      a.setAttribute('href', href)
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
      Object.defineProperty(e, 'target', { value: a })
      expect(guardInAppNavigation(e, confirm)).toBe(false)
    }
    expect(confirm).not.toHaveBeenCalled()
  })
})
