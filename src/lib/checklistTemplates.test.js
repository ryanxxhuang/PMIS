// 檢查表範本表單的純函式(P3g):與 DB checklist_templates_guard／fn_checklist_applies_to／
// fn_checklist_items_normalize(migration 20260920050000)同一組規則的前端鏡像。
import { describe, it, expect } from 'vitest'
import {
  canAuthorTemplate, parseKeywords, appliesToPayload, itemsPayload, templateFormIssues,
  templateRowPayload, templateFormFromRow, appliesToText, matchingLeaves, emptyTemplateForm,
} from './checklistTemplates.js'

const LEAVES = [
  { id: 'wi-1', item_key: 'K1', item_no: '壹.一.1', description: '結構用混凝土,預拌,280kgf/cm2,澆置' },
  { id: 'wi-2', item_key: 'K2', item_no: '壹.一.2', description: '模板,普通模板,樓版,含支撐' },
]
const form = (over = {}) => ({
  ...emptyTemplateForm('self_check'),
  title: '混凝土 自主檢查表',
  items: [{ no: 'A1', group: '', item: '模板無積水', kind: 'bool', min: '', max: '', unit: '', standard: '', source: '' }],
  ...over,
})

describe('誰可以維護哪種用途的範本(鏡像 can_write ＋ 監造查驗表單屬監造)', () => {
  it('自主檢查表吃 can_write;監造查驗表單另要 can.approve', () => {
    expect(canAuthorTemplate('self_check', { write: true, approve: false })).toBe(true)
    expect(canAuthorTemplate('inspection_form', { write: true, approve: false })).toBe(false)
    expect(canAuthorTemplate('inspection_form', { write: true, approve: true })).toBe(true)
  })
  it('沒有 can_write(機關／非成員)一律不能建', () => {
    expect(canAuthorTemplate('self_check', { write: false, approve: true })).toBe(false)
    expect(canAuthorTemplate('inspection_form', {})).toBe(false)
  })
})

describe('適用條件正規化(與 fn_checklist_applies_to 同結果)', () => {
  it('關鍵字:逗號／頓號／換行分隔,去空白、去重、排序', () => {
    expect(parseKeywords(' 混凝土 ，澆置、混凝土\n支撐, ')).toEqual(['支撐', '混凝土', '澆置'])
  })
  it('兩者皆空 → null(不是空物件)', () => {
    expect(appliesToPayload({ workItemIds: [], keywords: '  ,  ' })).toBeNull()
    expect(appliesToPayload({})).toBeNull()
  })
  it('只有空的那一邊不會寫進去', () => {
    expect(appliesToPayload({ workItemIds: ['wi-2', 'wi-1', 'wi-1'], keywords: '' })).toEqual({ work_item_ids: ['wi-1', 'wi-2'] })
    expect(appliesToPayload({ workItemIds: [], keywords: '模板' })).toEqual({ keywords: ['模板'] })
  })
})

describe('檢查項目正規化(與 fn_checklist_items_normalize 同結果)', () => {
  it('去空白、丟掉空的選填鍵、數字轉 number', () => {
    expect(itemsPayload([{ no: ' A1 ', item: ' 坍度 ', kind: 'num', min: '15.5', max: '20.5', unit: 'cm', standard: '', source: '', group: '' }]))
      .toEqual([{ no: 'A1', item: '坍度', kind: 'num', unit: 'cm', min: 15.5, max: 20.5 }])
  })
  it('勾選項不帶上下限(即使畫面上殘留)', () => {
    expect(itemsPayload([{ no: 'B1', item: '目視', kind: 'bool', min: '3', max: '9' }]))
      .toEqual([{ no: 'B1', item: '目視', kind: 'bool' }])
  })
})

