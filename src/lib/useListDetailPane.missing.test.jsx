// @vitest-environment jsdom
// 深連結指到不存在的那一筆(U11 失效連結):hook 回報 missingId、把參數從 URL 拿掉、改選預設,
// 不讓網址仍指著不存在的單據;有效深連結不回報。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useListDetailPane } from './useListDetailPane.js'

const ROWS = [{ id: 'a' }, { id: 'b' }]
let container, root
function Harness() {
  const [params] = useSearchParams()
  const pane = useListDetailPane({ param: 'sel', idPrefix: 'row-', scope: 'p1', ready: true, rows: ROWS, pickDefault: () => 'a' })
  return (
    <div>
      <output data-testid="sel">{pane.selectedId ?? ''}</output>
      <output data-testid="missing">{pane.missingId ?? ''}</output>
      <output data-testid="url">{params.get('sel') ?? ''}</output>
      {ROWS.map((r) => <div key={r.id} id={`row-${r.id}`} />)}
    </div>
  )
}
const text = (id) => container.querySelector(`[data-testid="${id}"]`).textContent
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
const render = (path) => act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>) })

describe('失效深連結', () => {
  it('?sel=zzz:回報 missingId、選預設 a、URL 參數移除', async () => {
    await render('/x?sel=zzz')
    expect(text('missing')).toBe('zzz')
    expect(text('sel')).toBe('a')
    expect(text('url')).toBe('')
  })
  it('有效深連結:不回報,選到該筆且 URL 保留', async () => {
    await render('/x?sel=b')
    expect(text('missing')).toBe('')
    expect(text('sel')).toBe('b')
    expect(text('url')).toBe('b')
  })
})
