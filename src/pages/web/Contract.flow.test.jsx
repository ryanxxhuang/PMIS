// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createFakePostgrest } from '../../testUtils/fakePostgrest.js'

const state = vi.hoisted(() => ({ db: null, store: null, upload: vi.fn(), writes: [] }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
vi.mock('../../lib/supabase.js', () => ({ isSupabaseConfigured: true, supabase: {
  from: (table) => {
    const builder = state.db.supabase.from(table)
    builder.update = (patch) => {
      state.writes.push({ table, patch })
      return { eq: () => Promise.resolve({ data: null, error: null }) }
    }
    return builder
  },
} }))
vi.mock('../../lib/packageUpload.js', async (original) => ({
  ...await original(), uploadFilesToPackage: (...args) => state.upload(...args),
}))
import Contract from './Contract.jsx'

let root, container
const pkg = { id: 'pkg1', project_id: 'p1', title: '施工契約', package_type: 'construction', counterparty_project_party_id: 'party1' }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.db = createFakePostgrest(); state.writes = []; state.upload.mockReset()
  state.db.setTable('contract_packages', [pkg])
  state.db.setTable('project_parties', [{ id: 'party1', project_id: 'p1', party_type: 'contractor', display_name: '施工單位' }])
  state.store = { currentProject: { project_id: 'p1' }, isSupabaseConfigured: true, isPersistedProject: true,
    // can.write = 前端鏡像 DB can_write();規則本體在 store.jsx,這裡只給結果
    currentUser: { org_type: 'contractor', user_id: 'u1' }, can: { write: true },
    currentProjectMembership: { party_type: 'contractor', project_party_id: 'party1' },
    reloadMembership: vi.fn(), reloadObligations: vi.fn(), workItemsSource: 'empty' }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/contract?package=pkg1']}><Contract /></MemoryRouter>))
}
function seedResult(extra = {}) {
  const run = { id: 'run1', contract_package_id: 'pkg1', document_version_id: 'v1', status: 'completed', stage: 'completed',
    classification_status: 'auto_accepted', metadata: { requirement_extraction: 'completed' }, ...extra }
  state.db.setTable('document_processing_runs', [run])
  state.db.setTable('documents', [{ id: 'doc1', contract_package_id: 'pkg1', title: '契約.pdf', document_type: 'contract' }])
  state.db.setTable('document_versions', [{ id: 'v1', document_id: 'doc1', version_label: 'v1' }])
  state.db.setTable('document_ingestion_runs', [{ id: 'ing1', document_version_id: 'v1' }])
  state.db.setTable('requirements', [{ id: 'req1', ingestion_run_id: 'ing1', status: 'approved' }])
  return run
}

it('上傳完成會更新履約資料，提供帶契約範圍的結果入口', async () => {
  state.upload.mockImplementation(async ({ files, onRun }) => {
    expect(files[0].name).toBe('契約.txt')
    const run = seedResult(); onRun(run)
    return { runs: [run], failures: [] }
  })
  await render()
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('上傳契約文件'))
  expect(button.disabled).toBe(false)
  const input = container.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['契約內容'], '契約.txt', { type: 'text/plain' })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(state.upload).toHaveBeenCalledTimes(1)
  expect(state.store.reloadObligations).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('1 項已歸檔契約重點')
  expect([...container.querySelectorAll('a')].some((a) => a.textContent.includes('查看這份契約重點') && a.getAttribute('href') === '/requirements?package=pkg1')).toBe(true)
})

it('載入失敗顯示可重試的錯誤，不顯示尚無文件', async () => {
  state.db.setTable('document_processing_runs', new Error('文件服務暫時無法使用'))
  await render()
  expect(container.textContent).toContain('文件服務暫時無法使用')
  expect(container.textContent).not.toContain('這份契約尚無文件')
  const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === '重試')
  expect(retry).toBeTruthy()
  seedResult()
  await act(async () => retry.click())
  expect(container.textContent).toContain('契約.pdf')
})

it('完成但覆蓋不完整的文件顯示部分整理，不顯示已完成', async () => {
  seedResult({ metadata: { requirement_extraction: 'completed', requirement_extraction_warning: '第 2 頁文字不足' } })
  await render()
  const table = container.querySelector('table')
  expect(table.textContent).toContain('部分整理')
  expect(table.textContent).toContain('第 2 頁文字不足')
})

it('機關檢視不顯示不可用的上傳按鈕，也不寫處理狀態', async () => {
  state.store.currentUser.org_type = 'owner'; state.store.can.write = false
  seedResult()
  await render()
  expect(container.textContent).toContain('主辦機關視角')
  expect(container.querySelector('input[type="file"]')).toBeNull()
  expect(container.textContent).toContain('目前為檢視模式')
  expect(state.writes).toHaveLength(0)
})

it('契約清單超過 1000 筆仍能選到尾端契約', async () => {
  state.db.setTable('contract_packages', Array.from({ length: 1001 }, (_, i) => ({ ...pkg, id: `pkg${i}`, created_at: i })))
  await render()
  expect(state.db.requestsFor('contract_packages').some((q) => q.from === 1000)).toBe(true)
  expect(container.querySelector('option[value="pkg1000"]')).toBeTruthy()
})

it('切換專案後，舊案遲到的文件回應不覆蓋新案畫面', async () => {
  seedResult()
  const originalFrom = state.db.supabase.from
  let release
  const pending = new Promise((resolve) => { release = resolve })
  let held = false
  state.db.supabase.from = (table) => {
    const query = originalFrom(table)
    if (table === 'document_processing_runs' && !held) {
      held = true
      const originalThen = query.then
      query.then = (resolve, reject) => originalThen((result) => pending.then(() => resolve(result)), reject)
    }
    return query
  }
  await render()
  state.db.setTable('contract_packages', [{ ...pkg, id: 'pkg2', project_id: 'p2', title: '新案契約' }])
  state.db.setTable('project_parties', [{ id: 'party1', project_id: 'p2', party_type: 'contractor', display_name: '施工單位' }])
  state.db.setTable('document_processing_runs', [{ id: 'newrun', contract_package_id: 'pkg2', document_version_id: 'newv', status: 'completed' }])
  state.db.setTable('documents', [{ id: 'newdoc', title: '新案文件.pdf', contract_package_id: 'pkg2' }])
  state.db.setTable('document_versions', [{ id: 'newv', document_id: 'newdoc' }])
  state.store.currentProject = { project_id: 'p2' }
  await render()
  expect(container.textContent).toContain('新案文件.pdf')
  await act(async () => release())
  expect(container.textContent).toContain('新案文件.pdf')
  expect(container.textContent).not.toContain('契約.pdf')
})
