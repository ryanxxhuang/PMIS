// @vitest-environment jsdom
// 施工日誌文件頁(P2c):
// - 保存狀態章:本日尚無日誌 → 填了值變「未存檔」(登記到未存檔登記簿)→ 存檔=建草稿＋存版本;
// - 樂觀併發:伺服器版本已前進(PD001)→ 明確提示重新載入、輸入留著,不默默覆蓋;
// - 既有未簽署日誌:以其內容帶入、來源標「既有紀錄」,不偽造簽署;
// - 待補集中呈現、未齊不給簽;簽署遇 PD003 → 引導兩步驟驗證(沒有因子 → 前往帳號安全);
// - 唯讀視角(監造):除日期外沒有 input、沒有存檔鈕;已提送時有收件／退回;
// - 廠商對已簽署文件只能「建立更正版本」後才可編。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { unsavedEditLabels } from '../../lib/unsavedEdits.js'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import SiteLog from './SiteLog.jsx'

let container, root
const leaf = { id: 'w1', item_key: 'K1', item_no: '壹.一.1', description: '4F 版牆混凝土澆置', unit: 'M3', quantity: 500, is_billable: true, is_leaf: true }
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const baseDoc = (over = {}) => ({ id: 'D1', project_id: 'p1', doc_type: 'daily_log', owner_org: 'contractor', doc_date: today, status: 'draft', current_version_no: 1, required_fields: [], recheck: [], intake_id: null, updated_at: '2026-09-17T00:00:00Z', ...over })
const version = (over = {}) => ({ id: 'V1', document_id: 'D1', version_no: 1, author_kind: 'human', content_hash: 'abcdef0123456789', content: { log_date: today, weather_am: '晴', weather_pm: '晴', labor: [{ type: '工', count: 1 }], equipment: [], materials: [], extras: {}, work_summary: '摘要', items: {} }, field_sources: { weather_am: { status: 'confirmed', source: 'human' }, weather_pm: { status: 'confirmed', source: 'human' }, labor: { status: 'confirmed', source: 'human' }, equipment: { status: 'na', reason: '無' }, materials: { status: 'na', reason: '無' }, work_summary: { status: 'confirmed', source: 'human' } }, attachments: [], ...over })

function makeStore(over = {}) {
  const docs = over.documents || []
  return {
    project: { project_name: 'A 案' }, currentProject: { project_id: 'p1' }, workItems: { items: [leaf] }, adjustedItems: [leaf],
    siteLogs: [], currentUser: { org_type: 'contractor', user_id: 'u1' }, demoMode: false, isPersistedProject: true,
    can: { edit: true, write: true, approve: false, oversee: false, override: false },
    fieldDocuments: { documents: docs, submissions: [] }, fieldDocsLoading: false, reloadFieldDocs: vi.fn(),
    findActiveDailyLogDoc: (date) => docs.find((d) => d.doc_type === 'daily_log' && d.doc_date === date) || null,
    createDailyLogDraft: vi.fn(), getFieldDocument: vi.fn().mockResolvedValue(null), saveFieldDocumentVersion: vi.fn(),
    signFieldDocument: vi.fn(), submitFieldDocument: vi.fn(), receiveFieldDocument: vi.fn(), returnFieldDocument: vi.fn(),
    listPhotosByIds: vi.fn().mockResolvedValue([]), listSitePhotos: vi.fn().mockResolvedValue([]),
    agentActions: [], resolveAgentAction: vi.fn(), listMfaFactors: vi.fn().mockResolvedValue({ factors: [] }), verifyMfa: vi.fn(),
    fetchWeather: vi.fn(), updateProjectAnchors: vi.fn(), aiEnabled: () => true,
    createIntake: vi.fn(), findExistingPhotosBySha: vi.fn(), uploadIntakePhoto: vi.fn(), draftFromIntake: vi.fn(), setIntakeCandidates: vi.fn(), updateIntakeDate: vi.fn(),
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
  delete window.confirm
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (entry = '/site-log') => act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><SiteLog /></MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const status = () => container.querySelector('[role="status"][aria-label^="保存狀態"]')?.textContent
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const setInput = (el, value, ev = 'input') => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event(ev, { bubbles: true }))
})
const addItemAndType = async (qty) => {
  await setInput(container.querySelector('input[placeholder="搜尋工項加入今日回報…"]'), '版牆')
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes('4F 版牆混凝土澆置')).click())
  await setInput(container.querySelector('input[type="number"]'), qty)
}

