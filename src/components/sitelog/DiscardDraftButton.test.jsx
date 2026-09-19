// @vitest-environment jsdom
// 捨棄草稿入口(P3f;四類文書頁與 /site 清單共用):
// - 只有責任方、從未簽署的草稿顯示(與伺服器同一組條件);沒有編輯權時不顯示;
// - 確認對話框原因必填(appPrompt required、danger),取消不呼叫伺服器;
// - 成功把伺服器結果交給呼叫端;伺服器拒絕(PD008 等)如實顯示訊息、不呼叫 onDiscarded。
// 文件頁整合:DocumentLifecycle 對責任方從未簽署的草稿顯示入口,捨棄後回 /site 並帶已捨棄說明。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null, prompt: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
vi.mock('../confirm.jsx', () => ({
  appConfirm: vi.fn().mockResolvedValue(true),
  appPrompt: (opts) => state.prompt(opts),
}))
import DiscardDraftButton from './DiscardDraftButton.jsx'
import DocumentLifecycle from './DocumentLifecycle.jsx'

let container, root
const doc = (over = {}) => ({ id: 'D1', doc_type: 'daily_log', owner_org: 'contractor', doc_date: '2026-09-20', status: 'pending_input', current_version_no: 2, recheck: [], ...over })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  state.store = { discardFieldDocument: vi.fn(), listMembers: vi.fn().mockResolvedValue({ rows: [], error: null }) }
  state.prompt = vi.fn().mockResolvedValue('照片日期判錯')
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (ui) => act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = () => container.querySelector('button[aria-label^="捨棄草稿"]')
const click = (el) => act(async () => { el.click() })

describe('DiscardDraftButton', () => {
  it('顯示條件:責任方＋未簽署狀態＋從未簽署＋可編輯', async () => {
    await render(<DiscardDraftButton doc={doc()} viewerOrg="contractor" canAct />)
    expect(button()?.textContent).toBe('捨棄草稿')
    expect(button().getAttribute('aria-label')).toBe('捨棄草稿：2026-09-20 施工日誌')
    for (const props of [
      { doc: doc(), viewerOrg: 'supervisor', canAct: true },
      { doc: doc(), viewerOrg: 'contractor', canAct: false },
      { doc: doc({ status: 'signed' }), viewerOrg: 'contractor', canAct: true },
      { doc: doc({ status: 'draft' }), viewerOrg: 'contractor', canAct: true, everSigned: true },
    ]) {
      await render(<DiscardDraftButton {...props} />)
      expect(button()).toBeNull()
    }
  })

  it('原因必填的確認對話框 → 以原因呼叫伺服器 → 結果交給呼叫端', async () => {
    const onDiscarded = vi.fn()
    state.store.discardFieldDocument.mockResolvedValue({ error: null, result: { status: 'discarded', discard_reason: '照片日期判錯' } })
    await render(<DiscardDraftButton doc={doc()} viewerOrg="contractor" canAct dirty onDiscarded={onDiscarded} />)
    await click(button()); await flush()
    const opts = state.prompt.mock.calls[0][0]
    expect(opts).toMatchObject({ required: true, danger: true, confirmLabel: '捨棄草稿', title: '捨棄 2026-09-20 施工日誌草稿？' })
    expect(opts.body).toContain('2 個版本與照片都會保留')
    expect(opts.body).toContain('尚未存檔的修改也會一併放棄')
    expect(state.store.discardFieldDocument).toHaveBeenCalledWith({ documentId: 'D1', versionNo: 2, reason: '照片日期判錯' })
    expect(onDiscarded).toHaveBeenCalledWith({ status: 'discarded', discard_reason: '照片日期判錯' }, expect.objectContaining({ id: 'D1' }))
  })

  it('取消對話框不呼叫伺服器', async () => {
    state.prompt.mockResolvedValue(null)
    await render(<DiscardDraftButton doc={doc()} viewerOrg="contractor" canAct />)
    await click(button()); await flush()
    expect(state.store.discardFieldDocument).not.toHaveBeenCalled()
  })

  it('伺服器拒絕(曾經簽署 PD008)→ 如實顯示訊息,不通知呼叫端', async () => {
    const onDiscarded = vi.fn()
    state.store.discardFieldDocument.mockResolvedValue({ error: { code: 'PD008', message: '此文件曾經簽署或提送(目前是簽後更正的草稿),不可捨棄;請完成更正後重新簽署' } })
    await render(<DiscardDraftButton doc={doc()} viewerOrg="contractor" canAct onDiscarded={onDiscarded} />)
    await click(button()); await flush()
    expect(container.querySelector('[role="alert"]').textContent).toContain('此文件曾經簽署或提送')
    expect(onDiscarded).not.toHaveBeenCalled()
  })
})

describe('DocumentLifecycle 捨棄入口', () => {
  function Where() {
    const loc = useLocation()
    return <div data-testid="where">{loc.pathname}|{JSON.stringify(loc.state)}</div>
  }
  const renderPage = (props) => act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/site-log?doc=D1']}>
        <Routes>
          <Route path="/site-log" element={<DocumentLifecycle viewerOrg="contractor" canAct version={{ content_hash: 'h'.repeat(64) }} {...props} />} />
          <Route path="/site" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
  })

  it('責任方從未簽署的草稿有入口;捨棄後回 /site 並帶已捨棄說明', async () => {
    state.store.discardFieldDocument.mockResolvedValue({ error: null, result: { status: 'discarded', discard_reason: '照片日期判錯' } })
    await renderPage({ doc: doc(), signatures: [] })
    await click(button()); await flush()
    expect(container.querySelector('[data-testid="where"]').textContent).toBe(
      '/site|{"discardedDoc":{"doc_type":"daily_log","doc_date":"2026-09-20","reason":"照片日期判錯"}}')
  })

  it('簽後更正的草稿(有簽署列)、他方、已簽署 → 沒有入口', async () => {
    await renderPage({ doc: doc({ status: 'draft', current_version_no: 3 }), signatures: [{ id: 'S1', version_no: 2, signed_at: '2026-09-19T01:00:00Z' }] })
    expect(button()).toBeNull()
    await renderPage({ doc: doc(), signatures: [], viewerOrg: 'supervisor' })
    expect(button()).toBeNull()
    await renderPage({ doc: doc({ status: 'signed' }), signatures: [{ id: 'S1', version_no: 2, signed_at: '2026-09-19T01:00:00Z' }] })
    expect(button()).toBeNull()
  })
})
