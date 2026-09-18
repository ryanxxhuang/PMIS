// @vitest-environment jsdom
// 監造日誌文件頁(P3a 前端):
// - 範本標記:頁面標「示範範本」與免責聲明(來自 fn_field_document_template);
// - 到場確認閘門:人填到場只是「待親自確認」→ 待補清單列出、不給簽;按「確認到場人員」後才齊備;
// - 伺服器 recheck 的 needs_confirmation 高亮(PD004 detail 同一狀態);
// - 逐欄來源:AI 草稿的監造事項標「照片 AI 說明」、廠商施工情形標「同日施工日誌文件」;來源缺漏留待補;
// - 樂觀併發:存檔遇 PD001 → 明確提示重新載入、輸入留著;
// - 廠商唯讀(除日期外沒有 input、無存檔);機關在已提送時有收件／退回;監造對已簽署文件要先「建立更正版本」;
// - 廠商照片只能「參考」(不出現「改為監造證據」);示範模式簽署回明確訊息、不假裝已簽署。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { demoFieldDocumentTemplate } from '../../data/demoFieldDocTemplates.js'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import SupervisorLog from './SupervisorLog.jsx'

let container, root
const tpl = demoFieldDocumentTemplate('supervisor_log')
const leaf = { id: 'w1', item_key: 'K1', item_no: '壹.一.1', description: '4F 版牆混凝土澆置', unit: 'M3', quantity: 500, is_billable: true, is_leaf: true }
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const baseDoc = (over = {}) => ({ id: 'S1', project_id: 'p1', doc_type: 'supervisor_log', owner_org: 'supervisor', target_table: 'supervisor_logs', doc_date: today, status: 'pending_input', current_version_no: 1, required_fields: [], recheck: [{ key: 'attendance', status: 'pending' }], intake_id: 'I1', updated_at: '2026-09-19T00:00:00Z', ...over })
const aiContent = () => ({
  log_date: today, weather_am: '晴', weather_pm: '晴', attendance: [],
  supervision_items: [{ time: '09:10', item: '抽查 壹.一.1 4F 版牆混凝土澆置', location: 'A區1F', work_item_id: 'w1', note: '柱主筋已綁紮', source: 'ai:photo', photo_ids: ['p1'] }],
  inspection_ids: ['i1'], notices: [{ to: 'contractor', content: '缺失通知:柱箍筋間距過大', ref_type: 'defect', ref_id: 'd1' }], followups: [], contractor_summary: '3F 版牆混凝土澆置(依廠商施工日誌 v3)', daily_log_receipt: { document_id: 'dl1', version_no: 3, status: 'signed', signed_at: '2026-09-19T01:00:00Z', submitted_at: null, received_at: null, returned_at: null },
  note: null, template: { key: 'supervisor_log_demo', version: 1 }, photo_ids: ['p1'], unmatched_photo_ids: [],
})
const aiSources = () => ({
  log_date: { status: 'filled', source: 'intake' }, weather_am: { status: 'filled', source: 'cwa' }, weather_pm: { status: 'filled', source: 'cwa' },
  attendance: { status: 'pending', source: null, reason: '到場人員與時段只能由監造親自填寫並確認' },
  supervision_items: { status: 'filled', source: 'ai:photo', refs: ['p1'] }, inspection_ids: { status: 'filled', source: 'system:inspections', refs: ['i1'] },
  notices: { status: 'filled', source: 'system:defects', refs: ['d1'] }, followups: { status: 'pending', source: null },
  contractor_summary: { status: 'filled', source: 'field_document:dl1:v3' }, daily_log_receipt: { status: 'filled', source: 'system:field_documents', refs: ['dl1'] },
})
const version = (over = {}) => ({ id: 'V1', document_id: 'S1', version_no: 1, author_kind: 'ai', content_hash: 'fedcba9876543210', content: aiContent(), field_sources: aiSources(), attachments: [{ photo_id: 'p1', storage_path: 'x', role: 'evidence' }, { photo_id: 'p2', storage_path: 'y', role: 'reference' }], ...over })
const photos = [
  { id: 'p1', uploader_org: 'supervisor', url: 'blob:1', caption: '鋼筋綁紮抽查', work_item_id: 'w1' },
  { id: 'p2', uploader_org: 'contractor', url: 'blob:2', caption: '廠商拍的' },
]

