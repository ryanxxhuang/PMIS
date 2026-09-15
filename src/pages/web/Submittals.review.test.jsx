// @vitest-environment jsdom
// 監造送審審查的工作順序(UIUX 階段 4 U08):
// - 詳情頂端說「待受理/待審定、Rev、為何輪到我、上次退回原因、本次補正說明」;
// - 受理段與審定段分開:已提送只有受理審核/退回補正;受理後才有核准/核備/退回補正/駁回;
// - 退回補正/駁回必填原因(空白不寫入);審定失敗不改狀態;取消不寫入;
// - 完成後留下結果與下一責任方,「下一件待審」由人點才換單;
// - AI 助手在文件區、說明資料範圍與「結果只保留在本頁」;沒上傳文件本體就如實說讀不了。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Submittals from './Submittals.jsx'

let container, root
const resubmitted = {
  id: 'S3', submittal_no: 'SUB-003', title: '外牆窯燒磚 材料送審', category: '材料設備', revision: 1, status: '已提送',
  submitted_date: '2026-09-13', due_date: '2026-09-20', decided_date: null,
  review_note: '第一次退回:未附出廠證明與試驗報告', attachment_note: '含出廠證明、CNS 試驗報告\n補正(Rev.1):已補試驗報告', attachment_path: null,
}
const other = { id: 'S2', submittal_no: 'SUB-002', title: '4F 以上結構體施工計畫', category: '施工計畫', revision: 0, status: '審核中', submitted_date: '2026-09-09', due_date: '2026-09-16', review_note: null, attachment_note: null, attachment_path: null }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  Element.prototype.scrollIntoView ??= () => {}
  state.store = {
    submittals: [resubmitted, other], createSubmittal: vi.fn(), decideSubmittal: vi.fn(), resubmitSubmittal: vi.fn(), deleteSubmittal: vi.fn(),
    reviewSubmittal: vi.fn(), uploadSubmittalFile: vi.fn(), readSubmittalDoc: vi.fn(),
    isSupabaseConfigured: false, currentProject: { project_id: 'p1' }, currentUser: { org_type: 'supervisor' },
    can: { submit: false, approve: true }, aiEnabled: () => false, isPlatformAdmin: false,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.matchMedia
  delete window.prompt
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (entry = '/submittals?submittal=S3') => act(async () => {
  root.render(<MemoryRouter initialEntries={[entry]}><Submittals /></MemoryRouter>)
})
const detail = (no = 'SUB-003') => container.querySelector(`[aria-label="${no} 詳情"]`)
const buttons = (name) => [...container.querySelectorAll('button')].filter((b) => b.textContent.trim() === name)
const btnIn = (el, name) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === name)

describe('監造審查順序', () => {
  it('補正再送件:頂端有待受理、Rev.1、上次退回原因與本次補正說明;只有受理段的按鈕', async () => {
    await render()
    const d = detail()
    expect(d.textContent).toContain('待受理 · Rev.1 補正再送')
    expect(d.textContent).toContain('為何輪到你：廠商已提送，先「受理審核」才能審定')
    expect(d.textContent).toContain('上次退回原因：第一次退回:未附出廠證明與試驗報告')
    expect(d.textContent).toContain('本次補正說明：已補試驗報告')
    expect(d.textContent).toContain('補正紀錄')
    expect(btnIn(d, '受理審核')).toBeTruthy()
    expect(btnIn(d, '退回補正')).toBeTruthy()
    expect(btnIn(d, '核准')).toBeUndefined()
    expect(btnIn(d, '駁回')).toBeUndefined()
    // AI 關閉時如實說,決定鈕仍可用(沒有 AI 也能審)
    expect(d.textContent).toContain('AI 審查功能未啟用，請直接依文件審定')
  })

  it('受理 → 審定段出現;退回補正空白原因不寫入;審定失敗狀態不變;核准後留結果與下一件', async () => {
    state.store.decideSubmittal
      .mockImplementationOnce(async (id, status, note) => {
        state.store = { ...state.store, submittals: [{ ...resubmitted, status, review_note: note }, other] }
        return { error: null }
      })
    window.prompt = vi.fn(() => '')
    await render()
    await act(async () => btnIn(detail(), '受理審核').click())
    expect(state.store.decideSubmittal).toHaveBeenCalledWith('S3', '審核中', resubmitted.review_note)
    await render()
    let d = detail()
    expect(d.textContent).toContain('已受理審核，本件現在輪到你審定')
    expect(d.textContent).toContain('待審定 · Rev.1 補正再送')
    expect(btnIn(d, '受理審核')).toBeUndefined()
    for (const name of ['核准', '核備', '退回補正', '駁回']) expect(btnIn(d, name)).toBeTruthy()
    expect(d.textContent).toContain('駁回＝終局')

    // 退回補正原因空白:不寫入、說明原因
    window.prompt = vi.fn(() => '   ')
    await act(async () => btnIn(detail(), '退回補正').click())
    expect(state.store.decideSubmittal).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('退回補正未寫入：需填寫退回補正原因')

    // 取消對話框:不寫入
    window.prompt = vi.fn(() => null)
    await act(async () => btnIn(detail(), '駁回').click())
    expect(state.store.decideSubmittal).toHaveBeenCalledTimes(1)

    // 核准寫入失敗:狀態不變、仍可再按
    window.prompt = vi.fn(() => '')
    state.store.decideSubmittal.mockResolvedValueOnce({ error: { message: 'boom' } })
    await act(async () => btnIn(detail(), '核准').click())
    expect(container.textContent).toContain('核准未寫入')
    expect(detail().textContent).toContain('待審定')
    expect(btnIn(detail(), '核准').disabled).toBe(false)

    // 核准成功:結果與下一責任方,「下一件待審」由人點才換到 SUB-002
    state.store.decideSubmittal.mockImplementationOnce(async (id, status) => {
      state.store = { ...state.store, submittals: [{ ...resubmitted, status: '核准', decided_date: '2026-09-15' }, other] }
      return { error: null }
    })
    await act(async () => btnIn(detail(), '核准').click())
    await render()
    d = detail()
    expect(d.textContent).toContain('已核准 · 交廠商')
    expect(btnIn(d, '核准')).toBeUndefined()
    const next = [...d.querySelectorAll('button')].find((b) => b.textContent.startsWith('下一件待審'))
    expect(next.textContent).toContain('（1）')
    expect(detail('SUB-002')).toBeNull()
    await act(async () => next.click())
    expect(detail('SUB-002')).toBeTruthy()
    expect(detail('SUB-002').textContent).toContain('待審定 · Rev.0 首次提送')
    expect(detail('SUB-002').textContent).toContain('無退回紀錄')
  })

  it('AI 開啟:兩項能力各有說明與資料範圍;沒上傳文件本體就說讀不了、只給審查助手', async () => {
    state.store = { ...state.store, aiEnabled: () => true }
    await render()
    const d = detail()
    expect(d.textContent).toContain('AI 助手（可選，結果只保留在本頁，離開後需重新執行）')
    expect(d.textContent).toContain('依契約規範與工項列審查要點、草擬意見；不讀文件本體')
    expect(d.textContent).toContain('尚未上傳文件本體，無法執行')
    expect(btnIn(d, 'AI 審查助手')).toBeTruthy()
    expect(btnIn(d, 'AI 讀文件審查')).toBeUndefined()
    expect(buttons('受理審核').length).toBe(1)
  })
})
