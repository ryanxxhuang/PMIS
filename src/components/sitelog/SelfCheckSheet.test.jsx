// @vitest-environment jsdom
// 自主檢查表紙本＝廠商的編輯畫面(2026-09-20 C 包)。釘住:
//   1) 版面用原表欄名(檢查項目／設計圖說、規範之檢查標準／實際檢查情形／檢查結果／備註)且格內可編;
//   2) 版面參考與技術標準分離:標準只來自本案檢查表範本,沒有範本就待補、不可簽;
//   3) 判定是系統算的——沒有任何人可以在紙上直接改「檢查結果」;
//   4) 唯讀／列印視角沒有 input;監造開同一張紙也不長出廠商欄位的輸入框;
//   5) 簽署版本印它自己當時的範本版本。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import SelfCheckSheet from './SelfCheckSheet.jsx'

let container, root
const project = { project_name: 'A 標 道路改善工程', contractor_name: '甲營造' }
const checklistTemplate = {
  id: 'T1', title: '混凝土自主檢查表', source: '03310',
  items: [
    { no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', standard: '≥24 小時', kind: 'bool' },
    { no: 'C2', group: '澆置中', item: '坍度', standard: '18±2.5cm', kind: 'num', unit: 'cm', min: 15.5, max: 20.5 },
  ],
}
const doc = { id: 'D1', doc_type: 'self_check', doc_date: '2026-09-20', status: 'draft', current_version_no: 1, owner_org: 'contractor' }
const state = () => ({
  content: {
    check_date: '2026-09-20', template_id: 'T1', template_title: '混凝土自主檢查表', template_source: '03310',
    work_item_id: null, location: '4F 版牆', check_timing: '查驗停留點',
    results: { B1: { value: null }, C2: { value: 18 } }, note: null,
  },
  sources: {
    location: { status: 'filled', source: 'ai:photo' },
    'results.C2': { status: 'filled', source: 'record:P9', refs: ['P9'], evidence: [{ photo_id: 'P9', raw_text: '坍度 18 cm', unit: 'cm', kind: 'measured' }] },
    'results.B1': { status: 'pending', source: null },
  },
})

const render = async (props) => {
  await act(async () => { root.render(<SelfCheckSheet project={project} doc={doc} checklistTemplate={checklistTemplate} stamp={null} {...props} />) })
}
const inputs = () => [...container.querySelectorAll('input, select, textarea')]
const byLabel = (l) => inputs().find((el) => el.getAttribute('aria-label') === l)
const text = () => container.textContent

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('自主檢查表紙本:廠商直接在原表格子裡編輯', () => {
  it('原表欄名與抄錄值都在格子裡;實測值可編,檢查結果不可編', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, edit: { org: 'contractor', editable: true, onChange: () => {}, state: st, photosById: new Map() } })
    expect(text()).toContain('設計圖說、規範之檢查標準（定性定量）')
    expect(text()).toContain('實際檢查情形（載明檢查數值及單位）')
    expect(text()).toContain('檢查結果符號說明')
    expect(byLabel('C2 坍度 實際檢查情形').value).toBe('18')
    expect(text()).toContain('紙上原文：坍度 18 cm')
    expect(byLabel('檢查位置').value).toBe('4F 版牆')
    // 檢查結果欄是系統判定,沒有任何輸入元件
    expect(inputs().some((el) => /檢查結果$/.test(el.getAttribute('aria-label') || ''))).toBe(false)
    expect(text()).toContain('○') // C2 = 18 落在 18±2.5,判合格
  })

  it('沒有本案檢查表範本:標準與項目一律待補,不引用任何示例標準', async () => {
    const st = state()
    await render({ content: { ...st.content, template_id: null }, sources: st.sources, checklistTemplate: null, edit: { org: 'contractor', editable: true, onChange: () => {}, state: st, photosById: new Map() } })
    expect(text()).toContain('尚未選擇本案檢查表範本')
    expect(text()).not.toContain('4.5cm') // 臺北市範例檔的示例數值不得出現
    expect(text()).not.toContain('≧4')
  })

  it('監造視角與列印視角:不長出廠商欄位的輸入框', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, edit: { org: 'supervisor', editable: true, onChange: () => {}, state: st, photosById: new Map() } })
    expect(byLabel('檢查位置')).toBeUndefined()
    expect(text()).toContain('4F 版牆')
    await render({ content: st.content, sources: st.sources })
    expect(inputs()).toHaveLength(0)
    expect(text()).toContain('參考臺北市格式')
    expect(text()).toContain('未經機關核定')
  })

  it('已簽署版本印它自己當時的範本版本', async () => {
    const st = state()
    await render({ content: { ...st.content, form_template: { key: 'taipei-self-check-ref', version: 0 } }, sources: st.sources })
    expect(text()).toContain('本文件建立時使用 taipei-self-check-ref v0')
  })
})