describe('施工日誌文件頁', () => {
  it('?d= 直達指定日期;切日期後 URL 跟著改', async () => {
    state.store = makeStore()
    await render('/site-log?d=2026-09-01'); await flush()
    expect(container.querySelector('input[type="date"]').value).toBe('2026-09-01')
    await setInput(container.querySelector('input[type="date"]'), '2026-09-02', 'change')
    expect(container.querySelector('input[type="date"]').value).toBe('2026-09-02')
  })

  it('尚無日誌 → 未存檔 → 存檔:PD001 明確提示重新載入且輸入留著;成功後建草稿＋版本並列待補', async () => {
    state.store = makeStore()
    state.store.createDailyLogDraft.mockResolvedValue({ error: null, doc: baseDoc({ current_version_no: 0, status: 'draft' }) })
    state.store.saveFieldDocumentVersion
      .mockResolvedValueOnce({ error: { code: 'PD001', message: '畫面載入的是版本 0,目前版本已是 1,請重新載入後再編輯' } })
      .mockImplementationOnce(async ({ content, fieldSources }) => {
        expect(content.items.w1.qty_today).toBe(120)
        expect(fieldSources['items.w1.qty_today']).toEqual({ status: 'confirmed', source: 'human' })
        const doc = baseDoc({ current_version_no: 1, status: 'pending_input', recheck: [{ key: 'weather_am', status: 'pending' }, { key: 'work_summary', status: 'pending' }] })
        state.store = makeStore({ documents: [doc], getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version({ content: { ...version().content, items: content.items }, field_sources: fieldSources }), versions: [], signatures: [], submissions: [] }) })
        return { error: null, result: { document_id: 'D1', version_no: 1, content_hash: 'abcdef0123456789', status: 'pending_input', recheck: doc.recheck, required_fields: [] } }
      })
    await render(); await flush()
    expect(status()).toBe('本日尚無日誌')
    expect(container.textContent).toContain('待補 6 項') // 天氣×2、摘要、出工、機具、材料全待補(不假裝有值)
    await addItemAndType(120)
    expect(status()).toBe('未存檔')
    expect(unsavedEditLabels()).toEqual([`施工日誌 ${today}（未存檔）`])
    await act(async () => button('存檔').click())
    expect(state.store.createDailyLogDraft).toHaveBeenCalledWith(today)
    expect(container.querySelector('[role="alert"]').textContent).toContain('重新載入')
    expect(container.querySelector('input[type="number"]').value).toBe('120') // 不默默覆蓋
    expect(button('重新載入最新版本')).toBeTruthy()
    await act(async () => button('存檔').click())
    await render(); await flush()
    expect(container.textContent).toContain('已存檔 ✓ 版本 1，尚有 2 項待補')
    expect(status()).toMatch(/已存檔.*版本 1/)
    expect(unsavedEditLabels()).toEqual([])
    expect(container.textContent).toContain('待補 2 項')
    expect(button('簽署此版本')).toBeUndefined() // 待補未齊不給簽
  })

  it('既有未簽署日誌(舊路徑):帶入其內容、來源標既有紀錄、可列印;存檔才建文件', async () => {
    state.store = makeStore({ siteLogs: [{ id: 'L1', log_date: today, weather_am: '陰', weather_pm: '', labor: [{ type: '鋼筋工', count: 3 }], equipment: [], materials: [], extras: {}, work_summary: '綁紮', status: '已送出', items: { K1: 2.5 } }] })
    await render(); await flush()
    expect(status()).toBe('既有紀錄・未簽署、待核對')
    expect(container.textContent).toContain('既有紀錄、待核對')
    expect(container.textContent).toContain('已帶入・待核對・既有紀錄')
    expect(container.querySelector('input[type="number"]').value).toBe('2.5')
    expect(button('列印公定格式日誌')).toBeTruthy()
    expect(state.store.createDailyLogDraft).not.toHaveBeenCalled()
  })

  it('可簽署的草稿:簽署遇 PD003 → 引導兩步驟驗證(無因子 → 前往帳號安全)', async () => {
    const doc = baseDoc()
    window.confirm = vi.fn(() => true)
    state.store = makeStore({ documents: [doc], getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version(), versions: [], signatures: [], submissions: [] }) })
    state.store.signFieldDocument.mockResolvedValue({ error: { code: 'PD003', message: '簽署需要完成兩步驟驗證(目前登入等級 aal1)' } })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('版本 1・雜湊 abcdef012345')
    expect(container.textContent).toContain(`本人確認 ${today} 施工日誌(版本 1,內容雜湊 abcdef012345)`)
    const sign = button('簽署此版本')
    expect(sign.disabled).toBe(false)
    await act(async () => sign.click())
    await flush()
    expect(state.store.signFieldDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'D1', versionNo: 1, contentHash: 'abcdef0123456789' }))
    expect(container.querySelector('[role="alert"]').textContent).toContain('簽署需要兩步驟驗證')
    expect(button('前往帳號安全啟用')).toBeTruthy()
  })

  it('已簽署文件:廠商要先「建立更正版本」才可編;唯讀視角(監造)除日期外無 input、已提送時有收件／退回', async () => {
    const signedDoc = baseDoc({ status: 'signed' })
    state.store = makeStore({ documents: [signedDoc], getFieldDocument: vi.fn().mockResolvedValue({ doc: signedDoc, version: version(), versions: [], signatures: [{ id: 'S1', version_no: 1, content_hash: 'abcdef0123456789', signer_org: 'contractor', signer_name_snapshot: '陳怡君', signed_at: '2026-09-17T01:00:00Z', aal: 'aal2' }], submissions: [] }) })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('版本 1 已由 陳怡君 簽署')
    expect(button('建立更正版本')).toBeTruthy()
    expect(button('存檔').disabled).toBe(true)
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0) // 鎖定=唯讀呈現
    expect(button('提送給監造')).toBeTruthy()
    await act(async () => root.unmount())
    root = createRoot(container)

    const submitted = baseDoc({ status: 'submitted' })
    state.store = makeStore({
      documents: [submitted], currentUser: { org_type: 'supervisor', user_id: 'u2' }, can: { edit: false, write: true, approve: true, oversee: false, override: false },
      getFieldDocument: vi.fn().mockResolvedValue({ doc: submitted, version: version(), versions: [], signatures: [], submissions: [{ id: 'X1', action: 'submit', version_no: 1, actor_org: 'contractor', to_org: 'supervisor', created_at: '2026-09-17T02:00:00Z' }] }),
    })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('此頁為唯讀')
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('存檔')).toBeUndefined()
    expect(button('收件')).toBeTruthy()
    expect(button('退回（填原因）')).toBeTruthy()
  })
})
