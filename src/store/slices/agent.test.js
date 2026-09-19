// @vitest-environment jsdom
// Agent 草稿收件匣(P6b-2):draft_daily_log／draft_inspection 由 Edge 直接寫成現場文書草稿(target=field_documents),
// 這裡只測收件匣的純函式與「接受」的順序紅線——日誌=先把人填的數量存進那份文件才標已接受;自主檢查表=不在收件匣動
// 內容(AI 建議要在文件頁逐項確認),只標已接受;舊格式(沒有文件)的草稿明確拒絕,不再由前端另湊內容或寫事實表。
import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'

import { unconfigured } from '../../testUtils/supabaseMock.js'
// 純函式不打網路;mock 掉 supabase 讓本檔在 node 環境零依賴載入
vi.mock('../../lib/supabase.js', () => unconfigured())

import { renderHook } from '../../testUtils/renderHook.js'
import { draftNeedsInputCount, checklistDraftCounts, isDocumentDraft, extractInvokeError, useAgentSlice } from './agent.js'

const items = {
  'uuid-a': { item_no: '壹.1', description: '模板', unit: 'M2', qty_today: null }, // 照片只證明有做,數量待填
  'uuid-b': { item_no: '壹.2', description: '鋼筋', unit: 'T', qty_today: 1.5 },  // 告示板清楚寫出的才帶值
}

describe('draftNeedsInputCount(收件匣卡片:還沒數量的工項數)', () => {
  it('evidence 帶值或卡片上填了正數才算有;0／空字串／非數字仍待填', () => {
    expect(draftNeedsInputCount(items)).toBe(1)
    expect(draftNeedsInputCount(items, { 'uuid-a': '30' })).toBe(0)
    expect(draftNeedsInputCount(items, { 'uuid-a': '0' })).toBe(1)
    expect(draftNeedsInputCount(items, { 'uuid-a': 'abc' })).toBe(1)
    expect(draftNeedsInputCount(null)).toBe(0)
  })
})

describe('checklistDraftCounts(自主檢查表草稿卡片統計)', () => {
  it('needsInput=實測值項數(一律人量測)、aiSuggested=附依據的 AI 建議勾選項數(false 也算)', () => {
    const list = [{ no: 'B1', kind: 'bool', suggested: true, basis: '依據' }, { no: 'B2', kind: 'bool', suggested: false, basis: '依據' }, { no: 'B3', kind: 'bool' }, { no: 'C2', kind: 'num' }]
    expect(checklistDraftCounts(list)).toEqual({ needsInput: 1, aiSuggested: 2 })
    expect(checklistDraftCounts(null)).toEqual({ needsInput: 0, aiSuggested: 0 })
  })
})

describe('isDocumentDraft(Agent 起稿是否已指向文件)', () => {
  it('target_table=field_documents 且有 target_id 才是', () => {
    expect(isDocumentDraft({ target_table: 'field_documents', target_id: 'D1' })).toBe(true)
    expect(isDocumentDraft({ target_table: 'daily_logs', target_id: null })).toBe(false)
    expect(isDocumentDraft({ target_table: 'field_documents', target_id: null })).toBe(false)
  })
})

