// @vitest-environment jsdom
// 施工日誌紙本＝廠商的編輯畫面(2026-09-20 C 包)。這支測試釘住驗收要求的五件事:
//   1) AI／紙本抄錄帶進來的值**直接出現在原表的格子裡**(不是另一份精簡表填完再切紙本預覽);
//   2) 點欄位能回看原文與原照片(用 B 包的 field_sources[].evidence,不另建一套);
//   3) 可編角色由 mapping 決定:廠商可編自己的日誌,監造開同一張紙不會長出輸入框;
//   4) 唯讀／列印視角沒有任何 input(唯讀 e2e 契約),也不掛來源章;
//   5) 工期與進度算不出來印「待補」,不猜數字;已簽署版本印它自己當時的範本版本。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import SiteLogOfficialSheet from './SiteLogOfficialSheet.jsx'
import { emptyDailyLogContent } from '../lib/fieldDocs.js'
import { dailyLogHeaderFacts } from '../lib/officialForms.js'

let container, root
const project = { project_name: 'A 標 道路改善工程', contractor_name: '甲營造', commencement_date: '2026-03-01', end_date: '2026-12-31' }
const itemList = [{ id: 'w1', item_key: 'K1', item_no: '壹.1', description: '4F 版牆混凝土澆置', unit: 'M3', quantity: 500, sort_order: 1 }]

// 照片辨識後的草稿:天氣與摘要由 AI 帶入待確認、工項數量由紙本實測欄抄錄(附原文與來源照片)
const draft = () => ({
  content: {
    ...emptyDailyLogContent('2026-09-18'),
    weather_am: '晴', work_summary: '4F 版牆綁紮及澆置',
    items: { w1: { item_key: 'K1', item_no: '壹.1', description: '4F 版牆混凝土澆置', unit: 'M3', qty_today: 12.5, location: null, note: null } },
  },
  sources: {
    weather_am: { status: 'filled', source: 'cwa' },
    work_summary: { status: 'filled', source: 'ai:photo' },
    'items.w1.qty_today': {
      status: 'filled', source: 'whiteboard:P1', refs: ['P1'],
      evidence: [{ photo_id: 'P1', raw_text: '本日澆置 12.5 M3', unit: 'M3', kind: 'quantity' }],
    },
    weather_pm: { status: 'pending', source: null },
  },
})
const photosById = new Map([['P1', { id: 'P1', url: 'blob:photo-1', caption: '4F 版牆告示板' }]])
const facts = dailyLogHeaderFacts({ project, progressPlan: null, logDate: '2026-09-18', actualPct: null })

const render = async (props) => {
  await act(async () => { root.render(<SiteLogOfficialSheet project={project} siteLogs={[]} itemList={itemList} facts={facts} {...props} />) })
}
const inputs = () => [...container.querySelectorAll('input, select, textarea')]
const byLabel = (label) => inputs().find((el) => el.getAttribute('aria-label') === label)
const text = () => container.textContent

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('施工日誌紙本:廠商直接在原表格子裡編輯', () => {
  it('AI 與紙本抄錄帶入的值就在格子裡,不必先填另一份表', async () => {
    const d = draft()
    await render({ content: d.content, sources: d.sources, docDate: '2026-09-18', edit: { org: 'contractor', editable: true, onChange: () => {}, state: d, photosById, leaves: [], byId: new Map(itemList.map((i) => [i.id, i])) } })
    expect(byLabel('本日天氣上午').value).toBe('晴')
    expect(byLabel('施工概況摘要').value).toBe('4F 版牆綁紮及澆置')
    expect(byLabel('壹.1 4F 版牆混凝土澆置 本日完成數量').value).toBe('12.5')
    // 原表欄名與節次在畫面上(不是自創的精簡標題)
    expect(text()).toContain('一、依施工計畫書執行按圖施工概況')
    expect(text()).toContain('二、工地材料管理概況')
    expect(text()).toContain('三、工地人員及機具管理')
    expect(text()).toContain('簽章：【工地主任】（註 3）')
    // 來源輕量呈現:帶入的標待核對、沒來源的標待補
    expect(text()).toContain('已帶入・待核對')
    expect(text()).toContain('待補')
  })

  it('點欄位可回看紙上原文與原照片(用既有 evidence,不另存一份)', async () => {
    const d = draft()
    await render({ content: d.content, sources: d.sources, docDate: '2026-09-18', edit: { org: 'contractor', editable: true, onChange: () => {}, state: d, photosById, leaves: [], byId: new Map(itemList.map((i) => [i.id, i])) } })
    // 抄錄進來的值旁邊直接看得到紙上原文(一行,列印不印)
    expect(text()).toContain('紙上原文：本日澆置 12.5 M3')
    // 原照片要點一下才展開(不在表單上鋪滿縮圖)
    expect(container.querySelector('img[src="blob:photo-1"]')).toBeNull()
    const openers = [...container.querySelectorAll('button')].filter((b) => b.textContent.includes('原文'))
    expect(openers.length).toBeGreaterThan(0)
    await act(async () => openers[openers.length - 1].click())
    expect(container.querySelector('img[src="blob:photo-1"]')).toBeTruthy()
  })

  it('可編角色由 mapping 決定:監造開同一張紙不會長出廠商欄位的輸入框', async () => {
    const d = draft()
    await render({ content: d.content, sources: d.sources, docDate: '2026-09-18', edit: { org: 'supervisor', editable: true, onChange: () => {}, state: d, photosById, leaves: [], byId: new Map(itemList.map((i) => [i.id, i])) } })
    expect(byLabel('本日天氣上午')).toBeUndefined()
    expect(text()).toContain('晴') // 值仍看得到,只是不能改
    expect(inputs().filter((el) => el.tagName !== 'BUTTON')).toHaveLength(0)
  })

  it('唯讀／列印視角:沒有任何 input,也不掛來源章', async () => {
    const d = draft()
    await render({ content: d.content, sources: d.sources, docDate: '2026-09-18' })
    expect(inputs()).toHaveLength(0)
    expect(text()).toContain('晴')
    expect(text()).toContain('12.5')
    expect(text()).not.toContain('已帶入・待核對')
  })

  it('工期與進度算不出來印待補;範本標示誠實', async () => {
    const d = draft()
    await render({ content: d.content, sources: d.sources, docDate: '2026-09-18' })
    expect(text()).toContain('核定工期：306 天')
    expect(text()).toContain('累計工期：202 天')
    expect(text()).toContain('預定進度(%)：待補') // 本案沒有預定進度表
    expect(text()).toContain('實際進度(%)：待補') // 尚無估驗
    expect(text()).toContain('參考工程會格式')
    expect(text()).toContain('未經機關核定')
  })

  it('已簽署版本印它自己當時的範本版本(之後改範本不改寫舊文件)', async () => {
    const d = draft()
    d.content.form_template = { key: 'pcc-daily-log-1080430', version: 0 }
    await render({ content: d.content, sources: d.sources, docDate: '2026-09-18' })
    expect(text()).toContain('本文件建立時使用 pcc-daily-log-1080430 v0')
  })
})
