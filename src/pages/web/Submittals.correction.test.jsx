// @vitest-environment jsdom
// 廠商送審的附件與補正(UIUX 階段 3A U06):
// - 退回補正件:詳情先看到退回原因、目前版次與附件狀態,下一步「修正再送」就在旁邊、不重複;
// - 上傳失敗:附件狀態仍是「尚未上傳」、提送紀錄不受影響、可重選檔案;上傳成功只講文件已上傳;
// - 修正再送成功:顯示新版次與「等待監造受理」,補正說明留在補正紀錄裡,歷史不被覆蓋。
// 定位只走 role/aria-label/文字(規範 §7 零視覺耦合)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Submittals from './Submittals.jsx'

let container, root
const returned = {
  id: 'S3', submittal_no: 'SUB-003', title: '外牆窯燒磚 材料送審', category: '材料設備', revision: 0, status: '退回補正',
  submitted_date: '2026-09-01', due_date: '2026-09-08', decided_date: '2026-09-05',
  review_note: '第一次退回:未附出廠證明與試驗報告', attachment_note: '含出廠證明', attachment_path: null, attachment_name: null,
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  // 深連結 ?submittal= 會在 60ms 後捲到該列;jsdom 沒有 scrollIntoView,不補會變成測後 unhandled error
  Element.prototype.scrollIntoView ??= () => {}
  state.store = {
    submittals: [returned], createSubmittal: vi.fn(), decideSubmittal: vi.fn(), resubmitSubmittal: vi.fn(), deleteSubmittal: vi.fn(),
    reviewSubmittal: vi.fn(), uploadSubmittalFile: vi.fn(), readSubmittalDoc: vi.fn(),
    isSupabaseConfigured: false, currentProject: { project_id: 'p1' }, currentUser: { org_type: 'contractor' },
    can: { submit: true, approve: false }, aiEnabled: () => false, isPlatformAdmin: false,
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

const render = () => act(async () => {
  root.render(<MemoryRouter initialEntries={['/submittals?submittal=S3']}><Submittals /></MemoryRouter>)
})
const detail = () => container.querySelector('[aria-label="SUB-003 詳情"]')
const buttons = (name) => [...container.querySelectorAll('button')].filter((b) => b.textContent.trim() === name)
const fileInput = () => detail().querySelector('input[type="file"]')
const pickFile = (name) => act(async () => {
  const input = fileInput()
  const file = new File(['%PDF'], name, { type: 'application/pdf' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
})

describe('退回補正件的詳情', () => {
  it('先看到退回原因、目前版次與附件狀態,修正再送只出現一次', async () => {
    await render()
    const d = detail()
    expect(d.textContent).toContain('本件被監造退回，輪到你補正（目前 Rev.0）')
    expect(d.textContent).toContain('退回原因：第一次退回:未附出廠證明與試驗報告')
    expect(d.textContent).toContain('尚未上傳文件本體')
    expect(d.textContent).toContain('版次將成為 Rev.1')
    expect(buttons('修正再送').length).toBe(1)
    // 文件與提送方式同一區:附件說明與外部提送說明都在
    expect(d.textContent).toContain('文件與提送方式')
    expect(d.textContent).toContain('附件說明：含出廠證明')
    expect(d.textContent).toContain('以公文或雲端連結另送')
  })
})

describe('上傳文件', () => {
  it('失敗:附件狀態不變、提示可重試、input 可再選;成功:只講文件已上傳且仍需再送', async () => {
    state.store.uploadSubmittalFile.mockResolvedValueOnce({ error: { message: 'boom' } })
    await render()
    await pickFile('出廠證明.pdf')
    expect(state.store.uploadSubmittalFile).toHaveBeenCalledTimes(1)
    expect(detail().textContent).toContain('文件上傳失敗：本件仍是「尚未上傳文件本體」')
    expect(detail().textContent).toContain('尚未上傳文件本體')
    expect(detail().textContent).not.toContain('已附文件')
    expect(fileInput().disabled).toBe(false)

    state.store.uploadSubmittalFile.mockImplementationOnce(async () => {
      state.store = { ...state.store, submittals: [{ ...returned, attachment_path: 'p/x.pdf', attachment_name: '出廠證明.pdf' }] }
      return { error: null }
    })
    await pickFile('出廠證明.pdf')
    await render()
    expect(detail().textContent).toContain('文件「出廠證明.pdf」已更換')
    expect(detail().textContent).toContain('仍需「修正再送」')
    expect(detail().textContent).toContain('已附文件：出廠證明.pdf')
  })
})

describe('修正再送', () => {
  it('成功:顯示 Rev.1 已再送、等待監造受理;補正說明進補正紀錄,原附件說明不被覆蓋', async () => {
    // 沒掛 ConfirmHost 時 appPrompt 退回 window.prompt;jsdom 沒有實作,直接 stub
    window.prompt = vi.fn(() => '已補出廠證明與 CNS 試驗報告')
    state.store.resubmitSubmittal.mockImplementationOnce(async (id, note) => {
      state.store = { ...state.store, submittals: [{ ...returned, status: '已提送', revision: 1, decided_date: null,
        attachment_note: `${returned.attachment_note}\n補正(Rev.1):${note}` }] }
      return { error: null }
    })
    await render()
    await act(async () => buttons('修正再送')[0].click())
    expect(state.store.resubmitSubmittal).toHaveBeenCalledWith('S3', '已補出廠證明與 CNS 試驗報告')
    await render()
    const d = detail()
    expect(d.textContent).toContain('Rev.1 已再送，狀態回到已提送，等待監造受理審核')
    expect(d.textContent).toContain('補正紀錄')
    expect(d.textContent).toContain('補正(Rev.1):已補出廠證明與 CNS 試驗報告')
    expect(d.textContent).toContain('附件說明：含出廠證明')
    // 已回到待審:退回區塊與再送鈕都不再出現
    expect(d.textContent).not.toContain('本件被監造退回')
    expect(buttons('修正再送').length).toBe(0)
  })

  it('取消對話框不寫入;寫入失敗顯示錯誤且仍可再送', async () => {
    window.prompt = vi.fn(() => null)
    await render()
    await act(async () => buttons('修正再送')[0].click())
    expect(state.store.resubmitSubmittal).not.toHaveBeenCalled()
    window.prompt = vi.fn(() => '補件')
    state.store.resubmitSubmittal.mockResolvedValueOnce({ error: { message: 'boom' } })
    await act(async () => buttons('修正再送')[0].click())
    expect(container.textContent).toContain('再送未寫入')
    expect(detail().textContent).toContain('本件被監造退回')
    expect(buttons('修正再送')[0].disabled).toBe(false)
  })
})
