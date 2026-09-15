// @vitest-environment jsdom
// 清單篩選進 URL 的共用 hook(U11):寫入非預設值、等於預設就刪、函式型更新讀當下值、由 URL 回填。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { useUrlFilters } from './useUrlFilters.js'

const DEFAULTS = { q: '', ball: '' }
let container, root, api
function Harness() {
  const [filters, setFilters] = useUrlFilters(DEFAULTS)
  const { search } = useLocation()
  api = { filters, setFilters }
  return <output data-testid="url">{search}</output>
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
const url = () => new URLSearchParams(container.querySelector('[data-testid="url"]').textContent)
const render = (path = '/x') => act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>) })

describe('useUrlFilters', () => {
  it('寫入、函式型更新、等於預設就刪、其他參數不動', async () => {
    await render('/x?submittal=S1')
    expect(api.filters).toEqual(DEFAULTS)
    await act(async () => api.setFilters({ q: '磚', ball: 'mine' }))
    expect(url().get('q')).toBe('磚'); expect(url().get('ball')).toBe('mine'); expect(url().get('submittal')).toBe('S1')
    expect(api.filters).toEqual({ q: '磚', ball: 'mine' })
    await act(async () => api.setFilters((f) => ({ ...f, ball: '' })))
    expect(url().get('ball')).toBeNull(); expect(url().get('q')).toBe('磚')
    await act(async () => api.setFilters(DEFAULTS))
    expect(url().toString()).toBe('submittal=S1')
  })
  it('由 URL 回填', async () => {
    await render('/x?q=%E7%A3%9A&ball=done')
    expect(api.filters).toEqual({ q: '磚', ball: 'done' })
  })
})
