// @vitest-environment jsdom
// Agent 對話起稿的收件匣接受(P6b-2):文件已由 Edge(demo:種子)建好,接受只把人填的數量疊到文件目前版本、存成人工版本。
// 釘住:只改人填的那幾格(confirmed／human),其餘內容與附件原樣;沒填數量不新增版本;找不到文件回明確錯誤。
import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'

import { unconfigured } from '../../testUtils/supabaseMock.js'
vi.mock('../../lib/supabase.js', () => unconfigured())

import { renderHook } from '../../testUtils/renderHook.js'
import { useFieldDocsSlice } from './fieldDocs.js'

const seedDoc = () => ({
  doc: {
    id: 'FD-1', project_id: 'demo', doc_type: 'daily_log', owner_org: 'contractor', target_table: 'daily_logs', target_id: null, target_key: null,
    intake_id: null, doc_date: '2026-09-20', status: 'pending_input', current_version_no: 1, template_id: null, required_fields: [], recheck: [],
    created_by: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
  },
  versions: [{
    id: 'FD-1-V1', document_id: 'FD-1', version_no: 1, author_kind: 'ai', created_by: null,
    content: { log_date: '2026-09-20', weather_am: '晴', weather_pm: '晴', labor: [], equipment: [], materials: [], extras: {}, work_summary: '摘要', items: { K1: { item_key: 'K1', description: '模板', qty_today: null }, K2: { item_key: 'K2', description: '鋼筋', qty_today: null } }, photo_ids: [], unmatched_photo_ids: [] },
    field_sources: { weather_am: { status: 'filled', source: 'cwa' }, 'items.K1.qty_today': { status: 'pending', source: null }, 'items.K2.qty_today': { status: 'pending', source: null } },
    attachments: [{ photo_id: 'P1', storage_path: 'x/P1.jpg' }], content_hash: 'h1', change_note: 'Agent 對話起稿', amended_from_version: null, created_at: '2026-09-20T00:00:00Z',
  }],
})

const setup = () => {
  const h = renderHook(() => useFieldDocsSlice({ demoMode: true, dbMode: false, isPersistedProject: false, currentProject: { project_id: 'demo' }, currentUser: { user_id: 'u1' }, wiMaps: { byKey: new Map(), idToKey: new Map(), byId: new Map() } }, {}))
  act(() => h.current.seedDemoDocs([seedDoc()]))
  return h
}

describe('fillAgentDraftQuantities(收件匣接受 Agent 日誌草稿)', () => {
  it('人填的數量疊到文件目前版本、存成人工版本 2;其餘內容、來源與附件原樣', async () => {
    const h = setup()
    let r
    await act(async () => { r = await h.current.fillAgentDraftQuantities({ documentId: 'FD-1', quantities: { K1: '12.5', K2: '' } }) })
    expect(r.error).toBeNull()
    expect(r.result.version_no).toBe(2)
    const got = await h.current.getFieldDocument('FD-1')
    expect(got.doc.current_version_no).toBe(2)
    expect(got.version).toMatchObject({ author_kind: 'human', change_note: '接受 AI 對話草稿(填入數量)', attachments: [{ photo_id: 'P1', storage_path: 'x/P1.jpg' }] })
    expect(got.version.content.items.K1.qty_today).toBe(12.5)
    expect(got.version.content.items.K2.qty_today).toBeNull()
    expect(got.version.content.work_summary).toBe('摘要')
    expect(got.version.field_sources['items.K1.qty_today']).toEqual({ status: 'confirmed', source: 'human' })
    expect(got.version.field_sources['items.K2.qty_today'].status).toBe('pending')
    expect(got.version.field_sources.weather_am).toEqual({ status: 'filled', source: 'cwa' })
  })

  it('沒填任何數量:不新增版本(文件已在,只是還沒人補)', async () => {
    const h = setup()
    let r
    await act(async () => { r = await h.current.fillAgentDraftQuantities({ documentId: 'FD-1', quantities: {} }) })
    expect(r).toMatchObject({ error: null, result: null })
    expect((await h.current.getFieldDocument('FD-1')).doc.current_version_no).toBe(1)
  })

  it('找不到文件(已捨棄／無權限):回明確錯誤', async () => {
    const h = setup()
    let r
    await act(async () => { r = await h.current.fillAgentDraftQuantities({ documentId: 'FD-404', quantities: { K1: '1' } }) })
    expect(r.error.message).toContain('找不到這份草稿文件')
  })
})