describe('acceptDraft(順序紅線與文件目標)', () => {
  const setup = (fill) => {
    const calls = []
    const fillAgentDraftQuantities = vi.fn(async (args) => { calls.push(['fill', args]); return fill ? fill(args) : { error: null, document: { id: args.documentId }, result: { version_no: 2, recheck: [] } } })
    const h = renderHook(() => useAgentSlice({ demoMode: true, isPersistedProject: false, currentProject: null, currentUser: { user_id: 'u1' } }, { fillAgentDraftQuantities }))
    return { h, calls, fillAgentDraftQuantities }
  }
  const logDraft = { id: 'A1', kind: 'draft_daily_log', target_table: 'field_documents', target_id: 'D1', status: 'pending', evidence: { log_date: '2026-09-17', items } }
  const scDraft = { id: 'A2', kind: 'draft_inspection', target_table: 'field_documents', target_id: 'D2', status: 'pending', evidence: { items: [] } }

  it('日誌:先把人填的數量存進那份文件、成功才標已接受', async () => {
    const { h, fillAgentDraftQuantities } = setup()
    act(() => h.current.setAgentActions([logDraft]))
    let res
    await act(async () => { res = await h.current.acceptDraft(logDraft, { 'uuid-a': '12' }) })
    expect(fillAgentDraftQuantities).toHaveBeenCalledWith({ documentId: 'D1', quantities: { 'uuid-a': '12' } })
    expect(res).toMatchObject({ error: null, applied: 'daily_log', documentId: 'D1', result: { version_no: 2 } })
    expect(h.current.agentActions[0].status).toBe('accepted')
  })

  it('日誌:數量沒存成 → 回錯誤、草稿維持 pending(不讓草稿消失資料卻沒存)', async () => {
    const { h } = setup(() => ({ error: { message: '畫面載入的是版本 1,目前版本已是 2' } }))
    act(() => h.current.setAgentActions([logDraft]))
    let res
    await act(async () => { res = await h.current.acceptDraft(logDraft, { 'uuid-a': '12' }) })
    expect(res.error).toContain('目前版本已是 2')
    expect(h.current.agentActions[0].status).toBe('pending')
  })

  it('自主檢查表:不在收件匣動內容(AI 建議要逐項確認),只標已接受並回文件', async () => {
    const { h, fillAgentDraftQuantities } = setup()
    act(() => h.current.setAgentActions([scDraft]))
    let res
    await act(async () => { res = await h.current.acceptDraft(scDraft) })
    expect(fillAgentDraftQuantities).not.toHaveBeenCalled()
    expect(res).toMatchObject({ error: null, applied: 'self_check', documentId: 'D2' })
    expect(h.current.agentActions[0].status).toBe('accepted')
  })

  it('舊格式草稿(target 不是文件)明確拒絕,不寫任何東西、不標已接受', async () => {
    const { h, fillAgentDraftQuantities } = setup()
    const legacy = { id: 'A3', kind: 'draft_daily_log', target_table: 'daily_logs', target_id: null, status: 'pending', evidence: { payload: { log_date: '2026-09-17', items } } }
    act(() => h.current.setAgentActions([legacy]))
    let res
    await act(async () => { res = await h.current.acceptDraft(legacy, { 'uuid-a': '1' }) })
    expect(res.error).toContain('舊格式')
    expect(fillAgentDraftQuantities).not.toHaveBeenCalled()
    expect(h.current.agentActions[0].status).toBe('pending')
  })
})

// PR #4 review:functions.invoke 對非 2xx 只給通用訊息,伺服器的 403/503 中文
// 錯誤在 error.context body——extractInvokeError 要把它撈出來給 UI 如實顯示。
describe('extractInvokeError(非 2xx 錯誤訊息萃取)', () => {
  it('FunctionsHttpError:從 error.context 的 JSON body 取伺服器中文訊息', async () => {
    const error = { message: 'Edge Function returned a non-2xx status code',
      context: { json: async () => ({ error: '此 AI 功能未啟用(AI Agent 主控台),請聯絡系統管理者', code: 'feature_disabled' }) } }
    expect(await extractInvokeError(error, null)).toBe('此 AI 功能未啟用(AI Agent 主控台),請聯絡系統管理者')
  })

  it('503 閘門 fail-closed 的 body 同樣萃取', async () => {
    const error = { message: 'non-2xx',
      context: { json: async () => ({ error: 'AI 功能開關暫時無法確認(AI Agent 主控台),為安全起見先暫停服務,請稍後再試', code: 'gate_unavailable' }) } }
    expect(await extractInvokeError(error, null)).toContain('暫停服務')
  })

  it('body 不是 JSON(json() 拋錯)→ 退回 error.message', async () => {
    const error = { message: '網路中斷', context: { json: async () => { throw new Error('not json') } } }
    expect(await extractInvokeError(error, null)).toBe('網路中斷')
  })

  it('無 context(FunctionsFetchError)→ error.message;連 message 都沒有 → 通用訊息', async () => {
    expect(await extractInvokeError({ message: 'fetch failed' }, null)).toBe('fetch failed')
    expect(await extractInvokeError({}, null)).toBe('AI agent 暫時無法使用')
  })

  it('2xx 但 body 帶 error 欄位 → 用 data.error;都沒有 → 通用訊息', async () => {
    expect(await extractInvokeError(null, { error: 'claude 逾時' })).toBe('claude 逾時')
    expect(await extractInvokeError(null, null)).toBe('AI agent 暫時無法使用')
  })
})
