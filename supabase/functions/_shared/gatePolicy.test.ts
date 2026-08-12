// AI 閘門 fail-closed 判定(W3-4/D-010)。
// gatePolicy 是純函式可直接測;aiGate.ts / agent-run 有 npm: import 進不了 node,
// 改以原始碼比對釘住「兩個閘門都走 gateVerdict、沒有人偷偷改回保守放行」
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

  it('恢復後正常:allowed=true → 放行;null(未登記功能的既有行為)→ 放行', () => {
    expect(gateVerdict('X', true, false)).toEqual({ allow: true })
    expect(gateVerdict('X', null, false)).toEqual({ allow: true })
    expect(gateVerdict('X', undefined, false)).toEqual({ allow: true })
  })
})

describe('閘門接線:兩個判定點都走 gateVerdict,保守放行已絕跡', () => {
  it('aiGate.ts 使用 gateVerdict 且不再保守放行', () => {
    expect(aiGateSrc).toContain("from './gatePolicy.ts'")
    expect(aiGateSrc).toContain('gateVerdict(')
    expect(aiGateSrc).not.toContain('保守放行)')
  })

  it('agent-run 內嵌閘門使用 gateVerdict 且不再保守放行', () => {
    expect(agentRunSrc).toContain("from '../_shared/gatePolicy.ts'")
    expect(agentRunSrc).toContain('gateVerdict(')
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
