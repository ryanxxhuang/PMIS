import { expect, it, vi } from 'vitest'
import { getRecord, getValuation } from './agentQueryTools.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

function queryClient(data: unknown) {
  const q = {
    select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(() => q),
    maybeSingle: vi.fn(() => q), returns: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  }
  const from = vi.fn(() => q)
  return { db: { from } as unknown as SupabaseClient, q, from }
}
const id = '11111111-1111-4111-8111-111111111111'
it('單筆記錄只接受白名單,不把原型鏈名稱當表名', async () => {
  const { db, from } = queryClient(null)
  for (const table of ['toString', '__proto__', 'cost_items']) {
    expect(await getRecord(db, 'p1', { table, id })).toHaveProperty('error')
  }
  expect(from).not.toHaveBeenCalled()
})
it('估驗單筆保留 project/id 條件,並限制嵌入明細避免過量模型輸入', async () => {
  const { db, q } = queryClient({ id, valuation_items: Array.from({ length: 201 }, (_, i) => ({ i })) })
  const result = await getRecord(db, 'p1', { table: 'valuations', id })
  expect(q.eq.mock.calls).toEqual([['id', id], ['project_id', 'p1']])
  expect(result.record?.valuation_items).toHaveLength(200)
  expect(result.record).toHaveProperty('valuation_items_note')
})
it('未指定估驗期時僅取本案最新一期', async () => {
  const { db, q } = queryClient([{ id, valuation_items: [] }])
  const result = await getValuation(db, 'p1', {})
  expect(q.eq).toHaveBeenCalledWith('project_id', 'p1')
  expect(q.order).toHaveBeenCalledWith('period_no', { ascending: false })
  expect(q.limit).toHaveBeenCalledWith(1)
  expect(result.valuation?.id).toBe(id)
})
