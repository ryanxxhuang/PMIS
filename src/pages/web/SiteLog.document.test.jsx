// @vitest-environment jsdom
// 施工日誌文件頁(P2c):
// - 保存狀態章:本日尚無日誌 → 填了值變「未存檔」(登記到未存檔登記簿)→ 存檔=建草稿＋存版本;
// - 樂觀併發:伺服器版本已前進(PD001)→ 明確提示重新載入、輸入留著,不默默覆蓋;
// - 既有未簽署日誌:以其內容帶入、來源標「既有紀錄」,不偽造簽署;
// - 待補集中呈現、未齊不給簽;簽署成功顯示版本與雜湊、遇 PD006 顯示伺服器訊息;
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
    agentActions: [], resolveAgentAction: vi.fn(),
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
// C 包:表單就是紙本本身,表頭也有數字欄(工期展延天數),所以工項數量一律以原表欄名(aria-label)定位,
// 不再用「頁上第一個 number input」。
const qtyInput = () => [...container.querySelectorAll('input[type="number"]')].find((el) => /本日完成數量$/.test(el.getAttribute('aria-label') || ''))
const addItemAndType = async (qty) => {
  await setInput(container.querySelector('input[placeholder="搜尋工項加入今日回報…"]'), '版牆')
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes('4F 版牆混凝土澆置')).click())
  await setInput(qtyInput(), qty)
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
    expect(qtyInput().value).toBe('120') // 不默默覆蓋
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
    expect(qtyInput().value).toBe('2.5')
    expect(button('列印公定格式日誌')).toBeTruthy()
    expect(state.store.createDailyLogDraft).not.toHaveBeenCalled()
  })

  // 表內上傳(2026-09-21):選檔即透過表單卡頂部的檔案 input;上傳／起稿走 store mock
  const fillInput = () => container.querySelector('input[type="file"][aria-label="上傳照片，AI 填表"]')
  const pickPhoto = () => act(async () => {
    Object.defineProperty(fillInput(), 'files', { value: [new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })], configurable: true })
    fillInput().dispatchEvent(new Event('change', { bubbles: true }))
  })
  const flushAll = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) })
  const targetOf = (over = {}) => ({
    document_id: 'D1', agent_action_id: 'A1', pending_fields: [], notes: [],
    suggestion: {
      content: { log_date: today, weather_am: 'AI 晴', work_summary: 'AI 摘要', items: { w1: { item_key: 'K1', item_no: '壹.一.1', description: '4F 版牆混凝土澆置', unit: 'M3', qty_today: null } }, photo_ids: ['P1'] },
      field_sources: { weather_am: { status: 'filled', source: 'whiteboard:P1' }, work_summary: { status: 'filled', source: 'ai:photo', refs: ['P1'] }, 'items.w1.qty_today': { status: 'pending', source: null } },
      attachments: [{ photo_id: 'P1', storage_path: 'p/P1.jpg', role: 'evidence' }],
    },
    ...over,
  })
  // 上傳／起稿的 store mock:建文件會把文件推進清單(頁面才找得到)、存版把內容記下來給 getFieldDocument 回
  const uploadStore = (over = {}) => {
    const docs = []
    const saved = { content: null, sources: null, attachments: null }
    return makeStore({
      documents: docs,
      createDailyLogDraft: vi.fn(async (d) => { const doc = baseDoc({ doc_date: d, current_version_no: 0 }); docs.push(doc); return { error: null, doc } }),
      saveFieldDocumentVersion: vi.fn(async ({ content, fieldSources, attachments }) => { Object.assign(saved, { content, sources: fieldSources, attachments }); docs[0].current_version_no = 1; return { error: null, result: { version_no: 1, recheck: [{ key: 'work_summary' }] } } }),
      getFieldDocument: vi.fn(async () => ({ doc: docs[0], version: { version_no: 1, author_kind: 'human', content: saved.content, field_sources: saved.sources, attachments: saved.attachments || [] }, versions: [], signatures: [], submissions: [] })),
      createIntake: vi.fn(async () => ({ error: null, intake: { id: 'I1' } })),
      uploadIntakePhoto: vi.fn(async () => ({ error: null, id: 'P1', storage_path: 'p/P1.jpg' })),
      draftFromIntake: vi.fn(async () => ({ error: null, result: { target: targetOf(), intake: { status: 'ready' }, documents: [], notes: [] } })),
      listPhotosByIds: vi.fn(async (ids) => ids.map((id) => ({ id, storage_path: 'p/P1.jpg', url: 'blob:1', uploader_org: 'contractor' }))),
      reloadAgentActions: vi.fn(),
      ...over,
    })
  }

  it('表內上傳:新日誌先存一版(建文件)再上傳;AI 回來用最新表單合併——只補空白欄、已填的不覆蓋、附件併入、變未存檔;存檔把建議標 accepted', async () => {
    state.store = uploadStore()
    await render(); await flush()
    await setInput(container.querySelector('input[aria-label="本日天氣上午"]'), '陰') // 人先填了上午天氣
    expect(status()).toBe('未存檔')
    await pickPhoto()
    await flushAll()
    // 文件由頁面既有存檔流程建立,存的是按下時的內容(含人填的「陰」)
    expect(state.store.createDailyLogDraft).toHaveBeenCalledWith(today)
    expect(state.store.saveFieldDocumentVersion).toHaveBeenCalledTimes(1)
    expect(state.store.saveFieldDocumentVersion.mock.calls[0][0].content.weather_am).toBe('陰')
    expect(state.store.createIntake).toHaveBeenCalledWith({ log_date: today })
    expect(state.store.draftFromIntake).toHaveBeenCalledWith('I1', expect.objectContaining({ targetDocumentId: 'D1' }))
    // 合併:人填的上午天氣不覆蓋、空白的摘要補入、工項列加入(數量待補)、附件併入
    expect(container.querySelector('input[aria-label="本日天氣上午"]').value).toBe('陰')
    expect(container.querySelector('input[aria-label="施工概況摘要"]').value).toBe('AI 摘要')
    expect(qtyInput()).toBeTruthy()
    expect(qtyInput().value).toBe('')
    expect(container.textContent).toContain('AI 已填入')
    expect(container.textContent).toContain('你已填的欄位未覆蓋')
    expect(status()).toBe('未存檔')
    expect(container.querySelector('img[src="blob:1"]')).toBeTruthy()
    // 存檔:第二版帶合併後內容與附件,建議標 accepted
    await act(async () => button('存檔').click())
    await flushAll()
    expect(state.store.saveFieldDocumentVersion).toHaveBeenCalledTimes(2)
    const second = state.store.saveFieldDocumentVersion.mock.calls[1][0]
    expect(second.content).toMatchObject({ weather_am: '陰', work_summary: 'AI 摘要' })
    expect(second.fieldSources.weather_am).toMatchObject({ status: 'confirmed', source: 'human' })
    expect(second.fieldSources.work_summary).toMatchObject({ status: 'filled', source: 'ai:photo' })
    expect(second.attachments.map((a) => a.photo_id)).toEqual(['P1'])
    expect(state.store.resolveAgentAction).toHaveBeenCalledWith('A1', 'accepted')
  })

  it('表內上傳:AI 回來前使用者已切到別的日期 → 不填進目前這份、提示建議留在原文件、重載建議清單', async () => {
    let resolveDraft
    const doc = baseDoc()
    state.store = uploadStore({
      documents: [doc], getFieldDocument: vi.fn(async () => ({ doc, version: version({ content: { ...version().content, work_summary: '' }, field_sources: { ...version().field_sources, work_summary: { status: 'pending', source: null } } }), versions: [], signatures: [], submissions: [] })),
      draftFromIntake: vi.fn(() => new Promise((r) => { resolveDraft = r })),
    })
    await render(); await flush(); await flush()
    expect(status()).toMatch(/已存檔.*版本 1/)
    await pickPhoto()
    await flushAll()
    expect(state.store.saveFieldDocumentVersion).not.toHaveBeenCalled() // 文件已存在:不強制存檔
    expect(state.store.draftFromIntake).toHaveBeenCalledWith('I1', expect.objectContaining({ targetDocumentId: 'D1' }))
    await setInput(container.querySelector('input[type="date"]'), '2026-09-01', 'change')
    await flushAll()
    await act(async () => resolveDraft({ error: null, result: { target: targetOf(), intake: { status: 'ready' }, documents: [], notes: [] } }))
    await flushAll()
    expect(container.querySelector('input[type="date"]').value).toBe('2026-09-01')
    expect(container.querySelector('input[aria-label="施工概況摘要"]').value).toBe('') // 沒填進目前這份
    expect(container.textContent).toContain('你已切換到別的日期')
    expect(state.store.reloadAgentActions).toHaveBeenCalled()
    expect(status()).not.toBe('未存檔')
  })

  it('可簽署的草稿:一般登入直接簽署(無驗證碼步驟);成功顯示版本與雜湊、被拒(PD006)顯示伺服器訊息', async () => {
    const doc = baseDoc()
    window.confirm = vi.fn(() => true)
    state.store = makeStore({ documents: [doc], getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version(), versions: [], signatures: [], submissions: [] }) })
    state.store.signFieldDocument.mockResolvedValueOnce({ error: { code: 'PD006', message: '此文件屬施工廠商方,只有該方成員可簽署' } })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('版本 1・雜湊 abcdef012345')
    expect(container.textContent).toContain(`本人確認 ${today} 施工日誌(版本 1,內容雜湊 abcdef012345)內容屬實,同意以本人登入的平台帳號簽署本文件。`)
    expect(container.textContent).not.toMatch(/兩步驟驗證|驗證碼/)
    const sign = button('簽署此版本')
    expect(sign.disabled).toBe(false)
    await act(async () => sign.click())
    await flush()
    expect(state.store.signFieldDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'D1', versionNo: 1, contentHash: 'abcdef0123456789', intent: expect.stringContaining('同意以本人登入的平台帳號簽署本文件') }))
    expect(container.querySelector('[aria-label="文件狀態與簽署"] [role="status"]').textContent).toContain('只有該方成員可簽署')
    expect(container.textContent).not.toMatch(/兩步驟驗證|驗證碼|帳號安全/)

    state.store.signFieldDocument.mockResolvedValueOnce({ result: { version_no: 1, content_hash: 'abcdef0123456789' } })
    await act(async () => button('簽署此版本').click())
    await flush()
    expect(state.store.signFieldDocument).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('已簽署版本 1（雜湊 abcdef012345）')
  })

  it('已簽署文件:廠商要先「建立更正版本」才可編;唯讀視角(監造)除日期外無 input、已提送時有收件／退回', async () => {
    const signedDoc = baseDoc({ status: 'signed' })
    state.store = makeStore({ documents: [signedDoc], getFieldDocument: vi.fn().mockResolvedValue({ doc: signedDoc, version: version(), versions: [], signatures: [{ id: 'S1', version_no: 1, content_hash: 'abcdef0123456789', signer_org: 'contractor', signer_name_snapshot: '陳怡君', signed_at: '2026-09-17T01:00:00Z', aal: 'aal1' }], submissions: [] }) })
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
      getFieldDocument: vi.fn().mockResolvedValue({ doc: submitted, version: version(), versions: [], signatures: [], submissions: [{ id: 'X1', document_id: submitted.id, action: 'submit', version_no: 1, actor_org: 'contractor', to_org: 'supervisor', created_at: '2026-09-17T02:00:00Z' }] }),
    })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('此頁為唯讀')
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('存檔')).toBeUndefined()
    expect(button('收件')).toBeTruthy()
    expect(button('退回（填原因）')).toBeTruthy()
  })
})
