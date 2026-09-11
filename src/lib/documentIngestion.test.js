// P0-06/W13 的上傳編排入口:上傳 → documents → 不可變 document_versions → 逐頁
// document_pages → 交棒給 extract-requirements。這條路徑一旦走歪,佐證鏈的
// 「引用頁碼可回溯」就斷了(D-017 的整個前提),而它沒有任何 DB 端護欄——
// 版本策略(同 checksum 重用、內容變更才開新版並 supersedes 舊版)全在這支檔案裡。
//
// 特別釘住三件容易在重構時消失的事:
// 1. 失敗一律「先擋住、不往下走」——掃描檔/建檔失敗/頁寫入失敗都不可以繼續呼叫
//    Edge Function(呼叫了就會產生一個沒有頁可對照的 ingestion run,引用驗不過)。
// 2. 同內容重上傳不開新版(不可變版本被灌水,審查頁會看到一堆假版次)。
// 3. 上一次寫到一半(有 version、沒有 pages)要能自癒補頁,而不是永遠卡住。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const calls = []
  // 由測試設定的假資料庫;respond 依 table + 鏈上的動作回結果
  const db = {
    existingDoc: null,          // documents 查詢命中的既有文件
    versions: [],               // document_versions 由新到舊
    pageCount: 0,               // 既有 document_pages 筆數(head count)
    newDocId: 'doc-new',
    newVersionId: 'ver-new',
    fail: {},                   // { docFind, docInsert, versionsSelect, versionInsert, pageInsert }
  }
  const respond = ({ table, ops }) => {
    const did = (op) => ops.some((o) => o.op === op)
    if (table === 'documents') {
      if (did('insert')) return { data: { id: db.newDocId }, error: db.fail.docInsert || null }
      return { data: db.existingDoc, error: db.fail.docFind || null }
    }
    if (table === 'document_versions') {
      if (did('insert')) return { data: { id: db.newVersionId }, error: db.fail.versionInsert || null }
      return { data: db.versions, error: db.fail.versionsSelect || null }
    }
    if (table === 'document_pages') {
      if (did('insert')) return { data: null, error: db.fail.pageInsert || null }
      return { count: db.pageCount, data: null, error: null }
    }
    return { data: null, error: null }
  }
  const client = {
    from: (table) => {
      const ops = []
      const api = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') {
            const p = Promise.resolve(respond({ table, ops }))
            return p.then.bind(p)
          }
          return (...args) => { ops.push({ op: prop, args }); calls.push({ table, op: prop, args }); return api }
        },
      })
      return api
    },
  }
  return { calls, db, client }
})
vi.mock('./supabase.js', () => ({ supabase: h.client, isSupabaseConfigured: true }))
vi.mock('./documentExtract.js', () => ({
  extractDocumentPages: vi.fn(),
  hasExtractableText: (pages) => pages.some((p) => (p.text_content || '').length >= 20),
}))
vi.mock('./extractRequirements.js', () => ({ runRequirementExtraction: vi.fn() }))

import { ingestRequirementDocument } from './documentIngestion.js'
import { extractDocumentPages } from './documentExtract.js'
import { runRequirementExtraction } from './extractRequirements.js'

const makePages = (n) => Array.from({ length: n }, (_, i) => ({
  page_number: i + 1, text_content: `第 ${i + 1} 頁契約條文內容,長度足夠通過可抽取判定。`,
  extraction_method: 'pdf_text',
}))
const buffer = () => new TextEncoder().encode('契約 PDF 位元組').buffer
const file = (name = '工程契約.pdf') => ({ name, type: 'application/pdf', size: 12345 })

const call = (over = {}) => ingestRequirementDocument({
  projectId: 'p1', userId: 'u1', file: file(), documentType: 'contract', ...over,
})
const of = (table, op) => h.calls.filter((c) => c.table === table && c.op === op)

beforeEach(() => {
  h.calls.length = 0
  Object.assign(h.db, { existingDoc: null, versions: [], pageCount: 0, newDocId: 'doc-new', newVersionId: 'ver-new', fail: {} })
  extractDocumentPages.mockReset()
  extractDocumentPages.mockResolvedValue({ pages: makePages(3), buffer: buffer() })
  runRequirementExtraction.mockReset()
  runRequirementExtraction.mockResolvedValue({ ok: true, data: { run_id: 'run-1', status: 'succeeded' } })
})

