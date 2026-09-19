// @vitest-environment jsdom
// P5e 保固期滿日與依據(履約時程的履約期程卡)。釘住:1) 兩項齊全才顯示期滿日,並說出兩項各自的來源(驗收紀錄、
// 契約條文);2) 缺哪項說哪項、給對的入口(合格日→驗收頁正式驗收;保固期間→登錄);3) 引用條文失效要明說;
// 4) 編輯器送出三鍵一起(數值、單位、引用條文),留空＝清除,沒選條文不能存(DB guard 仍是邊界)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import WarrantyBasis, { WarrantyTermEditor } from './WarrantyBasis.jsx'

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (el) => act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
const text = () => container.textContent
const links = () => [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])

describe('WarrantyBasis:保固期滿日與依據', () => {
  it('兩項齊全:顯示期滿日與兩項依據的來源', async () => {
    await render(<WarrantyBasis warranty={{ acceptance_date: '2026-03-15', term_value: 2, term_unit: 'year', source_ok: true, expiry: '2028-03-15' }}
      source={{ title: '保固期間自驗收合格日起 2 年', clause: '第 16 條' }} />)
    expect(text()).toContain('保固期滿 2028-03-15')
    expect(text()).toContain('2 年，依 第 16 條 「保固期間自驗收合格日起 2 年」')
    expect(links()).toContainEqual(['2026-03-15（驗收紀錄）', '/acceptance?stage=final'])
    expect(text()).not.toContain('待補')
  })
  it('缺正式驗收合格日:說缺什麼、導驗收頁;看不到條文內容時只說已引用', async () => {
    const onEdit = vi.fn()
    await render(<WarrantyBasis warranty={{ acceptance_date: null, term_value: 1, term_unit: 'year', source_ok: true, expiry: null }} onEditTerm={onEdit} />)
    expect(text()).toContain('保固期滿日待補（缺正式驗收合格日，無法判定保固期滿日）')
    expect(links()).toContainEqual(['到驗收登錄', '/acceptance?stage=final'])
    expect(text()).toContain('1 年，已引用契約條文')
    const edit = [...container.querySelectorAll('button')].find((b) => b.textContent === '更正')
    await act(async () => edit.click())
    expect(onEdit).toHaveBeenCalled()
  })
  it('沒有任何保固事實:兩項都缺;引用條文失效要明說', async () => {
    await render(<WarrantyBasis warranty={null} />)
    expect(text()).toContain('缺正式驗收合格日、缺契約保固期間')
    expect(text()).toContain('契約保固期間：未登錄')
    expect(container.querySelector('button')).toBeNull() // 沒有權限(未給 onEditTerm)就沒有登錄按鈕
    await render(<WarrantyBasis warranty={{ acceptance_date: '2026-03-15', term_value: 2, term_unit: 'year', source_ok: false, source_status: 'superseded', expiry: null }} />)
    expect(text()).toContain('保固期間引用的契約條文已不是已確認狀態')
    expect(text()).toContain('請重新引用')
  })
})

describe('WarrantyTermEditor:登錄／更正契約保固期間', () => {
  const setValue = (el, v) => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  const candidates = [{ id: 'r1', label: '第 16 條 保固期間 2 年' }, { id: 'r2', label: '第 9 條 施工計畫' }]
  it('三鍵一起送;沒選條文不能存', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    await render(<WarrantyTermEditor warranty={null} candidates={candidates} onSave={onSave} inputId="w" />)
    const save = () => [...container.querySelectorAll('button')].find((b) => /保固期間/.test(b.textContent))
    await act(async () => setValue(container.querySelector('#w'), '18'))
    await act(async () => setValue(container.querySelector('select[aria-label="保固期間單位"]'), 'month'))
    expect(save().disabled).toBe(true)
    await act(async () => setValue(container.querySelector('select[aria-label="引用的契約條文"]'), 'r1'))
    expect(save().disabled).toBe(false)
    await act(async () => save().click())
    expect(onSave).toHaveBeenCalledWith({ warranty_term_value: 18, warranty_term_unit: 'month', warranty_source_requirement_id: 'r1' })
  })
  it('既有值帶入;數值清空＝清除(三鍵皆 null)', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    await render(<WarrantyTermEditor warranty={{ term_value: 2, term_unit: 'year', source_requirement_id: 'r1' }} candidates={candidates} onSave={onSave} inputId="w" />)
    expect(container.querySelector('#w').value).toBe('2')
    await act(async () => setValue(container.querySelector('#w'), ''))
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === '清除保固期間')
    await act(async () => clear.click())
    expect(onSave).toHaveBeenCalledWith({ warranty_term_value: null, warranty_term_unit: null, warranty_source_requirement_id: null })
  })
})
