// @vitest-environment jsdom
// 監造查驗紀錄表紙本＝監造的編輯畫面(2026-09-20 C2 包)。釘住:
//   1) 版面用臺北市原表欄名(抽查項目／設計圖說、規範之抽查標準／實際抽查情形／抽查結果／備註)且格內可編;
//   2) 可編角色是監造:廠商與機關開同一張紙不長出任何輸入框,列印視角完全沒有 input;
//   3) 抽查結果是系統算的——沒有人可以在紙上直接改;
//   4) 判定與本次確認數量的伺服器規則在格內編輯後**一條都沒放寬**(畫面即時預覽同一條規則);
//   5) 範例檔的示例數值與良好／不良範例判定不入產品;
//   6) 抄錄值旁看得到紙上原文,點「原文」回看原照片(B 包 field_sources[].evidence);
//   7) 簽署版本印它自己當時的範本版本。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import InspectionFormSheet from './InspectionFormSheet.jsx'

let container, root
const project = { project_name: 'A 標 道路改善工程', contractor_name: '甲營造' }
const workItem = { id: 'W1', item_no: '壹.一.1', description: '版牆混凝土', unit: 'M3', quantity: 500 }
const checklistTemplate = {
  id: 'T9', title: '鋼筋工程查驗表', source: '本案監造計畫',
  items: [
    { no: '1', group: '綁紮', item: '主筋間距', standard: '≤15cm', kind: 'num', unit: 'cm', max: 15 },
    { no: '2', group: '綁紮', item: '已通知監造', standard: '施工前通知', kind: 'bool' },
  ],
}
const doc = { id: 'D9', doc_type: 'inspection_form', doc_date: '2026-09-20', status: 'draft', current_version_no: 1, owner_org: 'supervisor' }
const inspection = { id: 'I9', title: '3F 版牆鋼筋查驗', requested_date: '2026-09-19', declared_qty: 100, unit: 'M3' }
const state = (over = {}) => ({
  content: {
    inspection_date: '2026-09-20', inspection_id: 'I9', inspection_title: '3F 版牆鋼筋查驗', subproject_name: '鋼筋工程',
    work_item_id: 'W1', location: '3F 版牆', stage_key: null, unit: 'M3', declared_qty: 100,
    self_check_record_id: null, template_id: 'T9', template_title: '鋼筋工程查驗表',
    results: { 1: { value: 13 }, 2: { value: null } }, verdict: null, confirmed_qty: null, result_note: null, note: null,
    check_timing: '檢驗停留點', ...over,
  },
  sources: {
    location: { status: 'filled', source: 'inspection:I9', reason: '取自查驗申請,請核對後確認' },
    declared_qty: { status: 'filled', source: 'inspection:I9' },
    'results.1': { status: 'filled', source: 'record:P7', refs: ['P7'], evidence: [{ photo_id: 'P7', raw_text: '主筋間距 13 cm', unit: 'cm', kind: 'measured' }] },
    'results.2': { status: 'pending', source: null },
    verdict: { status: 'pending', source: null },
    confirmed_qty: { status: 'pending', source: null },
  },
})

