// @vitest-environment jsdom
// O2:批次候選清單的狀態要跟著文件現況走。候選列(photo_intakes.candidates)是起稿當下的快照,文件之後被捨棄
// 或被新文件取代都不會回寫(DB guard 只准使用者改 excluded),所以原本會一直標「已起稿」,而那個連結早已失效。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('./IntakeSharedInputs.jsx', () => ({ default: () => null }))
import IntakeResult from './IntakeResult.jsx'

let container, root
const intake = {
  id: 'I1', status: 'ready', log_date: '2026-09-20', photo_count: 3, recognized_count: 3, failed_count: 0,
  candidates: [{ doc_type: 'daily_log', doc_date: '2026-09-20', state: 'drafted', document_id: 'D1', reason: '已依 3 張照片起稿' }],
}

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

const render = (props) => act(async () => {
  root.render(<MemoryRouter><IntakeResult intake={intake} {...props} /></MemoryRouter>)
})
const list = () => container.querySelector('[aria-label="候選文書清單"]')

describe('候選文書狀態', () => {
  it('文件還在:標「已起稿」並給文件連結', async () => {
    await render({ documents: [{ id: 'D1', doc_type: 'daily_log', doc_date: '2026-09-20', current_version_no: 2 }] })
    expect(list().textContent).toContain('已起稿')
    expect(list().querySelector('a[href="/site-log?doc=D1"]')).not.toBeNull()
  })

  it('文件已捨棄:改標「已捨棄,可重新起稿」,不再宣稱已起稿', async () => {
    await render({ documents: [], docStatus: new Map([['D1', 'discarded']]) })
    expect(list().textContent).toContain('已捨棄,可重新起稿')
    expect(list().textContent).not.toContain('已起稿')
    expect(list().querySelector('a')).toBeNull()
  })

  it('文件已被新文件取代:標已取代', async () => {
    await render({ documents: [], docStatus: new Map([['D1', 'superseded']]) })
    expect(list().textContent).toContain('已由新文件取代')
  })

  it('狀態還沒讀到:維持「已起稿」,不把未載入誤判成已捨棄', async () => {
    await render({ documents: [], docStatus: new Map() })
    expect(list().textContent).toContain('已起稿')
  })
})