describe('前置檢查:擋不住就會產出「沒有頁可對照」的抽取 run', () => {
  it('讀檔失敗 → 回錯誤訊息,完全不碰 DB、不呼叫 Edge Function', async () => {
    extractDocumentPages.mockRejectedValue(new Error('PDF 毀損'))
    const res = await call()
    expect(res.error.message).toBe('PDF 毀損')
    expect(h.calls).toHaveLength(0)
    expect(runRequirementExtraction).not.toHaveBeenCalled()
  })

  it('讀檔丟出無訊息的例外 → 給得出可讀訊息,不是 undefined', async () => {
    extractDocumentPages.mockRejectedValue({})
    expect((await call()).error.message).toBe('讀取文件失敗')
  })

  it('掃描檔(抽不出文字)→ 明講 P0-06 不含 OCR,不建任何文件列', async () => {
    extractDocumentPages.mockResolvedValue({ pages: [{ page_number: 1, text_content: '' }], buffer: buffer() })
    const res = await call()
    expect(res.error.message).toContain('OCR')
    expect(h.calls).toHaveLength(0)
  })

  it('零頁 → 同樣擋下(不可用空文件開 run)', async () => {
    extractDocumentPages.mockResolvedValue({ pages: [], buffer: buffer() })
    expect((await call()).error).toBeTruthy()
    expect(h.calls).toHaveLength(0)
  })
})

