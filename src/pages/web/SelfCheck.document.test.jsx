// @vitest-environment jsdom
// 自主檢查表文件頁(P3b 前端):
// - 框架範本標記:頁面標「示範範本」與免責聲明(fn_field_document_template('self_check'));檢查項目取本案範本;
// - AI 草稿:每個項目待補、實測值不帶值(告示板讀數只是提示)、範本／工項來源;不給簽;
// - 逐項確認閘門:系統帶入(既有紀錄)的勾選 filled → 待親自確認 → 按確認後才齊備;實測值人填即 confirmed;
// - 新建:選範本後第一次存檔才建文件(內建範本先落 DB);存檔遇 PD001 明確提示、輸入留著;
// - 已簽署要先「建立更正版本」並填更正原因;可簽草稿意願文字含「自主檢查表」;簽署後有「提出查驗申請（檢附此表）」;
// - 監造唯讀(除日期外無 input),已提送時有收件／退回;機關唯讀。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { demoFieldDocumentTemplate } from '../../data/demoFieldDocTemplates.js'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import SelfCheck from './SelfCheck.jsx'

let container, root
const frame = demoFieldDocumentTemplate('self_check')
const leaf = { id: 'w1', item_key: 'K1', item_no: '壹.一.1', description: '4F 版牆混凝土澆置', unit: 'M3', quantity: 500, is_billable: true, is_leaf: true }
const TPL = { id: 'T1', title: '混凝土自主檢查表', source: '03310', items: [
  { no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時' },
  { no: 'C2', group: '澆置中', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18±2.5' },
] }
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const baseDoc = (over = {}) => ({ id: 'SC1', project_id: 'p1', doc_type: 'self_check', owner_org: 'contractor', target_table: 'checklist_records', target_id: null, target_key: `${today}:w1`, doc_date: today, status: 'pending_input', current_version_no: 1, template_id: 'T1', required_fields: [], recheck: [{ key: 'results.B1', status: 'pending' }, { key: 'results.C2', status: 'pending' }], intake_id: 'I1', updated_at: '2026-09-19T00:00:00Z', ...over })
const aiContent = () => ({
  check_date: today, template_id: 'T1', template_title: TPL.title, template_source: '03310', work_item_id: 'w1', location: 'A區1F',
  results: { B1: { value: null }, C2: { value: null } }, note: null, template: { key: 'self_check_demo', version: 1 }, photo_ids: ['p1'], unmatched_photo_ids: [],
})
const aiSources = () => ({
  check_date: { status: 'filled', source: 'intake' }, template_id: { status: 'filled', source: 'system:template_match', reason: '本案僅有這一張範本' },
  work_item_id: { status: 'filled', source: 'ai:photo', refs: ['p1'] }, location: { status: 'filled', source: 'ai:photo', refs: ['p1'] },
  'results.B1': { status: 'pending', source: null, reason: '請依現場檢查勾選' },
  // 2026-09-20 B:兩向尺寸／單位對不上等「帶不進來」的紙上紀錄只留原文提示,不填值
  'results.C2': { status: 'pending', source: null, reason: '紙上為兩向尺寸「15 * 15 CM」,單一欄位無法完整承載,未自動帶入;請確認要記錄哪一向或分列', hint: { value: 15, unit: 'CM', source: 'record:p1', raw_text: '15 * 15 CM' } },
})
const version = (over = {}) => ({ id: 'V1', document_id: 'SC1', version_no: 1, author_kind: 'ai', content_hash: 'abcdef0123456789', content: aiContent(), field_sources: aiSources(), attachments: [{ photo_id: 'p1', storage_path: 'x', role: 'evidence' }], ...over })
const photos = [{ id: 'p1', uploader_org: 'contractor', url: 'blob:1', caption: '澆置照', work_item_id: 'w1' }]

function makeStore(over = {}) {
  const docs = over.documents || []
  return {
    project: { project_name: 'A 案' }, currentProject: { project_id: 'p1' }, workItems: { items: [leaf] }, adjustedItems: [leaf],
    currentUser: { org_type: 'contractor', user_id: 'u1', name: '陳怡君' }, demoMode: false, isPersistedProject: true,
    can: { edit: true, write: true, submit: true, approve: false, oversee: false, override: false },
    fieldDocuments: { documents: docs, submissions: [] }, fieldDocsLoading: false, reloadFieldDocs: vi.fn(),
    createFieldDocDraft: vi.fn(), getFieldDocument: vi.fn().mockResolvedValue(null), saveFieldDocumentVersion: vi.fn(),
    getFieldDocumentTemplate: vi.fn().mockResolvedValue({ error: null, template: frame }),
    signFieldDocument: vi.fn(), submitFieldDocument: vi.fn(), receiveFieldDocument: vi.fn(), returnFieldDocument: vi.fn(),
    listPhotosByIds: vi.fn().mockResolvedValue(photos), agentActions: [], resolveAgentAction: vi.fn(),
    checklistTemplates: [TPL], ensureChecklistTemplate: vi.fn(async (t) => ({ error: null, template: t })), inspections: [],
    // 表內上傳(FormPhotoFill)用到的:AI 功能開關與上傳／起稿
    aiEnabled: () => true, createIntake: vi.fn(), uploadIntakePhoto: vi.fn(), draftFromIntake: vi.fn(), reloadAgentActions: vi.fn(),
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
const render = (entry = '/self-check') => act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><SelfCheck /></MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const status = () => container.querySelector('[role="status"][aria-label^="保存狀態"]')?.textContent
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const withDoc = (doc, over = {}) => makeStore({ documents: [doc], getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version(), versions: [], signatures: [], submissions: [] }), ...over })

describe('自主檢查表文件頁', () => {
  it('AI 草稿:示範框架範本與免責聲明;範本／工項／位置有來源;帶不進來的紙上紀錄只留原文提示、不填值;不給簽', async () => {
    state.store = withDoc(baseDoc())
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.textContent).toContain('示範範本')
    expect(container.textContent).toContain('非任何機關公定或法定格式')
    expect(status()).toMatch(/已存檔.*版本 1/)
    expect(container.textContent).toContain('待補 2 項')
    expect(container.textContent).toContain('B1 澆置 24 小時前已通知監造')
    expect(container.textContent).toContain('已帶入・待核對・依工項挑選範本')
    expect(container.textContent).toContain('已帶入・待核對・照片 AI 說明')
    expect(container.querySelector('input[aria-label="C2 坍度 實際檢查情形"]').value).toBe('')
    expect(container.textContent).toContain('紙上寫「15 * 15 CM」（未自動帶入）')
    expect(container.textContent).toContain('（尚無已檢項目／全部不適用）')
    expect(button('簽署此版本')).toBeUndefined()
  })

  it('紙本實測欄已寫好的值:抄錄進格子、顯示紙上原文與來源章,仍要人逐項確認才能簽', async () => {
    const doc = baseDoc({ recheck: [{ key: 'results.B1', status: 'pending' }, { key: 'results.C2', status: 'needs_confirmation' }] })
    const copied = version({
      content: { ...aiContent(), results: { B1: { value: null }, C2: { value: 18 } } },
      field_sources: {
        ...aiSources(),
        'results.C2': {
          status: 'filled', source: 'record:p1', refs: ['p1'],
          reason: '抄錄自紙本／告示板實測欄「18 cm」;系統只抄錄,未代為量測,請核對後逐項確認',
          evidence: [{ photo_id: 'p1', raw_text: '18 cm', label: '坍度', entry_no: 'C2', unit: 'cm', kind: 'measured' }],
        },
      },
    })
    state.store = withDoc(doc, { getFieldDocument: vi.fn().mockResolvedValue({ doc, version: copied, versions: [], signatures: [], submissions: [] }) })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.querySelector('input[aria-label="C2 坍度 實際檢查情形"]').value).toBe('18')
    expect(container.textContent).toContain('紙上原文：18 cm')
    expect(container.textContent).toContain('紙本實測欄抄錄')
    expect(button('簽署此版本')).toBeUndefined()
  })

  it('表內上傳:文件已存在不強制存檔;AI 抄錄的分列讀數補進空的項目(待確認)、人已填的實測值與已有的位置不覆蓋、附件併入、變未存檔', async () => {
    const doc = baseDoc()
    // 目前版本:C2 空、位置已有值;人先把 C2 填 17(人填=confirmed)
    state.store = withDoc(doc, {
      createIntake: vi.fn(async () => ({ error: null, intake: { id: 'I1' } })),
      uploadIntakePhoto: vi.fn(async () => ({ error: null, id: 'p2', storage_path: 'p/p2.jpg' })),
      draftFromIntake: vi.fn(async () => ({ error: null, result: { intake: { status: 'ready' }, documents: [], notes: [], target: {
        document_id: 'SC1', agent_action_id: 'A9', pending_fields: [], notes: [],
        suggestion: {
          content: { ...aiContent(), location: 'AI 猜的位置', results: { B1: { value: null }, C2: { value: null, readings: [{ entry_no: '1', value: 18, value2: null, raw_text: '18 CM' }, { entry_no: '2', value: 19, value2: null, raw_text: '19 CM' }] } }, photo_ids: ['p1', 'p2'] },
          field_sources: { ...aiSources(), location: { status: 'filled', source: 'ai:photo' }, 'results.C2': { status: 'filled', source: 'record:p2', refs: ['p2'], reason: '已抄錄紙本實測值 編號 1 18 cm、編號 2 19 cm,待你核對確認', evidence: [] } },
          attachments: [{ photo_id: 'p1', storage_path: 'x', role: 'evidence' }, { photo_id: 'p2', storage_path: 'p/p2.jpg', role: 'evidence' }],
        },
      } } })),
      listPhotosByIds: vi.fn(async (ids) => ids.map((id) => ({ id, uploader_org: 'contractor', url: `blob:${id}`, caption: '', work_item_id: 'w1' }))),
      saveFieldDocumentVersion: vi.fn(async () => ({ error: null, result: { version_no: 2, recheck: [] } })),
    })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    const typeC2 = (v) => act(async () => {
      const c2 = container.querySelector('input[aria-label="C2 坍度 實際檢查情形"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c2, v); c2.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const pick = () => act(async () => {
      const input = container.querySelector('input[type="file"][aria-label="上傳照片，AI 填表"]')
      Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([7])], 'b.jpg', { type: 'image/jpeg' })], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const flushAll = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) })

    // 第一次:C2 空 → 讀數分列填進格子、狀態待確認;位置本來就有值(AI 版本帶入的)不覆蓋
    await pick(); await flushAll()
    expect(state.store.saveFieldDocumentVersion).not.toHaveBeenCalled() // 文件已存在:不強制存檔,直接上傳
    expect(state.store.createIntake).toHaveBeenCalledWith({ log_date: today })
    expect(state.store.draftFromIntake).toHaveBeenCalledWith('I1', expect.objectContaining({ targetDocumentId: 'SC1' }))
    expect(container.querySelector('input[aria-label="C2 坍度 第 1 筆 編號"]').value).toBe('1')
    expect(container.querySelector('input[aria-label="C2 坍度 第 1 筆 讀數"]').value).toBe('18')
    expect(container.querySelector('input[aria-label="C2 坍度 第 2 筆 讀數"]').value).toBe('19')
    expect(container.querySelector('input[aria-label="檢查位置"]').value).toBe('A區1F')
    expect(container.textContent).toContain('C2 坍度（待親自確認）') // 抄錄仍是待確認,簽署前要人逐項確認
    expect(container.textContent).toContain('AI 已填入')
    expect(container.textContent).toContain('抄錄的讀數請逐項確認後存檔')
    expect(status()).toBe('未存檔')
    expect(container.querySelector('img[src="blob:p2"]')).toBeTruthy()

    // 第二次:人把兩筆讀數刪掉、改填單一值 17(人填=confirmed)→ 再上傳也不覆蓋
    for (let i = 0; i < 2; i++) await act(async () => container.querySelector('button[aria-label="刪除 C2 坍度 第 1 筆"]').click())
    await typeC2('17')
    await pick(); await flushAll()
    expect(container.querySelector('input[aria-label="C2 坍度 實際檢查情形"]').value).toBe('17')
    expect(container.textContent).toContain('沒有可補的空白欄位')
    // 存檔:建議標 accepted(兩筆)
    await act(async () => button('存檔').click())
    await flushAll()
    expect(state.store.saveFieldDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'SC1', content: expect.objectContaining({ results: expect.objectContaining({ C2: { value: 17 } }) }), attachments: expect.arrayContaining([expect.objectContaining({ photo_id: 'p2' })]) }))
    expect(state.store.resolveAgentAction).toHaveBeenCalledWith('A9', 'accepted')
  })

  it('人填實測值即 confirmed、判定預覽即時算;系統帶入的勾選要按確認才齊備;存檔遇 PD001 明確提示且輸入留著', async () => {
    const doc = baseDoc({ recheck: [{ key: 'results.B1', status: 'needs_confirmation' }, { key: 'results.C2', status: 'pending' }] })
    state.store = withDoc(doc, { getFieldDocument: vi.fn().mockResolvedValue({ doc, version: version({ author_kind: 'human', content: { ...aiContent(), results: { B1: { value: true }, C2: { value: null } } }, field_sources: { ...aiSources(), 'results.B1': { status: 'filled', source: 'legacy:old' } } }), versions: [], signatures: [], submissions: [] }) })
    state.store.saveFieldDocumentVersion.mockResolvedValueOnce({ error: { code: 'PD001', message: '畫面載入的是版本 1,目前版本已是 2,請重新載入後再編輯' } })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.textContent).toContain('B1 澆置 24 小時前已通知監造（待親自確認）')
    const c2 = container.querySelector('input[aria-label="C2 坍度 實際檢查情形"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(c2, '30'); c2.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('■ 有缺失')
    expect(status()).toBe('未存檔')
    expect(container.textContent).toContain('待補 1 項') // B1 仍待確認
    const confirmB1 = [...container.querySelectorAll('#field-results-B1 button')].find((b) => b.textContent.trim() === '確認')
    await act(async () => confirmB1.click())
    expect(container.textContent).not.toMatch(/待補 \d 項/)
    await act(async () => button('存檔').click())
    expect(state.store.saveFieldDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'SC1', baseVersionNo: 1, content: expect.objectContaining({ results: { B1: { value: true }, C2: { value: 30 } } }), fieldSources: expect.objectContaining({ 'results.C2': { status: 'confirmed', source: 'human' }, 'results.B1': expect.objectContaining({ status: 'confirmed' }) }) }))
    expect(container.querySelector('[role="alert"]').textContent).toContain('重新載入')
    expect(container.querySelector('input[aria-label="C2 坍度 實際檢查情形"]').value).toBe('30')
  })

  it('新建:預設第一張範本、日期可改;第一次存檔先確保範本落 DB、建文件(帶 template_id)再存版本', async () => {
    state.store = makeStore()
    // 真 store 建草稿後會把文件放進 fieldDocuments(頁面靠它在 ?doc= 切換後找到文件);替身照做
    const created = baseDoc({ id: 'SC9', current_version_no: 0, status: 'draft', recheck: [] })
    state.store.createFieldDocDraft.mockImplementationOnce(async () => { state.store.fieldDocuments.documents.push(created); return { error: null, doc: created } })
    state.store.saveFieldDocumentVersion.mockResolvedValueOnce({ error: null, result: { version_no: 1, recheck: [{ key: 'results.B1' }, { key: 'results.C2' }] } })
    await render('/self-check'); await flush(); await flush()
    expect(status()).toBe('尚未建立（新自主檢查表）')
    expect(container.querySelector('select[aria-label="檢查表範本"]').value).toBe('T1')
    expect(container.querySelector('input[type="date"]')).toBeTruthy()
    await act(async () => button('存檔').click())
    await flush()
    expect(state.store.ensureChecklistTemplate).toHaveBeenCalledWith(TPL)
    expect(state.store.createFieldDocDraft).toHaveBeenCalledWith('self_check', today, { templateId: 'T1' })
    expect(state.store.saveFieldDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'SC9', baseVersionNo: 0, content: expect.objectContaining({ template_id: 'T1', check_date: today }) }))
    expect(container.textContent).toContain('已存檔 ✓ 版本 1，尚有 2 項待補或待確認')
  })

  it('可簽草稿:意願文字含「自主檢查表」、簽署成功顯示版本與雜湊;已簽署要先「建立更正版本」且有「提送給監造」與「提出查驗申請」', async () => {
    window.confirm = vi.fn(() => true)
    const readyVersion = version({ author_kind: 'human', version_no: 2, content: { ...aiContent(), results: { B1: { value: true }, C2: { value: 18 } } }, field_sources: { ...aiSources(), 'results.B1': { status: 'confirmed', source: 'human' }, 'results.C2': { status: 'confirmed', source: 'human' } } })
    const ready = baseDoc({ status: 'draft', recheck: [], current_version_no: 2 })
    state.store = withDoc(ready, { getFieldDocument: vi.fn().mockResolvedValue({ doc: ready, version: readyVersion, versions: [], signatures: [], submissions: [] }) })
    state.store.signFieldDocument.mockResolvedValueOnce({ result: { version_no: 2, content_hash: 'abcdef0123456789' } })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.textContent).toContain(`本人確認 ${today} 自主檢查表(版本 2,內容雜湊 abcdef012345)內容屬實,同意以本人登入的平台帳號簽署本文件。`)
    expect(container.textContent).toContain('■ 全部合格')
    await act(async () => button('簽署此版本').click())
    await flush()
    expect(state.store.signFieldDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'SC1', versionNo: 2, contentHash: 'abcdef0123456789' }))
    expect(container.textContent).toContain('已簽署版本 2（雜湊 abcdef012345）')
    await act(async () => root.unmount())
    root = createRoot(container)

    const signed = baseDoc({ status: 'signed', recheck: [], current_version_no: 2, target_id: 'REC1' })
    state.store = withDoc(signed, { getFieldDocument: vi.fn().mockResolvedValue({ doc: signed, version: readyVersion, versions: [], signatures: [{ id: 'G1', version_no: 2, content_hash: 'abcdef0123456789', signer_org: 'contractor', signer_name_snapshot: '陳怡君', signed_at: '2026-09-19T01:00:00Z', aal: 'aal1' }], submissions: [] }) })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.textContent).toContain('版本 2 已由 陳怡君 簽署')
    expect(button('建立更正版本')).toBeTruthy()
    expect(button('存檔').disabled).toBe(true)
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('提送給監造')).toBeTruthy()
    expect(button('提出查驗申請（檢附此表）')).toBeTruthy()
  })

  it('唯讀視角:監造除日期外無 input、已提送時有收件／退回;機關唯讀且無收件', async () => {
    const submitted = baseDoc({ status: 'submitted', recheck: [], current_version_no: 2, target_id: 'REC1' })
    const detail = { doc: submitted, version: version({ version_no: 2 }), versions: [], signatures: [], submissions: [{ id: 'X1', document_id: submitted.id, action: 'submit', version_no: 2, actor_org: 'contractor', to_org: 'supervisor', created_at: '2026-09-19T02:00:00Z' }] }
    state.store = makeStore({ documents: [submitted], currentUser: { org_type: 'supervisor', user_id: 'u2' }, can: { edit: false, write: true, submit: false, approve: true, oversee: false, override: false }, getFieldDocument: vi.fn().mockResolvedValue(detail) })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.textContent).toContain('此頁為唯讀')
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('存檔')).toBeUndefined()
    expect(button('收件')).toBeTruthy()
    expect(button('退回（填原因）')).toBeTruthy()
    await act(async () => root.unmount())
    root = createRoot(container)

    state.store = makeStore({ documents: [submitted], currentUser: { org_type: 'owner', user_id: 'u4' }, can: { edit: false, write: false, submit: false, approve: false, oversee: true, readonly: true, override: false }, getFieldDocument: vi.fn().mockResolvedValue(detail) })
    await render('/self-check?doc=SC1'); await flush(); await flush()
    expect(container.textContent).toContain('機關檢視')
    expect(container.querySelectorAll('input:not([type="date"])')).toHaveLength(0)
    expect(button('收件')).toBeUndefined()
    expect(container.textContent).toContain('機關為查閱視角；提送對象是監造')
  })
})
