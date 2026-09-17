// @vitest-environment jsdom
// 入口方案 B(2026-09-15):PageTabs 只在側欄提供不了同組子頁導航時渲染。
// - 側欄正列出這一組(context 值＝所屬群組 to)→ 不畫分頁列(不重複導覽,D-015);
// - 側欄列的是別組、或沒有列(null:icon rail/平板/手機抽屜/手動收合/不在 Layout 底下)→ 照畫,
//   而且每個同組子頁都是可點的連結(入口不消失)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('../store.jsx', () => ({ useStore: () => ({ currentUser: { org_type: 'supervisor' }, can: {}, isPlatformAdmin: false }) }))
import PageTabs from './PageTabs.jsx'
import { SidebarNavContext } from '../lib/sidebarNav.js'

let container, root
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
const render = (sidebarTabsFor) => act(async () => {
  root.render(
    <MemoryRouter initialEntries={['/submittals']}>
      <SidebarNavContext.Provider value={sidebarTabsFor}><PageTabs /></SidebarNavContext.Provider>
    </MemoryRouter>,
  )
})
const tabsNav = () => container.querySelector('nav[aria-label="文件往來分頁"]')

describe('PageTabs 與側欄的分工', () => {
  it('側欄正列出「文件往來」子頁時不渲染分頁列', async () => {
    await render('/submittals')
    expect(tabsNav()).toBeNull()
  })

  it('側欄沒有列子頁(null)時渲染分頁列,同組子頁(監造含監造月報)都是連結', async () => {
    await render(null)
    const nav = tabsNav()
    expect(nav).toBeTruthy()
    const names = [...nav.querySelectorAll('a')].map((a) => a.textContent.trim())
    expect(names).toEqual(['送審文件', '工程疑義', '施工月報', '監造月報'])
    expect(nav.querySelector('a[aria-current="page"]').textContent.trim()).toBe('送審文件')
  })

  it('側欄列的是別組子頁時,本頁分頁列照畫', async () => {
    await render('/site-log')
    expect(tabsNav()).toBeTruthy()
  })
})