describe('送出前的檢查(每一條都對應 DB 的一條 raise)', () => {
  it('齊備的表單沒有問題', () => {
    expect(templateFormIssues(form())).toEqual([])
  })
  it('標題必填', () => {
    expect(templateFormIssues(form({ title: '   ' }))).toContain('範本必須有標題。')
  })
  it('自主檢查表不得指定查驗階段', () => {
    expect(templateFormIssues(form({ stage_key: '澆置前' }))).toContain('只有監造查驗表單範本可以指定查驗階段。')
    expect(templateFormIssues(form({ kind: 'inspection_form', stage_key: '澆置前' }))).toEqual([])
  })
  it('查驗表單範本要監造權限(畫面與伺服器同一句話)', () => {
    expect(templateFormIssues(form({ kind: 'inspection_form' }), { canApproveInspection: false }))
      .toContain('監造查驗表單範本只有監造成員可建立或編輯。')
  })
  it('至少一個項目;項次必填、不重複;檢查內容必填', () => {
    expect(templateFormIssues(form({ items: [] }))).toContain('至少要有一個檢查項目。')
    expect(templateFormIssues(form({ items: [{ no: '', item: '甲', kind: 'bool' }] }))).toContain('項目「甲」缺少項次。')
    expect(templateFormIssues(form({ items: [{ no: 'A1', item: '甲', kind: 'bool' }, { no: 'A1', item: '乙', kind: 'bool' }] })))
      .toContain('項次「A1」重複。')
    expect(templateFormIssues(form({ items: [{ no: 'A1', item: '  ', kind: 'bool' }] }))).toContain('項次「A1」缺少檢查內容。')
  })
  it('實測值項目要有可判定的上下限、且下限不大於上限', () => {
    expect(templateFormIssues(form({ items: [{ no: 'A1', item: '坍度', kind: 'num', min: '', max: '' }] })))
      .toContain('項次「A1」是實測值，至少要有下限或上限才判定得了。')
    expect(templateFormIssues(form({ items: [{ no: 'A1', item: '坍度', kind: 'num', min: '20', max: '10' }] })))
      .toContain('項次「A1」的下限大於上限。')
    expect(templateFormIssues(form({ items: [{ no: 'A1', item: '坍度', kind: 'num', min: '15', max: '' }] }))).toEqual([])
  })
  it('完全空白的列不算一項,也不會被當成錯誤', () => {
    const f = form({ items: [{ no: 'A1', item: '甲', kind: 'bool' }, { no: '', item: '', kind: 'bool' }] })
    expect(templateFormIssues(f)).toEqual([])
    expect(templateRowPayload(f).items).toHaveLength(1)
  })
})

describe('表單 ↔ 列的往返', () => {
  it('自主檢查表的 stage_key 一律清成 null(即使表單殘留)', () => {
    expect(templateRowPayload(form({ kind: 'self_check', stage_key: '澆置前' })).stage_key).toBeNull()
  })
  it('空的依據存成 null,不是空字串', () => {
    expect(templateRowPayload(form({ source: '  ' })).source).toBeNull()
  })
  it('DB 列回表單:數字回字串、null 回空字串、關鍵字合併成一行', () => {
    const f = templateFormFromRow({
      id: 'T1', kind: 'inspection_form', title: '甲', source: null, stage_key: '澆置前',
      applies_to: { work_item_ids: ['wi-1'], keywords: ['混凝土', '澆置'] },
      items: [{ no: 'A1', item: '坍度', kind: 'num', min: 15.5, max: null }],
    })
    expect(f).toMatchObject({ id: 'T1', source: '', stage_key: '澆置前', workItemIds: ['wi-1'], keywords: '混凝土、澆置' })
    expect(f.items[0]).toMatchObject({ min: '15.5', max: '', unit: '', standard: '' })
    // 往返後送出的 payload 與原列等價
    expect(templateRowPayload(f).applies_to).toEqual({ work_item_ids: ['wi-1'], keywords: ['混凝土', '澆置'] })
  })
})

describe('畫面說明:適用範圍與會配到哪些工項', () => {
  it('沒登錄就明說沒登錄(不要讓人以為系統會自己配對)', () => {
    expect(appliesToText({ applies_to: null }, LEAVES)).toContain('未登錄適用條件')
  })
  it('指名工項顯示項次與描述;查驗階段一併顯示', () => {
    const t = appliesToText({ applies_to: { work_item_ids: ['wi-2'], keywords: ['模板'] }, stage_key: '拆模前' }, LEAVES)
    expect(t).toContain('壹.一.2 模板')
    expect(t).toContain('關鍵字：模板')
    expect(t).toContain('查驗階段：拆模前')
  })
  it('指名的工項已被刪除時如實顯示,不當成沒登錄', () => {
    expect(appliesToText({ applies_to: { work_item_ids: ['gone'] } }, LEAVES)).toContain('（已刪除的工項）')
  })
  it('預覽:指名工項是硬條件,關鍵字才比對描述', () => {
    expect(matchingLeaves({ workItemIds: ['wi-1'], keywords: '模板' }, LEAVES).map((l) => l.id)).toEqual(['wi-1'])
    expect(matchingLeaves({ workItemIds: [], keywords: '模板' }, LEAVES).map((l) => l.id)).toEqual(['wi-2'])
    expect(matchingLeaves({ workItemIds: [], keywords: '' }, LEAVES)).toEqual([])
  })
})
