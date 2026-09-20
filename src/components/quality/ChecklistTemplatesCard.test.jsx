// @vitest-environment jsdom
// 檢查表範本建立／編輯介面(P3g;品質查驗頁「檢查表」分段)。補 P3c 留下的 G5 缺口:
// - 用途(kind)可選:自主檢查表吃 can_write、監造查驗表單另要監造權限(選單不給沒權限的用途);
// - 適用工項與關鍵字寫進 applies_to(送出前正規化),查驗階段只對查驗表單出現且選自本案 H 點;
// - 送出前用與 DB 同一組規則擋(項次重複、實測值沒有上下限…),伺服器拒絕時如實顯示;
// - 已被檢查紀錄／查驗引用的範本:說明不可改內容,並提供「另存為新版本」(走建立路徑)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import ChecklistTemplatesCard from './ChecklistTemplatesCard.jsx'

let container, root
const CAN = { write: true, approve: true }
const LEAVES = [
  { id: 'wi-1', item_key: 'K1', item_no: '壹.一.1', description: '結構用混凝土,預拌,280kgf/cm2,澆置', unit: 'M3' },
  { id: 'wi-2', item_key: 'K2', item_no: '壹.一.2', description: '模板,普通模板,樓版,含支撐', unit: 'M2' },
]
const TPL = {
  id: 'T1', title: '混凝土 自主檢查表', kind: 'self_check', version: 1, source: '03310',
  items: [{ no: 'A1', item: '模板無積水', kind: 'bool' }], applies_to: { keywords: ['混凝土'] },
}

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
const render = (props = {}) => act(async () => {
  root.render(<MemoryRouter><ChecklistTemplatesCard
    templates={[]} records={[]} inspections={[]} leaves={LEAVES} stageKeys={['澆置前', '拆模前']}
    can={CAN} onSave={vi.fn()} {...props} /></MemoryRouter>)
})
const click = (el) => act(async () => { el.click() })
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const field = (label) => [...container.querySelectorAll('input, select')].find((el) => el.getAttribute('aria-label') === label
  || el.closest('label')?.textContent?.startsWith(label) || el.getAttribute('placeholder') === label)
const setValue = (el, value) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})

describe('用途選單只給有權限的用途', () => {
  it('監造:兩種用途都在', async () => {
    await render()
    await click(button('新增範本'))
    const kind = field('範本用途')
    expect([...kind.options].map((o) => o.value)).toEqual(['self_check', 'inspection_form'])
  })
  it('廠商(can.approve=false):只剩自主檢查表', async () => {
    await render({ can: { write: true, approve: false } })
    await click(button('新增範本'))
    expect([...field('範本用途').options].map((o) => o.value)).toEqual(['self_check'])
  })
  it('機關／非成員(can.write=false):連新增鈕都沒有,既有範本也沒有編輯鈕', async () => {
    await render({ can: { write: false, approve: false }, templates: [TPL] })
    expect(button('新增範本')).toBeUndefined()
    expect(button('編輯')).toBeUndefined()
  })
})

describe('建立查驗表單範本:kind／查驗階段／適用條件／項目一起送出', () => {
  it('查驗階段只在查驗表單出現,選項來自本案 H 點;適用條件與項目正規化後送出', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null })
    await render({ onSave })
    await click(button('新增範本'))
    expect(field('查驗階段')).toBeUndefined() // 預設 self_check
    await setValue(field('範本用途'), 'inspection_form')
    const stage = field('查驗階段')
    expect([...stage.options].map((o) => o.value)).toEqual(['', '澆置前', '拆模前'])
    await setValue(stage, '澆置前')
    await setValue(field('如 場鑄結構用混凝土 自主檢查表'), '混凝土 查驗表')
    await setValue(field('混凝土、澆置'), ' 混凝土 、澆置、混凝土 ')
    await setValue(field('第 1 項項次'), 'A1')
    await setValue(field('第 1 項檢查內容'), '模板無積水')
    await click(button('建立範本'))
    expect(onSave).toHaveBeenCalledWith({
      id: null, title: '混凝土 查驗表', source: null, kind: 'inspection_form', stage_key: '澆置前',
      applies_to: { keywords: ['混凝土', '澆置'] },
      items: [{ no: 'A1', item: '模板無積水', kind: 'bool' }],
    })
  })

  it('送出前擋下不合格的表單(與 DB 同一組規則),不打伺服器', async () => {
    const onSave = vi.fn()
    await render({ onSave })
    await click(button('新增範本'))
    await setValue(field('如 場鑄結構用混凝土 自主檢查表'), '甲表')
    await setValue(field('第 1 項項次'), 'A1')
    await setValue(field('第 1 項檢查內容'), '坍度')
    await setValue(field('第 1 項檢查方式'), 'num')
    await click(button('建立範本'))
    expect(onSave).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]').textContent).toContain('至少要有下限或上限')
  })

  it('伺服器拒絕時原樣顯示訊息,表單留著', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: { message: '監造查驗表單範本只有監造成員可建立或編輯' } })
    await render({ onSave })
    await click(button('新增範本'))
    await setValue(field('如 場鑄結構用混凝土 自主檢查表'), '甲表')
    await setValue(field('第 1 項項次'), 'A1')
    await setValue(field('第 1 項檢查內容'), '目視')
    await click(button('建立範本'))
    expect(container.textContent).toContain('監造查驗表單範本只有監造成員可建立或編輯')
    expect(button('建立範本')).toBeTruthy()
  })
})

describe('清單:適用範圍說明與已被引用的範本', () => {
  it('沒登錄適用條件就明說,不讓人以為系統會自己配對', async () => {
    await render({ templates: [{ ...TPL, applies_to: null }] })
    expect(container.textContent).toContain('未登錄適用條件')
  })
  it('已被檢查紀錄引用 → 標記＋編輯時說明不可改內容,並提供另存新版本', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null })
    await render({ templates: [TPL], records: [{ id: 'CR1', template_id: 'T1' }], onSave })
    expect(container.textContent).toContain('已被引用')
    await click(button('編輯'))
    expect(container.textContent).toContain('另存為新版本')
    await click(button('另存為新版本'))
    await click(button('建立範本'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: null, title: '混凝土 自主檢查表' }))
  })
  it('未被引用的範本直接就地儲存(帶 id 走更新路徑)', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null })
    await render({ templates: [TPL], onSave })
    await click(button('編輯'))
    await click(button('儲存範本'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'T1', kind: 'self_check' }))
  })
  it('內建示範範本不給編輯,只給「以此建立本案範本」(走建立路徑)', async () => {
    await render({ templates: [{ id: 'builtin-03310', builtin: true, title: '示範', items: [{ no: 'A1', item: '甲', kind: 'bool' }] }] })
    expect(button('編輯')).toBeUndefined()
    await click(button('以此建立本案範本'))
    expect(button('建立範本')).toBeTruthy()
  })
})