function makeStore(over = {}) {
  const docs = over.documents || []
  return {
    project: { project_name: 'A 案' }, currentProject: { project_id: 'p1' }, workItems: { items: [leaf] }, adjustedItems: [leaf],
    currentUser: { org_type: 'supervisor', user_id: 'u2', name: '王建國' }, demoMode: false, isPersistedProject: true,
    can: { edit: false, write: true, approve: true, oversee: false, override: false },
    fieldDocuments: { documents: docs, submissions: [] }, fieldDocsLoading: false, reloadFieldDocs: vi.fn(),
    findActiveFieldDoc: (type, date) => docs.find((d) => d.doc_type === type && d.doc_date === date) || null,
    createFieldDocDraft: vi.fn(), getFieldDocument: vi.fn().mockResolvedValue(null), saveFieldDocumentVersion: vi.fn(),
    getFieldDocumentTemplate: vi.fn().mockResolvedValue({ error: null, template: tpl }),
    signFieldDocument: vi.fn(), submitFieldDocument: vi.fn(), receiveFieldDocument: vi.fn(), returnFieldDocument: vi.fn(),
    listPhotosByIds: vi.fn().mockResolvedValue(photos), listMembers: vi.fn().mockResolvedValue({ rows: [{ user_id: 'u2', full_name: '王建國', org_type: 'supervisor' }, { user_id: 'u3', full_name: '林監造', org_type: 'supervisor' }, { user_id: 'u1', full_name: '陳怡君', org_type: 'contractor' }], error: null }),
    agentActions: [], resolveAgentAction: vi.fn(), listMfaFactors: vi.fn().mockResolvedValue({ factors: [] }), verifyMfa: vi.fn(),
    fetchWeather: vi.fn(), updateProjectAnchors: vi.fn(), aiEnabled: () => true,
    inspections: [{ id: 'i1', title: '4F 模板查驗', status: '合格', location: '4F', requested_date: today, inspected_at: null, result_note: null }], defects: [{ id: 'd1', title: '柱箍筋間距過大' }], rfis: [], submittals: [],
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
const render = (entry = '/supervisor-log') => act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><SupervisorLog /></MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const status = () => container.querySelector('[role="status"][aria-label^="保存狀態"]')?.textContent
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const withDoc = (doc, over = {}) => makeStore({ documents: [doc], getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version(), versions: [], signatures: [], submissions: [] }), ...over })

