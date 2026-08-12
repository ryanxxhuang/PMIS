// @vitest-environment jsdom
// PR #4 review 釘住:fail-closed 的前端半邊——error 必須如實顯示,
// 只有 fallback(demo/未設 Supabase)才允許離線快答。若 error 被轉成快答,
// 伺服器端的 403 功能停用/503 閘門故障會被前端靜默吃掉,kill switch 形同失效。
import { describe, it, expect, vi } from 'vitest'
import { replyMessage } from './CopilotChat.jsx'

const det = () => ({ role: 'ai', text: '快答內容', sources: [], mode: 'basic' })

describe('replyMessage:error/fallback 分流', () => {
  it('answer → AI 回答(mode ai,steps 轉成模組名)', () => {
    const m = replyMessage({ answer: '本期估驗 120 萬', steps: [{ tool: 'get_valuation', ok: true }] }, det)
    expect(m.mode).toBe('ai')
    expect(m.text).toBe('本期估驗 120 萬')
    expect(m.steps).toEqual(['估驗計價'])
  })

  it('error(字串)→ 如實顯示錯誤,絕不走離線快答', () => {
    const deterministic = vi.fn(det)
    const m = replyMessage({ error: '此 AI 功能未啟用(AI Agent 主控台),請聯絡系統管理者' }, deterministic)
    expect(m.mode).toBe('error')
    expect(m.text).toBe('此 AI 功能未啟用(AI Agent 主控台),請聯絡系統管理者')
    expect(deterministic).not.toHaveBeenCalled()
  })

  it('error(503 閘門 fail-closed 訊息)→ 原樣顯示', () => {
    const m = replyMessage({ error: 'AI 功能開關暫時無法確認(AI Agent 主控台),為安全起見先暫停服務,請稍後再試' }, det)
    expect(m.mode).toBe('error')
    expect(m.text).toContain('暫停服務')
  })

  it('error({ message })物件形狀也相容', () => {
    const m = replyMessage({ error: { message: '未登入' } }, det)
    expect(m.mode).toBe('error')
    expect(m.text).toBe('未登入')
  })

  it('fallback(demo/未設 Supabase)→ 才走確定性離線快答', () => {
    const m = replyMessage({ fallback: true }, det)
    expect(m.mode).toBe('basic')
    expect(m.text).toBe('快答內容')
  })
})
