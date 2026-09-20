// @vitest-environment jsdom
// 施工日誌列印(P3d;廠商驗收 D 補「下載 PDF」的接線):
// - 有簽署列 → 印簽署列指向的版本(即使之後已開更正草稿):內容取該版本、頁首印版本／雜湊前 12 碼(DB 值)／簽署者／台北時間;
// - 沒有簽署列 → 印最新存檔版本並整張標「草稿・未簽署」;
// - 有簽署列卻讀不到該版本 → 明說讀取失敗,不以最新版本代印;
// - 沒有文件、只有舊流程的既有日誌列 → 印該列並標「既有紀錄」「草稿・未簽署」(無版本與雜湊);
// - 累計＝此日之前的日誌列＋本張紙本(不把同日既有列重複算進來)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null, pdfCalls: [] }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
// 下載 PDF 的實作(pdf-lib／fontkit／中文字型)在 jsdom 跑不起來也不該跑:
// 這裡只驗「按下去時交給它的是哪一份文件」,產檔本身由 e2e/pdf-download.spec.js 實際下載核對。
vi.mock('../../lib/pdf/downloadPaperPdf.js', () => ({
  downloadPaperPdf: (el, opts) => { state.pdfCalls.push(opts); return Promise.resolve({ pageCount: 1 }) },
}))
import SiteLogPrint from './SiteLogPrint.jsx'

let container, root
const item = { id: 'w1', item_key: 'K1', item_no: '壹.1', description: '目前工項名稱', unit: 'M3', quantity: 500, sort_order: 1 }
const doc = (over = {}) => ({ id: 'D1234567-aaaa', project_id: 'p1', doc_type: 'daily_log', owner_org: 'contractor', doc_date: '2026-09-18', status: 'draft', current_version_no: 3, ...over })
const content = (qty, summary) => ({
  log_date: '2026-09-18', weather_am: '晴', weather_pm: '陰', labor: [{ type: '鋼筋工', count: 4 }], equipment: [], materials: [], extras: {}, work_summary: summary,
  items: { w1: { item_key: 'K1', item_no: '壹.1', description: '簽署當時名稱', unit: 'M3', qty_today: qty } },
})
const version = (no, qty, summary, hash) => ({ id: `V${no}`, document_id: 'D1234567-aaaa', version_no: no, content_hash: hash, content: content(qty, summary), field_sources: {}, attachments: [] })
const signature = { id: 'G2', document_id: 'D1234567-aaaa', version_no: 2, content_hash: 'bbbbbbbbbbbb2222', signer_name_snapshot: '陳怡君', signed_at: '2026-09-18T01:30:00+00:00', method: 'platform_account' }
const priorLog = { id: 'L0', log_date: '2026-09-17', items: { K1: 5 }, labor: [{ type: '鋼筋工', count: 3 }], equipment: [], materials: [], extras: {}, status: '已送出' }

