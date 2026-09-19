// @vitest-environment jsdom
// 文件生命週期卡的提送／退回呈現(P3d;四類文書共用):
// - 退回歷史:歷次退回全列(原因、退回人、台北時間、補正再送與 DB 算的差異),不只最新一筆;
// - 提送回執:對象、送出時間、送件版本與雜湊、回執編號(完整 submission_id)、收件狀態、下一責任方;
// - 退回人姓名以既有成員名單對照,名單載入失敗如實標示、只顯示單位。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import DocumentLifecycle from './DocumentLifecycle.jsx'

let container, root
const doc = (over = {}) => ({ id: 'D1', doc_type: 'daily_log', owner_org: 'contractor', doc_date: '2026-09-18', status: 'submitted', current_version_no: 4, recheck: [], ...over })
const row = (id, action, version_no, created_at, over = {}) => ({ id, document_id: 'D1', action, version_no, content_hash: `hash${version_no}abcdefghijk`, actor_org: action === 'submit' ? 'contractor' : 'supervisor', actor_id: action === 'submit' ? 'u1' : 'u2', to_org: 'supervisor', reason: null, diff: null, created_at, ...over })
const rows = [
  row('11111111-aaaa-bbbb-cccc-000000000001', 'submit', 2, '2026-09-18T01:00:00Z'),
  row('R1', 'return', 2, '2026-09-18T02:00:00Z', { reason: '材料使用請補進料證明' }),
  row('11111111-aaaa-bbbb-cccc-000000000002', 'submit', 3, '2026-09-18T03:00:00Z', { diff: { against_version_no: 2, changed_keys: ['materials', 'work_summary'] } }),
  row('R2', 'return', 3, '2026-09-18T04:00:00Z', { reason: '下午天氣漏填', actor_id: 'u3' }),
  row('11111111-aaaa-bbbb-cccc-000000000003', 'submit', 4, '2026-09-18T05:00:00Z', { diff: { against_version_no: 3, changed_keys: ['weather_pm'] } }),
].reverse() // getFieldDocument 回新→舊
const members = [{ user_id: 'u1', full_name: '陳怡君' }, { user_id: 'u2', full_name: '王建國' }, { user_id: 'u3', full_name: '林監造' }]

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
const render = (props) => act(async () => { root.render(<MemoryRouter><DocumentLifecycle viewerOrg="supervisor" canAct version={{ content_hash: 'hash4abcdefghijk' }} {...props} /></MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const group = (name) => container.querySelector(`[role="group"][aria-label="${name}"]`)

describe('提送回執與退回歷史', () => {
  it('歷次退回全列:原因、退回人(姓名)、台北時間、補正再送版本與差異', async () => {
    state.store = { listMembers: vi.fn().mockResolvedValue({ rows: members, error: null }) }
    await render({ doc: doc(), submissions: rows }); await flush()
    const hist = group('退回歷史')
    expect(hist.textContent).toContain('退回歷史（2）')
    const items = [...hist.querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toHaveLength(2)
    expect(items[0]).toContain('第 1 次・版本 2・2026-09-18 10:00・退回人 監造 王建國')
    expect(items[0]).toContain('原因：材料使用請補進料證明')
    expect(items[0]).toContain('補正：版本 3 於 2026-09-18 11:00 再送。')
    expect(items[0]).toContain('相對退回版本 2 的差異：材料使用、工作摘要')
    expect(items[1]).toContain('第 2 次・版本 3・2026-09-18 12:00・退回人 監造 林監造')
    expect(items[1]).toContain('原因：下午天氣漏填')
    expect(items[1]).toContain('相對退回版本 3 的差異：天氣(下午)')
  })

  it('提送回執:對象、送出時間、送件版本與雜湊、完整回執編號、待收件、下一責任方', async () => {
    state.store = { listMembers: vi.fn().mockResolvedValue({ rows: members, error: null }) }
    await render({ doc: doc(), submissions: rows }); await flush()
    const r = group('提送與回執').textContent
    expect(r).toContain('提送對象監造')
    expect(r).toContain('送出2026-09-18 13:00・施工廠商 陳怡君')
    expect(r).toContain('送件版本版本 4・雜湊 hash4abcdefg')
    expect(r).toContain('回執編號11111111-aaaa-bbbb-cccc-000000000003')
    expect(r).toContain('收件狀態待監造收件')
    expect(r).toContain('下一責任方：監造（待收件）')
  })

  it('尚未補正再送的退回標「尚未補正再送」;收件後回執顯示收件時間與不可再修改', async () => {
    state.store = { listMembers: vi.fn().mockResolvedValue({ rows: members, error: null }) }
    const returned = rows.slice(1) // 去掉最後一次再送:第二次退回尚未補正
    await render({ doc: doc({ status: 'returned', current_version_no: 3 }), submissions: returned, viewerOrg: 'contractor' }); await flush()
    const items = [...group('退回歷史').querySelectorAll('li')].map((li) => li.textContent)
    expect(items[1]).toContain('尚未補正再送')
    expect(group('提送與回執').textContent).toContain('已於 2026-09-18 12:00 退回（監造 林監造）')
    expect(group('提送與回執').textContent).toContain('下一責任方：施工廠商（被退回待補正）')

    const received = [row('C1', 'receive', 4, '2026-09-18T06:00:00Z'), ...rows]
    await render({ doc: doc({ status: 'received' }), submissions: received }); await flush()
    const r = group('提送與回執').textContent
    expect(r).toContain('監造已於 2026-09-18 14:00 收件（版本 4）；本文件不可再修改')
    expect(r).toContain('下一責任方：無（已收件）')
  })

  it('成員名單載入失敗:退回人只顯示單位並如實標示', async () => {
    state.store = { listMembers: vi.fn().mockResolvedValue({ rows: [], error: '成員載入失敗' }) }
    await render({ doc: doc(), submissions: rows }); await flush()
    expect(group('退回歷史').textContent).toContain('退回人 監造')
    expect(group('退回歷史').textContent).not.toContain('王建國')
    expect(container.textContent).toContain('成員名單載入失敗，送件與退回人只顯示單位。')
  })

  it('沒有任何提送:不顯示回執與退回歷史,也不查成員名單', async () => {
    const listMembers = vi.fn()
    state.store = { listMembers }
    await render({ doc: doc({ status: 'signed' }), submissions: [], viewerOrg: 'contractor' }); await flush()
    expect(group('提送與回執')).toBeNull()
    expect(group('退回歷史')).toBeNull()
    expect(listMembers).not.toHaveBeenCalled()
  })
})
