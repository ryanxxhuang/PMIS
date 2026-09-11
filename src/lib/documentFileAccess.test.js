// @vitest-environment jsdom
// 私有 bucket 的開檔/下載共用層。看起來只是包一層 storage,但它扛著一條合規硬規則:
// **讀取留痕 fail-closed** —— 工程會一覽表要求「資料存取」可歸責,留不了痕就不給檔。
// 這條規則只存在於這支 JS 的執行順序裡(先 rpc 留痕、失敗就 return),沒有任何 DB
// 護欄擋得住;有人把 logAccess 移到 download 之後、或把它的錯誤改成只記 console,
// 檔案照樣開得起來、測試全綠,但稽核紀錄就從此少了一半。
//
// 另外兩件也一起釘:彈窗被攔截要退回下載(機關電腦預設擋彈窗,不然功能等於壞的),
// 以及新分頁一定要切斷 opener(reverse tabnabbing)。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { rpcError: null, downloadResult: null, signedResult: null, rpcCalls: [], downloadCalls: [], signedCalls: [] }
  return {
    state,
    client: {
      rpc: (fn, args) => { state.rpcCalls.push({ fn, args }); return Promise.resolve({ data: null, error: state.rpcError }) },
      storage: {
        from: () => ({
          download: (path) => { state.downloadCalls.push(path); return Promise.resolve(state.downloadResult) },
          createSignedUrl: (path, ttl) => { state.signedCalls.push({ path, ttl }); return Promise.resolve(state.signedResult) },
        }),
      },
    },
  }
})
vi.mock('./supabase.js', () => ({ supabase: h.client, isSupabaseConfigured: true }))

import { downloadDocumentVersionFile, openDocumentVersionFile } from './documentFileAccess.js'

const version = (over = {}) => ({
  id: 'ver-1', storage_path: 'p1/pkg-1/doc-1/ver-1/contract.pdf', original_filename: '工程契約書.pdf',
  mime_type: 'application/pdf', ...over,
})

let anchors, opened
beforeEach(() => {
  Object.assign(h.state, {
    rpcError: null,
    downloadResult: { data: new Blob(['x']), error: null },
    signedResult: { data: { signedUrl: 'https://storage.example/signed' }, error: null },
    rpcCalls: [], downloadCalls: [], signedCalls: [],
  })
  anchors = []; opened = []
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const el = realCreate(tag)
    if (tag === 'a') { el.click = () => {}; anchors.push(el) }
    return el
  })
  vi.spyOn(window, 'open').mockImplementation(() => {
    const win = { closed: false, opener: {}, location: null, close() { this.closed = true } }
    opened.push(win)
    return win
  })
})

describe('下載:留痕失敗就不給檔(合規 fail-closed)', () => {
  it('log_document_access 失敗 → 不下載,回可讀錯誤', async () => {
    h.state.rpcError = { message: 'permission denied for function log_document_access' }
    const onError = vi.fn()
    await downloadDocumentVersionFile(version(), { onError })
    expect(h.state.downloadCalls).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).not.toContain('permission denied') // 錯誤訊息不外洩
  })

  it('留痕在下載之前發生,且帶 download 動作與版本 id', async () => {
    await downloadDocumentVersionFile(version())
    expect(h.state.rpcCalls[0]).toEqual({ fn: 'log_document_access', args: { p_document_version: 'ver-1', p_action: 'download' } })
    expect(h.state.downloadCalls).toEqual(['p1/pkg-1/doc-1/ver-1/contract.pdf'])
  })

  it('下載成功 → 用 original_filename 還原檔名(storage 的 header 會百分比編碼中文)', async () => {
    await downloadDocumentVersionFile(version())
    expect(anchors[0].download).toBe('工程契約書.pdf')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('沒有 original_filename → 退回 storage 路徑最後一段,不會變成空檔名', async () => {
    await downloadDocumentVersionFile(version({ original_filename: null }))
    expect(anchors[0].download).toBe('contract.pdf')
  })

  it('storage 下載失敗 → 回錯誤,不產生下載連結', async () => {
    h.state.downloadResult = { data: null, error: { message: 'Object not found' } }
    const onError = vi.fn()
    await downloadDocumentVersionFile(version(), { onError })
    expect(anchors).toHaveLength(0)
    expect(onError).toHaveBeenCalled()
  })

  // storage key 只收 ASCII 安全字元(storagePathFor 的前提),中文路徑一定是壞資料
  it('storage_path 不合法 → 直接退出,連留痕都不打', async () => {
    await downloadDocumentVersionFile(undefined)
    for (const bad of [null, '', 'p1/契約.pdf']) {
      await downloadDocumentVersionFile(version({ storage_path: bad }))
    }
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.downloadCalls).toHaveLength(0)
  })
})

