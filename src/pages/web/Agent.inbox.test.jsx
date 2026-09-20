// @vitest-environment jsdom
// AI 草稿收件匣「拒絕」的連動(P3g;補 P6b-2 留下的缺口):
// AI 起稿的現場文書草稿被拒絕時,那份文件也要一起捨棄(P3f discard_field_document,原因「AI 草稿遭拒絕」)——
// 否則文件留在現場紀錄清單裡當殭屍草稿,同一天／同一目標也起不了新稿。
// 已簽署／已提送的文件是證據,一律不動,只標草稿已拒絕並在畫面說明;建議類(suggest_field_update)本來就不動文件。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null, confirm: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
vi.mock('../../components/confirm.jsx', () => ({ appConfirm: (o) => state.confirm(o) }))
vi.mock('../../lib/assistantData.js', () => ({ useAssistantData: () => ({ data: {}, facts: {}, imported: true, org: 'contractor' }) }))
vi.mock('../../components/CopilotChat.jsx', () => ({ default: () => null }))
import Agent from './Agent.jsx'

let container, root
const action = (over = {}) => ({
  id: 'AGA-1', status: 'pending', kind: 'draft_daily_log', agent_role: 'contractor',
  target_table: 'field_documents', target_id: 'D1', summary: '9/18 施工日誌草稿', evidence: { items: {} }, ...over,
})
const doc = (over = {}) => ({
  id: 'D1', doc_type: 'daily_log', doc_date: '2026-09-18', owner_org: 'contractor',
  status: 'pending_input', current_version_no: 1, ...over,
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  state.confirm = vi.fn().mockResolvedValue(true)
  state.store = {
    agentActions: [action()], agentActionsLoading: false,
    resolveAgentAction: vi.fn().mockResolvedValue({ error: null }),
    acceptDraft: vi.fn(),
    discardFieldDocument: vi.fn().mockResolvedValue({ error: null, result: { agent_actions_resolved: 1 } }),
    fieldDocuments: { documents: [doc()], submissions: [], signedDocumentIds: [] },
    currentUser: { org_type: 'contractor' },
    runAgent: vi.fn(), aiEnabled: () => false,
  }
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = () => act(async () => { root.render(<MemoryRouter><Agent /></MemoryRouter>) })
const reject = async () => {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '拒絕')
  await act(async () => btn.click())
}

describe('拒絕 AI 起稿的現場文書草稿', () => {
  it('未簽署的草稿:確認後以「AI 草稿遭拒絕」捨棄那份文件,畫面說明版本與照片保留', async () => {
    await render()
    await reject()
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, confirmLabel: '拒絕並捨棄' }))
    expect(state.store.discardFieldDocument).toHaveBeenCalledWith({ documentId: 'D1', versionNo: 1, reason: 'AI 草稿遭拒絕' })
    // 伺服器同交易已把草稿標 rejected(agent_actions_resolved=1),前端不再重複標一次
    expect(state.store.resolveAgentAction).not.toHaveBeenCalled()
    expect(container.textContent).toContain('捨棄 2026-09-18 施工日誌草稿')
    expect(container.textContent).toContain('版本與照片保留')
  })

  it('示範模式(伺服器沒有連動交易):捨棄成功後仍把草稿標成已拒絕', async () => {
    state.store.discardFieldDocument.mockResolvedValue({ error: null, result: { agent_actions_resolved: 0 } })
    await render()
    await reject()
    expect(state.store.resolveAgentAction).toHaveBeenCalledWith('AGA-1', 'rejected')
  })

  it('在確認框按取消:什麼都不做(草稿留在收件匣)', async () => {
    state.confirm.mockResolvedValue(false)
    await render()
    await reject()
    expect(state.store.discardFieldDocument).not.toHaveBeenCalled()
    expect(state.store.resolveAgentAction).not.toHaveBeenCalled()
  })

  it('捨棄失敗:如實顯示伺服器訊息,草稿不會被偷偷標成已拒絕', async () => {
    state.store.discardFieldDocument.mockResolvedValue({ error: { code: 'PD008', message: '此文件曾經簽署或提送' } })
    await render()
    await reject()
    expect(state.store.resolveAgentAction).not.toHaveBeenCalled()
    expect(container.textContent).toContain('此文件曾經簽署或提送')
  })

  it('已簽署／已提送的文件:只標草稿已拒絕,文件保留並說明為什麼', async () => {
    state.store.fieldDocuments = { documents: [doc({ status: 'submitted' })], submissions: [], signedDocumentIds: [] }
    await render()
    await reject()
    expect(state.store.discardFieldDocument).not.toHaveBeenCalled()
    expect(state.store.resolveAgentAction).toHaveBeenCalledWith('AGA-1', 'rejected')
    expect(container.textContent).toContain('已經簽署或提送')
    expect(container.textContent).toContain('文件保留')
  })

  it('簽後更正回到草稿狀態的文件(曾經簽署)一樣不動', async () => {
    state.store.fieldDocuments = { documents: [doc({ status: 'draft' })], submissions: [], signedDocumentIds: ['D1'] }
    await render()
    await reject()
    expect(state.store.discardFieldDocument).not.toHaveBeenCalled()
    expect(container.textContent).toContain('已經簽署或提送')
  })

  it('不指向文件的草稿(稽核提示)照舊只標拒絕,不出現確認框', async () => {
    state.store.agentActions = [action({ kind: 'audit_note', target_table: 'audit_events', target_id: 'E1', evidence: { findings: [] } })]
    await render()
    await reject()
    expect(state.confirm).not.toHaveBeenCalled()
    expect(state.store.discardFieldDocument).not.toHaveBeenCalled()
    expect(state.store.resolveAgentAction).toHaveBeenCalledWith('AGA-1', 'rejected')
  })

  it('建議類(suggest_field_update)即使指向草稿文件也不捨棄:那是人在編的文件', async () => {
    state.store.agentActions = [action({ kind: 'suggest_field_update' })]
    await render()
    await reject()
    expect(state.store.discardFieldDocument).not.toHaveBeenCalled()
    expect(state.store.resolveAgentAction).toHaveBeenCalledWith('AGA-1', 'rejected')
  })
})
