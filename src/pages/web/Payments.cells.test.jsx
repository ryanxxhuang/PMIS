// @vitest-environment jsdom
// 請款收款逐欄保存的可信度(UIUX 階段 5A U09):沿用逐欄 onBlur 寫入,只把每次寫入的結果放回欄位旁。
// - 成功:欄位下方「已儲存」;失敗:輸入值留在框裡、旁邊寫「未儲存＋正式值」、可還原;
// - 驗證失敗(日期晚於今日)不打 API、同樣說未儲存並可還原;
// - 缺前置日期:實收欄鎖定並就近說「請先填收款日」;
// - 溢收取消:輸入框拉回正式值、明說已取消未儲存;
// - 指定期別:表只列該期、統計標「全案累計」、匯出標「全案 n 期」;不存在的期別不列任何列。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Payments from './Payments.jsx'

let container, root
const leaf = { id: 'w1', item_key: 'K1', item_no: '1', description: '混凝土', unit: 'M3', quantity: 100, unit_price: 1000, amount: 100000, is_billable: true }
// amounts = DB 的 amount_cum(P4c 起前端不換算金額)
const v1 = { id: 'V1', period_no: 1, status: '已核定', valuation_date: '2026-08-01', retention_pct: 10, items: { K1: 50 }, amounts: { K1: 50000 }, invoice_date: null, paid_date: null, paid_amount: null }
const v2 = { id: 'V2', period_no: 2, status: '監造審核', valuation_date: '2026-09-01', retention_pct: 10, items: { K1: 80 }, amounts: { K1: 80000 }, invoice_date: null, paid_date: null, paid_amount: null }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    workItems: { items: [leaf] }, adjustedItems: [leaf], valuations: [v1, v2], updateValuationPayment: vi.fn(),
    isSupabaseConfigured: false, currentProject: { project_id: 'p1' }, workItemsSource: 'demo',
    currentUser: { org_type: 'owner' }, can: {}, isPlatformAdmin: false,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.confirm
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (entry = '/payments') => act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><Payments /></MemoryRouter>) })
const input = (label) => container.querySelector(`input[aria-label="${label}"]`)
const blurWith = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('blur', { bubbles: false }))
  // React 的 onBlur 綁在 focusout
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
})
const statusTexts = () => [...container.querySelectorAll('[role="status"]')].map((n) => n.textContent)

describe('逐欄儲存回饋', () => {
  it('請款日:成功顯示已儲存;失敗留輸入值、寫未儲存與正式值、可還原', async () => {
    state.store.updateValuationPayment
      .mockImplementationOnce(async (id, patch) => {
        state.store = { ...state.store, valuations: [{ ...v1, ...patch }, v2] }
        return { error: null }
      })
      .mockResolvedValueOnce({ error: { message: 'boom' } })
    await render()
    expect(container.textContent).toContain('離開欄位後即儲存該欄')
    expect(container.textContent).toContain('系統不執行付款')
    await blurWith(input('第 1 期請款日'), '2026-08-05')
    expect(state.store.updateValuationPayment).toHaveBeenCalledWith('V1', { invoice_date: '2026-08-05' })
    expect(statusTexts().join(' ')).toContain('已儲存')
    await render()
    // 第二次改成失敗:輸入值留著、正式值仍是 2026-08-05,可還原
    await blurWith(input('第 1 期請款日'), '2026-08-06')
    expect(input('第 1 期請款日').value).toBe('2026-08-06')
    const st = statusTexts().join(' ')
    expect(st).toContain('未儲存')
    expect(st).toContain('正式值仍是 2026-08-05')
    expect(container.textContent).toContain('輸入值尚未生效')
    const revertBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '還原')
    await act(async () => revertBtn.click())
    expect(input('第 1 期請款日').value).toBe('2026-08-05')
    expect(statusTexts().join(' ')).not.toContain('未儲存')
  })

  it('驗證失敗不打 API:晚於今日的請款日說未儲存;缺前置日期時實收鎖定並說明', async () => {
    await render()
    await blurWith(input('第 1 期請款日'), '2999-01-01')
    expect(state.store.updateValuationPayment).not.toHaveBeenCalled()
    expect(statusTexts().join(' ')).toContain('請款日不可晚於今日')
    expect(statusTexts().join(' ')).toContain('正式值仍是 空白')
    // 前置條件:沒有請款日 → 收款日鎖;沒有收款日 → 實收鎖,就近說明
    expect(input('第 1 期收款日').disabled).toBe(true)
    expect(input('第 1 期實收金額').disabled).toBe(true)
    expect(container.textContent).toContain('請先填請款日')
    expect(container.textContent).toContain('請先填收款日')
    // 未核定期別整列鎖定
    expect(input('第 2 期請款日').disabled).toBe(true)
  })

  it('溢收取消:輸入框拉回正式值並說已取消未儲存;確認後才寫入', async () => {
    state.store = { ...state.store, valuations: [{ ...v1, invoice_date: '2026-08-05', paid_date: '2026-08-20', paid_amount: null }, v2] }
    window.confirm = vi.fn(() => false)
    await render()
    const amt = input('第 1 期實收金額')
    expect(amt.disabled).toBe(false)
    await blurWith(amt, '999999999')
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(state.store.updateValuationPayment).not.toHaveBeenCalled()
    expect(amt.value).toBe('')
    expect(statusTexts().join(' ')).toContain('已取消，未儲存')
    window.confirm = vi.fn(() => true)
    state.store.updateValuationPayment.mockResolvedValueOnce({ error: null })
    await blurWith(amt, '999999999')
    expect(state.store.updateValuationPayment).toHaveBeenCalledWith('V1', { paid_amount: 999999999 })
  })
})

describe('指定期別的範圍', () => {
  it('?period=V1:只列第 1 期、統計標全案累計、匯出標全案 2 期', async () => {
    await render('/payments?period=V1')
    expect(container.textContent).toContain('正在處理第 1 期估驗的請款紀錄')
    expect(container.textContent).toContain('全案累計（已核定期別，共 1 期）')
    expect(container.textContent).toContain('第 1 期請款 / 收款登錄')
    expect(container.textContent).toContain('匯出 CSV（全案 2 期）')
    expect(input('第 1 期請款日')).toBeTruthy()
    expect(input('第 2 期請款日')).toBeNull()
  })

  it('?period=不存在:不列任何列、說明未變更紀錄、可顯示全部期別', async () => {
    await render('/payments?period=NOPE')
    expect(container.textContent).toContain('找不到指定的估驗期')
    expect(container.textContent).toContain('本頁未變更任何紀錄')
    expect(input('第 1 期請款日')).toBeNull()
    const showAll = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '顯示全部期別')
    await act(async () => showAll.click())
    expect(input('第 1 期請款日')).toBeTruthy()
  })
})
