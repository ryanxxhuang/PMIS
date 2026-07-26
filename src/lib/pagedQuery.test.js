// 分頁 helper 本身的行為契約。db.js 以外的呼叫端(store.jsx 協作三表、Requirements
// 出處、Contract/packageUpload 契約全文、site 佐證照片、projects 專案清單)都靠這層,
// 所以「抓滿」「分批」「失敗不回半份」要在這裡釘死。
import { describe, it, expect, beforeEach } from 'vitest'
import { pageAll, pageAllIn, pageAllSafe, pageAllInSafe, chunked, PAGE_SIZE, IN_CHUNK } from './pagedQuery.js'
import { createFakePostgrest, uid, makeRows } from '../testUtils/fakePostgrest.js'

const pg = createFakePostgrest()
const sb = pg.supabase

beforeEach(() => { pg.reset() })

describe('pageAllSafe', () => {
  it('超過單次上限時抓滿全部(2,750 筆分 3 頁)', async () => {
    pg.setTable('t', makeRows('r', 2750, (i) => ({ n: i })))
    const { data, error } = await pageAllSafe((from, to) => sb.from('t').select('*').order('id').range(from, to))
    expect(error).toBeNull()
    expect(data).toHaveLength(2750)
    expect(new Set(data.map((r) => r.id)).size).toBe(2750)
    expect(data[2749].n).toBe(2749) // 最後一筆真的有拿到
    expect(pg.requestsFor('t').map((r) => r.returned)).toEqual([1000, 1000, 750])
  })

  it('每頁都用 PAGE_SIZE 的區間要資料', async () => {
    pg.setTable('t', makeRows('r', 1500))
    await pageAllSafe((from, to) => sb.from('t').select('*').order('id').range(from, to))
    expect(pg.requestsFor('t').map((r) => [r.from, r.to])).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, PAGE_SIZE * 2 - 1]])
  })

  it('剛好整數頁時多抓一頁確認到底', async () => {
    pg.setTable('t', makeRows('r', 2000))
    const { data } = await pageAllSafe((from, to) => sb.from('t').select('*').order('id').range(from, to))
    expect(data).toHaveLength(2000)
    expect(pg.requestsFor('t')).toHaveLength(3)
  })

  it('查詢失敗回 { data: null } 而非半份資料', async () => {
    pg.setTable('t', new Error('boom'))
    const { data, error } = await pageAllSafe((from, to) => sb.from('t').select('*').order('id').range(from, to))
    expect(data).toBeNull()
    expect(error.message).toBe('boom')
  })
})

describe('pageAllInSafe', () => {
  it('父層 id 分批進 .in(),每批都不超過 IN_CHUNK', async () => {
    const parents = Array.from({ length: 450 }, (_, i) => uid('p', i))
    pg.setTable('child', parents.map((pid, i) => ({ id: uid('c', i), parent_id: pid })))
    const { data } = await pageAllInSafe(parents, (chunk, from, to) =>
      sb.from('child').select('*').in('parent_id', chunk).order('id').range(from, to))
    expect(data).toHaveLength(450)
    const reqs = pg.requestsFor('child')
    expect(reqs).toHaveLength(5) // ceil(450 / 100)
    expect(Math.max(...reqs.map((r) => r.inSize))).toBeLessThanOrEqual(IN_CHUNK)
  })

  it('單一批內超過單次上限時也會分頁(100 個父層 × 30 筆子列 = 3,000)', async () => {
    const parents = Array.from({ length: 100 }, (_, i) => uid('p', i))
    const children = []
    for (let p = 0; p < 100; p++) {
      for (let c = 0; c < 30; c++) children.push({ id: uid(`c${p}`, c), parent_id: uid('p', p) })
    }
    pg.setTable('child', children)
    const { data } = await pageAllInSafe(parents, (chunk, from, to) =>
      sb.from('child').select('*').in('parent_id', chunk).order('id').range(from, to))
    expect(data).toHaveLength(3000)
    expect(pg.requestsFor('child')).toHaveLength(4) // 一批父層、四頁
  })

  it('空 id 清單不送任何請求', async () => {
    const { data } = await pageAllInSafe([], (chunk, from, to) =>
      sb.from('child').select('*').in('parent_id', chunk).range(from, to))
    expect(data).toEqual([])
    expect(pg.requestsFor('child')).toHaveLength(0)
  })

  it('任一批失敗就回 { data: null }', async () => {
    pg.setTable('child', new Error('rls'))
    const { data, error } = await pageAllInSafe(['a'], (chunk, from, to) =>
      sb.from('child').select('*').in('parent_id', chunk).range(from, to))
    expect(data).toBeNull()
    expect(error.message).toBe('rls')
  })
})

describe('會拋的版本', () => {
  it('pageAll 成功時直接回陣列', async () => {
    pg.setTable('t', makeRows('r', 1200))
    expect(await pageAll((from, to) => sb.from('t').select('*').order('id').range(from, to), '測試')).toHaveLength(1200)
  })

  it('pageAll / pageAllIn 失敗時拋出帶標籤的錯誤', async () => {
    pg.setTable('t', new Error('permission denied'))
    await expect(pageAll((from, to) => sb.from('t').select('*').range(from, to), '估驗'))
      .rejects.toThrow('估驗讀取失敗:permission denied')
    await expect(pageAllIn(['a'], (chunk, from, to) => sb.from('t').select('*').in('x', chunk).range(from, to), '日誌明細'))
      .rejects.toThrow('日誌明細讀取失敗:permission denied')
  })
})

describe('chunked', () => {
  it('依 IN_CHUNK 切批,不漏元素', () => {
    const list = Array.from({ length: 250 }, (_, i) => i)
    const batches = chunked(list)
    expect(batches).toHaveLength(3)
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50])
    expect(batches.flat()).toEqual(list)
  })

  it('空清單回空批次', () => { expect(chunked([])).toEqual([]) })
})