describe('監造日誌文件頁', () => {
  it('AI 草稿:標示範範本與免責聲明;逐欄來源(照片 AI 說明／同日施工日誌文件／系統紀錄);到場待補不給簽;廠商照片只能參考', async () => {
    state.store = withDoc(baseDoc())
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('示範範本')
    expect(container.textContent).toContain('非任何機關公定或法定格式')
    expect(status()).toMatch(/已存檔.*版本 1/)
    expect(container.textContent).toContain('待補 1 項')
    expect(container.textContent).toContain('到場人員與時段')
    expect(container.textContent).toContain('已帶入・待核對・照片 AI 說明')          // 監造事項
    expect(container.textContent).toContain('已帶入・待核對・同日施工日誌文件')     // 廠商施工情形
    expect(container.textContent).toContain('已帶入・待核對・系統查驗紀錄')         // 當日查驗
    expect(container.textContent).toContain('4F 模板查驗')                          // 引用的查驗名稱
    expect(container.textContent).toContain('缺失:柱箍筋間距過大')                  // 通知引用的缺失名稱
    expect(container.textContent).toContain('來源：照片 AI 說明')                   // 逐項來源
    expect(button('簽署此版本')).toBeUndefined()
    // 附件:監造照片=監造證據;廠商照片標「施工廠商提供」且只能參考(沒有「改為監造證據」)
    expect(container.textContent).toContain('施工廠商提供')
    expect(button('改為監造證據')).toBeUndefined()
    expect(button('改為參考')).toBeTruthy()
  })

  it('到場確認閘門:帶入本人 → 已填・待親自確認(仍待補)→ 確認到場人員 → 待補清空;存檔遇 PD001 明確提示且輸入留著', async () => {
    state.store = withDoc(baseDoc())
    state.store.saveFieldDocumentVersion.mockResolvedValueOnce({ error: { code: 'PD001', message: '畫面載入的是版本 1,目前版本已是 2,請重新載入後再編輯' } })
    await render(); await flush(); await flush()
    await act(async () => button('帶入本人').click())
    expect(container.querySelector('input[aria-label="王建國 姓名"]').value).toBe('王建國')
    expect(container.textContent).toContain('已填・待親自確認')
    expect(container.textContent).toContain('待補 1 項')
    expect(container.textContent).toContain('到場人員與時段（待親自確認）')
    expect(status()).toBe('未存檔')
    await act(async () => button('確認到場人員').click())
    expect(container.textContent).not.toContain('待補 1 項')
    expect(container.textContent).toContain('已確認')
    await act(async () => button('存檔').click())
    expect(state.store.saveFieldDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'S1', baseVersionNo: 1, fieldSources: expect.objectContaining({ attendance: { status: 'confirmed', source: 'human' } }) }))
    expect(container.querySelector('[role="alert"]').textContent).toContain('重新載入')
    expect(container.querySelector('input[aria-label="王建國 姓名"]').value).toBe('王建國') // 不默默覆蓋
    expect(button('重新載入最新版本')).toBeTruthy()
  })

  it('伺服器 recheck 的 needs_confirmation(PD004 同一狀態)高亮並可簽前擋下;本日未到場=不適用＋原因', async () => {
    const doc = baseDoc({ recheck: [{ key: 'attendance', status: 'needs_confirmation' }] })
    state.store = withDoc(doc, { getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version({ author_kind: 'human', content: { ...aiContent(), attendance: [{ name: '王建國' }] }, field_sources: { ...aiSources(), attendance: { status: 'filled', source: 'human' } } }), versions: [], signatures: [], submissions: [] }) })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('到場人員與時段（待親自確認）')
    expect(container.textContent).toContain('尚未由你親自確認')
    expect(button('簽署此版本')).toBeUndefined()
    expect(button('確認到場人員')).toBeTruthy()
    expect(button('本日未到場')).toBeTruthy()
  })

  it('可簽署的草稿:簽署遇 PD003 → 引導兩步驟驗證;已簽署要先「建立更正版本」且有「提送給機關」', async () => {
    window.confirm = vi.fn(() => true)
    const ready = baseDoc({ status: 'draft', recheck: [] })
    const readyVersion = version({ author_kind: 'human', version_no: 2, content: { ...aiContent(), attendance: [{ name: '王建國', from: '09:00', to: '12:00' }] }, field_sources: { ...aiSources(), attendance: { status: 'confirmed', source: 'human' } } })
    state.store = withDoc({ ...ready, current_version_no: 2 }, { getFieldDocument: vi.fn().mockResolvedValue({ doc: { ...ready, current_version_no: 2 }, version: readyVersion, versions: [], signatures: [], submissions: [] }) })
    state.store.signFieldDocument.mockResolvedValue({ error: { code: 'PD003', message: '簽署需要完成兩步驟驗證(目前登入等級 aal1)' } })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain(`本人確認 ${today} 監造日誌(版本 2,內容雜湊 fedcba987654)`)
    const sign = button('簽署此版本')
    expect(sign.disabled).toBe(false)
    await act(async () => sign.click())
    await flush()
    expect(state.store.signFieldDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'S1', versionNo: 2, contentHash: 'fedcba9876543210' }))
    expect(container.querySelector('[role="alert"]').textContent).toContain('簽署需要兩步驟驗證')
    await act(async () => root.unmount())
    root = createRoot(container)

    const signed = baseDoc({ status: 'signed', recheck: [], current_version_no: 2 })
    state.store = withDoc(signed, { getFieldDocument: vi.fn().mockResolvedValue({ doc: signed, version: readyVersion, versions: [], signatures: [{ id: 'G1', version_no: 2, content_hash: 'fedcba9876543210', signer_org: 'supervisor', signer_name_snapshot: '王建國', signed_at: '2026-09-19T01:00:00Z', aal: 'aal2' }], submissions: [] }) })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('版本 2 已由 王建國 簽署')
    expect(button('建立更正版本')).toBeTruthy()
    expect(button('存檔').disabled).toBe(true)
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('提送給機關')).toBeTruthy()
  })

  it('唯讀視角:廠商(可讀)除日期外無 input、無存檔、無收件;機關在已提送時有收件／退回', async () => {
    const submitted = baseDoc({ status: 'submitted', recheck: [], current_version_no: 2 })
    const detail = { doc: submitted, version: version({ version_no: 2 }), versions: [], signatures: [], submissions: [{ id: 'X1', action: 'submit', version_no: 2, actor_org: 'supervisor', to_org: 'owner', created_at: '2026-09-19T02:00:00Z' }] }
    state.store = makeStore({ documents: [submitted], currentUser: { org_type: 'contractor', user_id: 'u1' }, can: { edit: true, write: true, approve: false, oversee: false, override: false }, getFieldDocument: vi.fn().mockResolvedValue(detail) })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('此頁為唯讀')
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('存檔')).toBeUndefined()
    expect(button('收件')).toBeUndefined()
    expect(container.textContent).toContain('施工廠商為查閱視角；提送對象是機關')
    await act(async () => root.unmount())
    root = createRoot(container)

    state.store = makeStore({ documents: [submitted], currentUser: { org_type: 'owner', user_id: 'u4' }, can: { edit: false, write: false, approve: false, oversee: true, readonly: true, override: false }, getFieldDocument: vi.fn().mockResolvedValue(detail) })
    await render(); await flush(); await flush()
    expect(container.textContent).toContain('機關檢視')
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('收件')).toBeTruthy()
    expect(button('退回（填原因）')).toBeTruthy()
    expect(container.textContent).toContain('等待機關收件')
  })

  it('沒有文件:空白草稿全部待補、不填「無」;同日施工日誌已簽署時可「引用同日施工日誌」並標來源;示範模式簽署回明確訊息', async () => {
    const dl = { id: 'dl1', doc_type: 'daily_log', owner_org: 'contractor', doc_date: today, status: 'signed', current_version_no: 3 }
    state.store = makeStore({
      documents: [dl], demoMode: true,
      getFieldDocument: vi.fn().mockResolvedValue({ doc: dl, version: { version_no: 3, content: { work_summary: '3F 版牆混凝土澆置', items: { w1: { qty_today: 12 } } } }, versions: [], signatures: [{ version_no: 3, signed_at: '2026-09-19T01:00:00Z' }], submissions: [] }),
    })
    await render(); await flush(); await flush()
    expect(status()).toBe('本日尚無監造日誌')
    expect(container.textContent).toContain('待補 4 項') // 天氣×2、監造事項、到場(廠商施工情形已由同日已簽署施工日誌帶入)
    expect(container.textContent).not.toContain('已填・待親自確認')
    expect(container.textContent).toContain('已帶入・待核對・同日施工日誌文件')
    expect(container.textContent).toContain('壹.一.1 4F 版牆混凝土澆置 12M3(依廠商施工日誌 v3)')
    expect(container.textContent).toContain('版本 3')
    // 沒有來源就留待補,任何欄位都不會被填成「無」
    expect([...container.querySelectorAll('input,textarea')].some((el) => String(el.value).trim() === '無')).toBe(false)
    expect(container.textContent).toContain('尚無監造事項')
  })
})
