// AI 閘門 fail-closed 判定(W3-4/D-010)。
// gatePolicy 是純函式可直接測;aiGate.ts / agent-run 有 npm: import 進不了 node,
// 改以原始碼比對釘住「閘門走 gateVerdict、沒有人偷偷改回保守放行,且 agent-run
// 自 B1 起只透過 openAiGate 進閘、不再內嵌第二份判定」
// (同 aiFeatures.test.js 讀 TS 原始碼的既有手法)。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateVerdict } from './gatePolicy.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const aiGateSrc = fs.readFileSync(path.resolve(here, './aiGate.ts'), 'utf8')
const agentRunSrc = fs.readFileSync(path.resolve(here, '../agent-run/index.ts'), 'utf8')

describe('gateVerdict:D-010 fail-closed', () => {
  it('ai_feature_allowed 查詢失敗 → 503 gate_unavailable(kill switch 在 DB 故障時仍有效)', () => {
    const v = gateVerdict('AI Agent 主控台', null, true)
    expect(v.allow).toBe(false)
    if (!v.allow) {
      expect(v.code).toBe('gate_unavailable')
      expect(v.status).toBe(503)
      expect(v.message).toContain('暫停服務')
    }
  })

  it('查詢失敗時即使 allowed=true 也擋(失敗判定優先,不信任半套結果)', () => {
    expect(gateVerdict('X', true, true).allow).toBe(false)
  })

  it('正常回 false → 403 feature_disabled(平台/方案的明確決定)', () => {
    const v = gateVerdict('AI 問答助理', false, false)
    expect(v.allow).toBe(false)
    if (!v.allow) {
      expect(v.code).toBe('feature_disabled')
      expect(v.status).toBe(403)
    }
  })

  it('恢復後正常:只有明確的 true 才放行', () => {
    expect(gateVerdict('X', true, false)).toEqual({ allow: true })
  })

  // 原本這裡斷言 null/undefined → 放行,理由寫「ai_feature_allowed 對未登記功能
  // 回 null」。2026-09-11 實查該函式對未登記 key 回的是 false,前提不成立 ——
  // 那條分支沒有任何已知觸發路徑,卻會在「RPC 說成功卻沒給答案」時放行,
  // 與 D-010 相反。收成擋下後,這支測試就是防止它被改回去的護欄。
  it('RPC 成功卻回 null/undefined:閘門沒作用,照 D-010 往擋的方向倒', () => {
    for (const v of [gateVerdict('X', null, false), gateVerdict('X', undefined, false)]) {
      expect(v.allow).toBe(false)
      if (!v.allow) {
        // 503 而非 403:我們並不知道平台是否真的關了這個功能,不能謊稱「已明確關閉」
        expect(v.code).toBe('gate_unavailable')
        expect(v.status).toBe(503)
      }
    }
  })
})

describe('閘門接線:兩個判定點都走 gateVerdict,保守放行已絕跡', () => {
  it('aiGate.ts 使用 gateVerdict 且不再保守放行', () => {
    expect(aiGateSrc).toContain("from './gatePolicy.ts'")
    expect(aiGateSrc).toContain('gateVerdict(')
    expect(aiGateSrc).not.toContain('保守放行)')
  })

  it('agent-run 改走 openAiGate(B1 / M-1):不再內嵌第二份閘門,D-010 判定只在 aiGate 一處', () => {
    expect(agentRunSrc).toContain("from '../_shared/aiGate.ts'")
    expect(agentRunSrc).toContain('openAiGate(')
    expect(agentRunSrc).not.toContain("rpc('ai_feature_allowed'")
    expect(agentRunSrc).not.toContain('gateVerdict(')
    expect(agentRunSrc).not.toContain('保守放行)')
  })

  it('全 functions 目錄沒有其他 ai_feature_allowed 判定點漏接(每個呼叫檔都 import gateVerdict)', () => {
    const dir = path.resolve(here, '..')
    const files = fs.readdirSync(dir, { recursive: true })
      .map(String).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      if (src.includes("rpc('ai_feature_allowed'")) {
        expect(src, `${f} 呼叫 ai_feature_allowed 卻沒走 gateVerdict`).toContain('gateVerdict(')
      }
    }
  })
})