function makeStore(over = {}) {
  const docs = over.documents || []
  return {
    project: { project_name: 'A 案', contractor_name: '甲營造' }, workItems: { items: [item] }, currentUser: { org_type: 'contractor', user_id: 'u1' },
    siteLogs: [], fieldDocuments: { documents: docs, submissions: [] }, fieldDocsLoading: false,
    findActiveDailyLogDoc: (date) => docs.find((d) => d.doc_date === date) || null,
    getFieldDocument: vi.fn().mockResolvedValue(null), getFieldDocumentVersion: vi.fn().mockResolvedValue(null), getFieldDocumentTemplate: vi.fn(),
    ...over,
  }
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
const render = (entry) => act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><SiteLogPrint /></MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const stamp = () => container.querySelector('[role="group"][aria-label="文件版本與簽署"]')?.textContent || ''
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const text = () => container.textContent

describe('施工日誌列印', () => {
  it('印簽署列指向的版本(之後已開更正草稿 v3):內容、雜湊、簽署者與台北時間都是 v2 的', async () => {
    const d = doc({ status: 'draft', current_version_no: 3 })
    const getFieldDocumentVersion = vi.fn().mockResolvedValue(version(2, 7, '簽署版摘要', 'bbbbbbbbbbbb2222'))
    state.store = makeStore({
      documents: [d], siteLogs: [priorLog],
      getFieldDocument: vi.fn().mockResolvedValue({ doc: d, version: version(3, 99, '更正草稿摘要', 'cccccccccccc3333'), versions: [], signatures: [signature], submissions: [] }),
      getFieldDocumentVersion,
    })
    await render('/site-log/print?doc=D1234567-aaaa'); await flush(); await flush()
    expect(getFieldDocumentVersion).toHaveBeenCalledWith('D1234567-aaaa', 2)
    expect(stamp()).toContain('文件 D1234567')
    expect(stamp()).toContain('版本 2')
    expect(stamp()).toContain('內容雜湊 bbbbbbbbbbbb')
    expect(stamp()).not.toContain('bbbbbbbbbbbb2') // 只印前 12 碼
    expect(stamp()).toContain('簽署 陳怡君・2026-09-18 09:30・平台帳號') // 伺服器時間換成台北時間
    expect(stamp()).not.toContain('草稿・未簽署')
    expect(text()).toContain('簽署版摘要')
    expect(text()).not.toContain('更正草稿摘要')
    expect(text()).toContain('簽署當時名稱') // 工項名稱取版本快照,不取之後的工項表
    // 累計＝前一日 5 ＋本張 7(不把同日列重算)
    const row = [...container.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('簽署當時名稱'))
    // C 包:欄序改成原表(附表四)本身——第一欄就是「施工項目」(項次併在名稱前,原表沒有獨立項次欄),
    // 末欄是原表本來就有的「備註」(items.<id>.note)。
    expect([...row.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['壹.1 簽署當時名稱', 'M3', '500', '7', '12', ''])
    expect(text()).toContain('本日天氣：上午晴下午陰') // 表頭天氣照原表上下午兩格

    // 下載 PDF 走的是同一份簽署版本:檔名要說得出版次與已簽署,才不會在系統外被當成草稿
    state.pdfCalls.length = 0
    await act(async () => button('下載 PDF').click())
    await flush()
    expect(state.pdfCalls).toHaveLength(1)
    expect(state.pdfCalls[0].fileName).toBe('施工日誌_2026-09-18_v2_已簽署')
    // 列印入口保留,但不再自稱是下載(驗收報告 P1)
    expect(button('列印')).toBeTruthy()
    expect(text()).not.toContain('存 PDF')
  })

  it('沒有簽署列:印最新存檔版本並整張標草稿・未簽署', async () => {
    const d = doc({ status: 'pending_input', current_version_no: 1 })
    state.store = makeStore({ documents: [d], getFieldDocument: vi.fn().mockResolvedValue({ doc: d, version: version(1, 3, '草稿摘要', 'aaaaaaaaaaaa1111'), versions: [], signatures: [], submissions: [] }) })
    await render('/site-log/print?d=2026-09-18'); await flush(); await flush()
    expect(stamp()).toContain('版本 1')
    expect(stamp()).toContain('內容雜湊 aaaaaaaaaaaa')
    expect(stamp()).toContain('草稿・未簽署')
    expect(stamp()).toContain('文件狀態 待補件')
    expect(text()).toContain('草稿摘要')

    // 沒簽署的版本下載下來也要看得出沒簽:紙面標草稿,檔名也要標
    state.pdfCalls.length = 0
    await act(async () => button('下載 PDF').click())
    await flush()
    expect(state.pdfCalls[0].fileName).toBe('施工日誌_2026-09-18_v1_草稿未簽署')
  })

  it('有簽署列卻讀不到簽署版本:明說讀取失敗,不以最新版本代印', async () => {
    const d = doc({ status: 'draft', current_version_no: 3 })
    state.store = makeStore({
      documents: [d],
      getFieldDocument: vi.fn().mockResolvedValue({ doc: d, version: version(3, 99, '更正草稿摘要', 'cccccccccccc3333'), versions: [], signatures: [signature], submissions: [] }),
      getFieldDocumentVersion: vi.fn().mockResolvedValue(null),
    })
    await render('/site-log/print?doc=D1234567-aaaa'); await flush(); await flush()
    expect(text()).toContain('無法讀取已簽署的版本 2')
    expect(text()).not.toContain('更正草稿摘要')
    expect(stamp()).toBe('')
  })

  it('文件尚無已保存版本:說明沒有可列印的內容,不無限載入', async () => {
    const d = doc({ current_version_no: 0 })
    state.store = makeStore({ documents: [d], getFieldDocument: vi.fn().mockResolvedValue({ doc: d, version: null, versions: [], signatures: [], submissions: [] }) })
    await render('/site-log/print?doc=D1234567-aaaa'); await flush(); await flush()
    expect(text()).toContain('此文件尚無已保存的版本')
  })

  it('沒有文件、只有舊流程的既有日誌列:印該列並如實標既有紀錄・草稿・未簽署', async () => {
    state.store = makeStore({ siteLogs: [{ ...priorLog, log_date: '2026-09-18', work_summary: '舊流程摘要' }] })
    await render('/site-log/print?d=2026-09-18'); await flush()
    expect(stamp()).toContain('既有紀錄（舊流程寫入，無文件版本與內容雜湊）')
    expect(stamp()).toContain('草稿・未簽署')
    expect(stamp()).not.toContain('內容雜湊 ')
    expect(text()).toContain('舊流程摘要')
  })

  it('找不到指定文件:明說並可返回', async () => {
    state.store = makeStore()
    await render('/site-log/print?doc=NOPE'); await flush()
    expect(text()).toContain('無此施工日誌文件')
  })
})
