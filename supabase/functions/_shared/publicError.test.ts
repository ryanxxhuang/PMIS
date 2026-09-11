// 對外錯誤遮罩(B1 / H-1、H-2、M-9):釘住「原文不出現在回傳值、只進 console.error」。
// 三類來源各測:Claude 上游、PostgREST、未預期例外;另釘訊息格式不得含冒號
//(前端 friendlyError 會把「中文:非中文尾巴」截尾,代碼就到不了使用者)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  claudeErrorMessage, maskClaudeError, maskDbError, maskException, isOwnMessage,
} from './publicError.ts'

const RAW_CLAUDE = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CSECRET"}'
const RAW_PG = { code: '42501', message: 'new row violates row-level security policy "requirements_write_reviewer" for table "requirements"', details: 'Failing row contains (…)', hint: 'check policy' }

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

const logged = () => errSpy.mock.calls.flat().map(String).join('\n')

describe('maskClaudeError:Claude 上游回應本文不外洩', () => {
  it('529 過載:短語含代碼 http_529,不含 request_id / 原文;原文進 log', () => {
    const pub = maskClaudeError('safety_hazard', 'http_529', RAW_CLAUDE)
    expect(pub.code).toBe('http_529')
    expect(pub.message).toContain('http_529')
    expect(pub.message).not.toContain('req_011CSECRET')
    expect(pub.message).not.toContain('Overloaded')
    expect(logged()).toContain('req_011CSECRET')
    expect(logged()).toContain('safety_hazard')
  })

  it('分類碼 → 處置建議:429 忙碌、5xx 暫停、4xx 找管理者、timeout 縮小輸入', () => {
    expect(claudeErrorMessage('http_429')).toContain('忙碌')
    expect(claudeErrorMessage('http_500')).toContain('暫時無法使用')
    expect(claudeErrorMessage('http_529')).toContain('暫時無法使用')
    expect(claudeErrorMessage('http_400')).toContain('系統管理者')
    expect(claudeErrorMessage('http_401')).toContain('系統管理者')
    expect(claudeErrorMessage('timeout')).toContain('逾時')
    expect(claudeErrorMessage('network')).toContain('連線')
    expect(claudeErrorMessage('max_tokens')).toContain('長度上限')
    expect(claudeErrorMessage('no_tool_use')).toContain('結構化')
    expect(claudeErrorMessage('config')).toContain('尚未完成設定')
    expect(claudeErrorMessage('whatever')).toContain('發生錯誤')
  })

  it('config 缺金鑰:訊息不透露環境變數名', () => {
    const pub = maskClaudeError('t', 'config', '未設定 ANTHROPIC_API_KEY')
    expect(pub.message).not.toContain('ANTHROPIC')
    expect(pub.message).toContain('config')
  })
})

describe('maskDbError:PostgREST policy / constraint 名不外洩', () => {
  it('RLS 42501:短語＋db_error,policy 名與 table 名只進 log', () => {
    const pub = maskDbError('extract-requirements.persist', RAW_PG)
    expect(pub.code).toBe('db_error')
    expect(pub.message).toContain('db_error')
    expect(pub.message).not.toContain('requirements_write_reviewer')
    expect(pub.message).not.toContain('row-level security')
    expect(pub.message).not.toContain('42501')
    expect(logged()).toContain('requirements_write_reviewer')
    expect(logged()).toContain('42501')
  })

  it('unique 23505:constraint 名不外洩', () => {
    const pub = maskDbError('x', { code: '23505', message: 'duplicate key value violates unique constraint "document_ingestion_runs_active_uniq"' })
    expect(pub.message).not.toContain('document_ingestion_runs_active_uniq')
    expect(pub.code).toBe('db_error')
  })

  it('P0001 且為繁中(我們自己的 DB 觸發器業務規則)→ 原樣放行,與前端 friendlyError 同判準', () => {
    const pub = maskDbError('x', { code: 'P0001', message: '已核定的契約重點不可再修改' })
    expect(pub).toEqual({ message: '已核定的契約重點不可再修改', code: 'P0001' })
  })

  it('P0001 但訊息是英文(非我們寫的)→ 照遮', () => {
    const pub = maskDbError('x', { code: 'P0001', message: 'internal assertion failed: fn_guard_xyz' })
    expect(pub.message).not.toContain('fn_guard_xyz')
    expect(pub.code).toBe('db_error')
  })

  it('null / undefined 也能安全遮罩', () => {
    expect(maskDbError('x', null).code).toBe('db_error')
    expect(maskDbError('x', undefined).code).toBe('db_error')
  })
})

describe('maskException:未預期例外', () => {
  it('runtime 英文例外 → 短語＋internal,原文與 stack 只進 log', () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'secretField')")
    const pub = maskException('agent-run', e)
    expect(pub.code).toBe('internal')
    expect(pub.message).toContain('internal')
    expect(pub.message).not.toContain('secretField')
    expect(logged()).toContain('secretField')
    expect(logged()).toContain('TypeError')
  })

  it('程式刻意 throw 的繁中 Error(給使用者的業務訊息)→ 原樣放行', () => {
    const pub = maskException('extract-requirements', new Error('文件頁面仍在更新，請完成上傳後重試'))
    expect(pub).toEqual({ message: '文件頁面仍在更新，請完成上傳後重試', code: 'business_rule' })
  })

  it('非 Error 值(字串 / 物件 / undefined)也能遮', () => {
    expect(maskException('x', 'boom secret').message).not.toContain('secret')
    expect(maskException('x', { foo: 'bar' }).code).toBe('internal')
    expect(maskException('x', undefined).code).toBe('internal')
  })
})

describe('訊息格式:純中文短語＋全形括號代碼,不含冒號', () => {
  // 在 it 內才建樣本,console.error spy 已裝上,collect 階段不會把原文印進測試輸出
  const samples = () => [
    maskClaudeError('s', 'http_529', RAW_CLAUDE),
    maskClaudeError('s', 'timeout', 'x'),
    maskClaudeError('s', 'network', 'ECONNRESET'),
    maskClaudeError('s', 'config', 'x'),
    maskClaudeError('s', 'max_tokens', 'x'),
    maskClaudeError('s', 'no_tool_use', 'x'),
    maskClaudeError('s', 'http_400', 'x'),
    maskDbError('s', RAW_PG),
    maskException('s', new Error('boom')),
  ]
  it('每則都含 CJK(前端 friendlyError 才會原樣放行)且含代碼', () => {
    for (const pub of samples()) {
      expect(isOwnMessage(pub.message), pub.message).toBe(true)
      expect(pub.message, pub.message).toContain(`（代碼 ${pub.code}）`)
    }
  })
  it('沒有半形或全形冒號(friendlyError 會把「中文:非中文尾巴」截尾)', () => {
    for (const pub of samples()) expect(pub.message, pub.message).not.toMatch(/[:：]/)
  })
})

describe('isOwnMessage:與前端 errorMessage.js 同一條 CJK 判準', () => {
  it('含中日韓表意文字 → true;純 ASCII / 非字串 → false', () => {
    expect(isOwnMessage('找不到專案或無權限')).toBe(true)
    expect(isOwnMessage('permission denied for table projects')).toBe(false)
    expect(isOwnMessage(null)).toBe(false)
    expect(isOwnMessage(42)).toBe(false)
  })
})
