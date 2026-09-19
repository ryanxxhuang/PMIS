// @vitest-environment jsdom
// P4d 監造確認單表單:三種用途(簽發／減量／補證)同一張表;前端只擋必填空白、負數、減量不小於目前累計、
// 補證小於遷移量,其餘交 DB;submit 送出 itemKey／批次／位置／階段／累計量／原因／coversValuationId。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import CertificateForm from './CertificateForm.jsx'

const it1 = { item_key: 'L1', item_no: '1.1', description: '混凝土', unit: 'm3', quantity: 100 }
let container, root
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })

const render = (target, onSubmit = () => {}) => act(async () => root.render(<CertificateForm target={target} onSubmit={onSubmit} onCancel={() => {}} />))
const setValue = (label, value) => act(async () => {
  const el = container.querySelector(`[aria-label="${label}"]`)
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const submit = () => act(async () => container.querySelector('form').requestSubmit())
const alertText = () => container.querySelector('[role="alert"]')?.textContent || ''

describe('CertificateForm', () => {
  it('簽發:批次、累計量、依據必填;送出帶 itemKey／批次／位置(預設同批次)／累計量／原因,covers 為 null', async () => {
    const got = []
    await render({ it: it1, mode: 'issue' }, (f) => got.push(f))
    expect(container.textContent).toContain('簽發監造確認單:1.1 混凝土')
    await submit(); expect(alertText()).toContain('批次')
    await setValue('批次／位置', 'A區'); await submit(); expect(alertText()).toContain('累計確認量')
    await setValue('累計確認量', '-1'); await submit(); expect(alertText()).toContain('0 以上')
    await setValue('累計確認量', '60'); await submit(); expect(alertText()).toContain('依據')
    await setValue('依據／說明', '依查驗紀錄'); await submit()
    expect(got).toEqual([{ itemKey: 'L1', batchKey: 'A區', locationLabel: 'A區', stageKey: null, qtyCum: 60, reason: '依查驗紀錄', coversValuationId: null }])
  })
  it('減量:批次唯讀沿用原批次,累計量必須小於目前累計', async () => {
    const got = []
    await render({ it: it1, mode: 'reduce', batchKey: 'a區', locationLabel: 'A區', qtyCum: 60, currentCum: 60 }, (f) => got.push(f))
    expect(container.textContent).toContain('減量確認:1.1 混凝土')
    expect(container.querySelector('[aria-label="批次／位置"]').readOnly).toBe(true)
    await setValue('依據／說明', '複核後減量')
    await submit(); expect(alertText()).toContain('小於目前累計 60')
    await setValue('累計確認量', '50'); await submit()
    expect(got[0]).toMatchObject({ batchKey: 'a區', locationLabel: 'A區', qtyCum: 50, coversValuationId: null })
  })
  it('補證:標題與涵蓋範圍明講該期與遷移量;累計量預填遷移量、不得小於它;送出帶 coversValuationId', async () => {
    const got = []
    await render({ it: it1, mode: 'cover', covers: { id: 'v-old', period_no: 3, status: '已核定', legacyQty: 100 }, qtyCum: 100 }, (f) => got.push(f))
    expect(container.textContent).toContain('補證第 3 期:1.1 混凝土')
    expect(container.textContent).toContain('會成為該期此工項已計價量的計價依據')
    expect(container.textContent).toContain('該期歷史遷移量 100 m3')
    expect(container.querySelector('[aria-label="累計確認量"]').value).toBe('100')
    await setValue('批次／位置', '舊估驗補證'); await setValue('依據／說明', '依第 3 期估驗單複核')
    await setValue('累計確認量', '90'); await submit(); expect(alertText()).toContain('不得小於該期歷史遷移量 100')
    await setValue('累計確認量', '100'); await submit()
    expect(got).toEqual([{ itemKey: 'L1', batchKey: '舊估驗補證', locationLabel: '舊估驗補證', stageKey: null, qtyCum: 100, reason: '依第 3 期估驗單複核', coversValuationId: 'v-old' }])
    expect(container.querySelector('button[type="submit"]').textContent).toContain('簽發並補證第 3 期')
  })
})