describe('首次上傳:建文件 → 建 v1 → 寫頁 → 交棒抽取', () => {
  it('documents 不存在就新建,並以 project/type/title 三鍵查既有文件', async () => {
    const res = await call()
    expect(res.error).toBeNull()
    const eqs = h.calls.filter((c) => c.table === 'documents' && c.op === 'eq').map((c) => c.args[0])
    expect(eqs).toEqual(['project_id', 'document_type', 'title'])
    expect(of('documents', 'insert')[0].args[0]).toMatchObject({
      project_id: 'p1', title: '工程契約.pdf', document_type: 'contract', created_by: 'u1',
    })
    expect(res.document_id).toBe('doc-new')
  })

  it('第一版:v1 / revision 0 / supersedes null,checksum 帶 sha256: 前綴', async () => {
    await call()
    const row = of('document_versions', 'insert')[0].args[0]
    expect(row).toMatchObject({
      document_id: 'doc-new', version_label: 'v1', revision_number: 0,
      supersedes_version_id: null, original_filename: '工程契約.pdf',
      mime_type: 'application/pdf', file_size: 12345, uploaded_by: 'u1',
    })
    expect(row.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('逐頁寫入並掛上 document_version_id(頁掛錯版=引用永遠驗不過)', async () => {
    await call()
    const batch = of('document_pages', 'insert')[0].args[0]
    expect(batch).toHaveLength(3)
    expect(batch.every((p) => p.document_version_id === 'ver-new')).toBe(true)
    expect(batch[0].page_number).toBe(1)
  })

  it('成功後帶著 run 與 version id 回傳(審查頁靠這兩個接著追進度)', async () => {
    const res = await call()
    expect(runRequirementExtraction).toHaveBeenCalledWith({ documentVersionId: 'ver-new', projectId: 'p1' })
    expect(res).toMatchObject({ error: null, document_version_id: 'ver-new', document_id: 'doc-new' })
    expect(res.run).toEqual({ run_id: 'run-1', status: 'succeeded' })
  })

  it('未登入(userId 空)→ created_by/uploaded_by 寫 null,不寫 undefined', async () => {
    await call({ userId: null })
    expect(of('documents', 'insert')[0].args[0].created_by).toBeNull()
    expect(of('document_versions', 'insert')[0].args[0].uploaded_by).toBeNull()
  })

  it('無檔名 → 標題落「未命名文件」(title 是查既有文件的鍵,不可為 undefined)', async () => {
    await ingestRequirementDocument({ projectId: 'p1', userId: 'u1', file: { type: '', size: 1 } })
    expect(of('documents', 'insert')[0].args[0].title).toBe('未命名文件')
  })

  it('頁數超過批次上限 → 分批 insert(單批過大會被 PostgREST 打回)', async () => {
    extractDocumentPages.mockResolvedValue({ pages: makePages(450), buffer: buffer() })
    await call()
    const batches = of('document_pages', 'insert').map((c) => c.args[0].length)
    expect(batches).toEqual([200, 200, 50])
  })
})

describe('重複上傳:版本策略(不可變版本不得被灌水)', () => {
  // 兩次呼叫同一份內容 → 第二次要能在既有版本清單裡認出同 checksum
  const checksumOfCall = async () => {
    await call()
    return of('document_versions', 'insert')[0].args[0].checksum
  }

  it('同檔名同內容 → 重用既有版本,不新增版本、不重寫頁', async () => {
    const checksum = await checksumOfCall()
    h.calls.length = 0
    h.db.existingDoc = { id: 'doc-1' }
    h.db.versions = [{ id: 'ver-1', version_label: 'v1', checksum }]
    h.db.pageCount = 3
    const res = await call()
    expect(of('documents', 'insert')).toHaveLength(0)
    expect(of('document_versions', 'insert')).toHaveLength(0)
    expect(of('document_pages', 'insert')).toHaveLength(0)
    expect(res.document_version_id).toBe('ver-1')
    expect(runRequirementExtraction).toHaveBeenCalledWith({ documentVersionId: 'ver-1', projectId: 'p1' })
  })

  it('同 checksum 但頁是空的(上次寫到一半)→ 自癒補頁,仍不開新版', async () => {
    const checksum = await checksumOfCall()
    h.calls.length = 0
    h.db.existingDoc = { id: 'doc-1' }
    h.db.versions = [{ id: 'ver-1', checksum }]
    h.db.pageCount = 0
    const res = await call()
    expect(of('document_versions', 'insert')).toHaveLength(0)
    expect(of('document_pages', 'insert')[0].args[0][0].document_version_id).toBe('ver-1')
    expect(res.error).toBeNull()
  })

  it('內容變更 → 開新版 v3、revision 2,並 supersedes 最新一版(鏈不可斷)', async () => {
    h.db.existingDoc = { id: 'doc-1' }
    h.db.versions = [
      { id: 'ver-2', version_label: 'v2', checksum: 'sha256:old2' },
      { id: 'ver-1', version_label: 'v1', checksum: 'sha256:old1' },
    ]
    await call()
    expect(of('document_versions', 'insert')[0].args[0]).toMatchObject({
      document_id: 'doc-1', version_label: 'v3', revision_number: 2, supersedes_version_id: 'ver-2',
    })
  })

  it('版本查詢依 uploaded_at 由新到舊排序(順序反了會 supersedes 到最舊那版)', async () => {
    await call()
    const order = h.calls.find((c) => c.table === 'document_versions' && c.op === 'order')
    expect(order.args).toEqual(['uploaded_at', { ascending: false }])
  })
})

describe('錯誤路徑:任何一步失敗都要在原地停住', () => {
  it('查既有文件失敗 → 原樣回傳 DB 錯誤,不建文件', async () => {
    h.db.fail.docFind = { message: 'permission denied for table documents' }
    const res = await call()
    expect(res.error.message).toContain('permission denied')
    expect(of('documents', 'insert')).toHaveLength(0)
  })

  it('建文件失敗 → 不往下建版本', async () => {
    h.db.fail.docInsert = { message: 'new row violates row-level security policy' }
    expect((await call()).error).toEqual(h.db.fail.docInsert)
    expect(of('document_versions', 'insert')).toHaveLength(0)
  })

  it('讀版本清單失敗 → 不建新版(否則版號會從 v1 重來,覆蓋既有鏈)', async () => {
    h.db.fail.versionsSelect = { message: 'timeout' }
    expect((await call()).error.message).toBe('timeout')
    expect(of('document_versions', 'insert')).toHaveLength(0)
  })

  it('建版本失敗 → 不寫頁、不呼叫 Edge Function', async () => {
    h.db.fail.versionInsert = { message: 'duplicate key value violates unique constraint' }
    expect((await call()).error).toEqual(h.db.fail.versionInsert)
    expect(of('document_pages', 'insert')).toHaveLength(0)
    expect(runRequirementExtraction).not.toHaveBeenCalled()
  })

  it('寫頁失敗 → 立刻回報且不抽取(有版本沒有頁時引用一定驗不過)', async () => {
    h.db.fail.pageInsert = { message: 'payload too large' }
    expect((await call()).error).toEqual(h.db.fail.pageInsert)
    expect(runRequirementExtraction).not.toHaveBeenCalled()
  })

  it('寫頁在第二批失敗 → 不再送剩下的批次', async () => {
    extractDocumentPages.mockResolvedValue({ pages: makePages(450), buffer: buffer() })
    let n = 0
    Object.defineProperty(h.db.fail, 'pageInsert', { configurable: true, get: () => (++n >= 2 ? { message: 'boom' } : null) })
    await call()
    expect(of('document_pages', 'insert')).toHaveLength(2)
    delete h.db.fail.pageInsert
  })

  it('抽取接力回 !ok → 轉成可讀 error,不謊報成功', async () => {
    runRequirementExtraction.mockResolvedValue({ ok: false, message: 'AI 服務暫時無法使用' })
    const res = await call()
    expect(res.error).toEqual({ message: 'AI 服務暫時無法使用' })
    expect(res.run).toBeUndefined()
  })
})