// G 包:兩向尺寸／多編號分列在「實際檢查情形」格裡;唯讀／列印印文字(PDF 由這張紙抄)
describe('自主檢查表紙本:分列讀數', () => {
  const tplW = {
    id: 'TW', title: '鋼線網自主檢查表', source: '圖說',
    items: [{ no: 'W1', item: '鋼線網線徑', standard: '依圖說', kind: 'num', unit: 'mm', min: 10, max: 14 }],
  }
  const rd = [{ entry_no: '1', value: 13, value2: 11, raw_text: '13 * 11 MM' }, { entry_no: '4', value: 11, value2: 11, raw_text: '11 * 11 MM' }]
  const st = (results) => ({
    content: { check_date: '2026-08-04', template_id: 'TW', template_title: '鋼線網自主檢查表', work_item_id: null, location: '4-4-25M', results, note: null },
    sources: { 'results.W1': { status: 'filled', source: 'record:P1', refs: ['P1'], evidence: [
      { photo_id: 'P1', raw_text: '13 * 11 MM', entry_no: '1', unit: 'MM', kind: 'measured' },
      { photo_id: 'P1', raw_text: '11 * 11 MM', entry_no: '4', unit: 'MM', kind: 'measured' },
    ] } },
  })

  it('唯讀:逐筆印出編號與兩向尺寸,不長 input;判定 ○', async () => {
    const s = st({ W1: { value: null, readings: rd } })
    await render({ content: s.content, sources: s.sources, checklistTemplate: tplW })
    expect(inputs()).toHaveLength(0)
    expect(text()).toContain('編號 1　13×11 mm')
    expect(text()).toContain('編號 4　11×11 mm')
    expect(text()).toContain('○')
  })

  it('廠商編輯:每筆一列(編號／讀數／第二向)可改可刪可加;紙上原文逐筆標編號', async () => {
    let changed = null
    const s = st({ W1: { value: null, readings: rd } })
    await render({ content: s.content, sources: s.sources, checklistTemplate: tplW, edit: { org: 'contractor', editable: true, onChange: (n) => { changed = n }, photosById: new Map() } })
    expect(byLabel('W1 鋼線網線徑 第 1 筆 編號').value).toBe('1')
    expect(byLabel('W1 鋼線網線徑 第 2 筆 讀數').value).toBe('11')
    expect(byLabel('W1 鋼線網線徑 第 2 筆 第二向').value).toBe('11')
    expect(text()).toContain('紙上原文：13 * 11 MM（編號 1）、11 * 11 MM（編號 4）')
    const del = container.querySelector('[aria-label="刪除 W1 鋼線網線徑 第 1 筆"]')
    await act(async () => { del.click() })
    expect(changed.content.results.W1).toEqual({ value: null, readings: [rd[1]] })
    expect(changed.sources['results.W1']).toEqual({ status: 'confirmed', source: 'human' })
  })

  it('單一值模式可按「分列」轉成讀數列,原值帶進第一筆', async () => {
    let changed = null
    const s = st({ W1: { value: 12 } })
    await render({ content: s.content, sources: {}, checklistTemplate: tplW, edit: { org: 'contractor', editable: true, onChange: (n) => { changed = n }, photosById: new Map() } })
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === '分列')
    await act(async () => { btn.click() })
    expect(changed.content.results.W1).toEqual({ value: null, readings: [{ entry_no: null, value: 12, value2: null, raw_text: null }] })
  })
})