const render = async (props) => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <InspectionFormSheet project={project} doc={doc} inspection={inspection} workItem={workItem}
          checklistTemplate={checklistTemplate} checklistTemplates={[checklistTemplate]} stamp={null} {...props} />
      </MemoryRouter>,
    )
  })
}
const inputs = () => [...container.querySelectorAll('input, select, textarea')]
const byLabel = (l) => inputs().find((el) => el.getAttribute('aria-label') === l)
const text = () => container.textContent
const editCtx = (st, org = 'supervisor') => ({ org, editable: true, onChange: () => {}, state: st, photosById: new Map([['P7', { id: 'P7', url: 'blob:p7', caption: '紙本查驗表' }]]) })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('監造查驗紀錄表紙本:監造直接在原表格子裡編輯', () => {
  it('原表欄名與抄錄值都在格子裡;實測值可編,抽查結果不可編', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    expect(text()).toContain('設計圖說、規範之抽查標準（定性定量）')
    expect(text()).toContain('實際抽查情形（載明抽查數值及單位）')
    expect(text()).toContain('抽查結果符號說明')
    expect(text()).toContain('鋼筋工程 施 工 抽 查 紀 錄 表') // 表頭標題帶分項工程名稱(原表規定)
    expect(byLabel('1 主筋間距 實際抽查情形').value).toBe('13')
    expect(text()).toContain('紙上原文：主筋間距 13 cm')
    expect(byLabel('抽查位置').value).toBe('3F 版牆')
    // 抽查結果欄是系統判定,沒有任何輸入元件;13 ≤ 15 判合格
    expect(inputs().some((el) => /抽查結果$/.test(el.getAttribute('aria-label') || ''))).toBe(false)
    expect(text()).toContain('○')
  })

  it('確認數量區並列申報／單位／批次累計／本次／簽署後累計;判定是三選一的單選', async () => {
    const st = state({ confirmed_qty: 60, verdict: '部分合格', result_note: '東側待修補' })
    await render({ content: st.content, sources: st.sources, batchCum: 10, edit: editCtx(st) })
    const box = container.querySelector('[role="group"][aria-label="確認數量"]')
    expect(box.textContent).toContain('申報數量')
    expect(box.textContent).toContain('100 M3')
    expect(box.textContent).toContain('此批次已確認累計')
    expect(box.textContent).toContain('10 M3')
    expect(box.textContent).toContain('簽署後累計')
    expect(box.textContent).toContain('70 M3')
    expect(byLabel('本次確認數量').value).toBe('60')
    expect(container.querySelector('[role="radiogroup"][aria-label="判定"]')).toBeTruthy()
    expect(byLabel('部分合格').checked).toBe(true)
  })

  it('格內編輯不放寬伺服器規則:超過申報量、合格卻不等於申報、缺判定說明都即時列出', async () => {
    let st = state({ verdict: '合格', confirmed_qty: 120 })
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    const alertEl = () => container.querySelector('[role="alert"][aria-label="判定與確認數量檢查"]')
    expect(alertEl().textContent).toContain('超過申報數量 100')
    st = state({ verdict: '合格', confirmed_qty: 60 })
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    expect(alertEl().textContent).toContain('判定合格時本次確認數量須等於申報數量 100')
    st = state({ verdict: '部分合格', confirmed_qty: 60 })
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    expect(alertEl().textContent).toContain('必須填寫判定說明')
    // 全部一致就沒有警示(不是把警示藏起來,是規則真的過了)
    st = state({ verdict: '部分合格', confirmed_qty: 60, result_note: '東側 40 M3 待修補' })
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    expect(alertEl()).toBeNull()
  })

  it('單位與階段的伺服器規則也照舊提示:單位不一致、工項沒有必要階段卻帶階段', async () => {
    let st = state({ unit: 'M2' })
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    expect(text()).toContain('簽署會被拒絕')
    st = state({ stage_key: '綁紮完成' })
    await render({ content: st.content, sources: st.sources, requiredStages: [], edit: editCtx(st) })
    expect(text()).toContain('此工項沒有必要查驗階段')
  })

  it('廠商／機關視角與列印視角:不長出監造欄位的輸入框', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, edit: editCtx(st, 'contractor') })
    expect(byLabel('本次確認數量')).toBeUndefined()
    expect(byLabel('抽查位置')).toBeUndefined()
    expect(text()).toContain('3F 版牆')
    await render({ content: st.content, sources: st.sources, edit: editCtx(st, 'owner') })
    expect(inputs()).toHaveLength(0)
    await render({ content: st.content, sources: st.sources })
    expect(inputs()).toHaveLength(0)
    expect(text()).toContain('參考臺北市格式')
    expect(text()).toContain('未經機關核定')
  })

  it('臺北市範例檔的示例數值與良好／不良範例判定不入產品', async () => {
    const st = state()
    await render({ content: { ...st.content, template_id: null }, sources: st.sources, checklistTemplate: null, edit: editCtx(st) })
    expect(text()).toContain('未使用本案查驗表範本')
    for (const bad of ['4.5cm', '3.8cm', '≧4', '良好範例', '不良範例', '○○營造']) expect(text()).not.toContain(bad)
  })

  it('點「原文」回看紙上原文與原照片(用 B 包已寫進 field_sources 的那一份)', async () => {
    const st = state()
    await render({ content: st.content, sources: st.sources, edit: editCtx(st) })
    const row = container.querySelector('#field-results-1')
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('原文'))
    await act(async () => { btn.click() })
    const panel = row.querySelector('[aria-label="欄位證據"]')
    expect(panel.textContent).toContain('主筋間距 13 cm')
    expect(panel.textContent).toContain('紙上實測欄')
    expect(panel.querySelector('img').getAttribute('src')).toBe('blob:p7')
  })

  it('已簽署版本印它自己當時的範本版本', async () => {
    const st = state()
    await render({ content: { ...st.content, form_template: { key: 'taipei-inspection-ref', version: 0 } }, sources: st.sources })
    expect(text()).toContain('本文件建立時使用 taipei-inspection-ref v0')
  })
})