describe('開啟:留痕失敗要連已開的分頁一起收掉', () => {
  it('可內嵌格式 → 先同步開分頁(Safari 會擋 await 之後才開的),再導向簽名 URL', async () => {
    await openDocumentVersionFile(version())
    expect(opened).toHaveLength(1)
    expect(opened[0].location).toBe('https://storage.example/signed')
    expect(h.state.signedCalls[0]).toEqual({ path: 'p1/pkg-1/doc-1/ver-1/contract.pdf', ttl: 3600 })
  })

  it('新分頁一律切斷 opener(reverse tabnabbing)', async () => {
    await openDocumentVersionFile(version())
    expect(opened[0].opener).toBeNull()
  })

  it('留痕失敗 → 關掉分頁、回錯誤,而且不去換簽名 URL', async () => {
    h.state.rpcError = { message: 'denied' }
    const onError = vi.fn()
    await openDocumentVersionFile(version(), { onError })
    expect(opened[0].closed).toBe(true)
    expect(h.state.signedCalls).toHaveLength(0)
    expect(onError).toHaveBeenCalled()
  })

  it('換簽名 URL 失敗 → 關掉分頁、回錯誤(不留一個空白分頁給使用者)', async () => {
    h.state.signedResult = { data: null, error: { message: 'not found' } }
    const onError = vi.fn()
    await openDocumentVersionFile(version(), { onError })
    expect(opened[0].closed).toBe(true)
    expect(opened[0].location).toBeNull()
    expect(onError).toHaveBeenCalled()
  })

  it('PDF 帶頁碼 → 錨點跳到出處頁(佐證鏈「開啟原文」靠這個)', async () => {
    await openDocumentVersionFile(version(), { page: 12 })
    expect(opened[0].location).toBe('https://storage.example/signed#page=12')
  })

  it('非 PDF 不加頁碼錨點(別的檢視器不吃 #page,只會變成怪網址)', async () => {
    await openDocumentVersionFile(version({ mime_type: 'image/png' }), { page: 12 })
    expect(opened[0].location).toBe('https://storage.example/signed')
  })

  it('瀏覽器不會渲染的格式(docx)→ 直接改走下載,不開分頁', async () => {
    await openDocumentVersionFile(version({ mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    expect(opened).toHaveLength(0)
    expect(h.state.downloadCalls).toHaveLength(1)
    expect(h.state.rpcCalls[0].args.p_action).toBe('download')
  })

  it('彈窗被攔截(機關電腦常見預設)→ 退回下載,功能不得等於壞掉', async () => {
    window.open.mockReturnValue(null)
    await openDocumentVersionFile(version())
    expect(h.state.downloadCalls).toHaveLength(1)
    expect(anchors[0].download).toBe('工程契約書.pdf')
  })

  it('storage_path 不合法 → 不開分頁也不留痕', async () => {
    await openDocumentVersionFile(version({ storage_path: '' }))
    expect(opened).toHaveLength(0)
    expect(h.state.rpcCalls).toHaveLength(0)
  })
})
