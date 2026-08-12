// AI 功能註冊表同步測試:釘住「前端 JS 版」與「edge functions TS 版」的值域。
// Deno edge function 無法 import 專案其他路徑,兩份註冊表是刻意的重複
// (同 agentRole.js / _shared/agentRole.ts 慣例)——這支測試以讀取 TS 原始碼
// 逐欄比對的方式讓「值域漂移」直接紅燈,取代做不到的共用 import。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_FEATURES, AI_FEATURE_KEYS, featureByKey, PLAN_RANK } from './aiFeatures.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.resolve(here, '../../supabase/functions/_shared/aiFeatures.ts')
const functionsDir = path.resolve(here, '../../supabase/functions')
const tsSource = fs.readFileSync(tsPath, 'utf8')

// TS 版一列一筆的物件字面量,逐筆抽出欄位(格式是契約:改排版會讓這裡解析失敗=紅燈)
function parseTsFeatures(src) {
  const entries = []
  const re = /\{ key: '([^']+)', label: '([^']+)', category: '([^']+)', edgeFunction: '([^']+)', minPlan: '([^']+)', isLlm: (true|false), defaultEnabled: (true|false) \}/g
  let m
  while ((m = re.exec(src)) !== null) {
    entries.push({
      key: m[1], label: m[2], category: m[3], edgeFunction: m[4],
      minPlan: m[5], isLlm: m[6] === 'true', defaultEnabled: m[7] === 'true',
    })
  }
  return entries
}

describe('aiFeatures 前後端註冊表同步', () => {
  const tsFeatures = parseTsFeatures(tsSource)

  it('兩邊都是 16 個功能', () => {
    expect(AI_FEATURES).toHaveLength(16)
    expect(tsFeatures).toHaveLength(16)
    expect(AI_FEATURE_KEYS).toHaveLength(16)
  })

  it('key 集合與順序完全一致', () => {
    expect(tsFeatures.map((f) => f.key)).toEqual(AI_FEATURE_KEYS)
  })

  it('每個 key 的全部欄位(label/category/edgeFunction/minPlan/isLlm/defaultEnabled)一致', () => {
    for (const tsF of tsFeatures) {
      const jsF = featureByKey[tsF.key]
      expect(jsF, `JS 版缺少 key: ${tsF.key}`).toBeTruthy()
      expect(tsF, `key ${tsF.key} 兩邊欄位不一致`).toEqual(jsF)
    }
  })

  it('PLAN_RANK 階序:trial(0) < standard(1) < pro(2),TS 版同值', () => {
    expect(PLAN_RANK).toEqual({ trial: 0, standard: 1, pro: 2 })
    expect(tsSource).toMatch(/PLAN_RANK[^=]*=\s*\{ trial: 0, standard: 1, pro: 2 \}/)
  })

  it('minPlan 只能是 trial/standard/pro;非 LLM 功能只有 weather.fetch 與 reminder.daily', () => {
    // send-reminders 檔頭明載「內容一律確定性產生,絕不呼叫 LLM」——
    // isLlm=false 但仍是可開關、需計次的模組(用量照記,token/cost 為 0)
    for (const f of AI_FEATURES) {
      expect(Object.keys(PLAN_RANK)).toContain(f.minPlan)
    }
    expect(AI_FEATURES.filter((f) => !f.isLlm).map((f) => f.key))
      .toEqual(['weather.fetch', 'reminder.daily'])
  })

  it('defaultEnabled:僅退場的 assistant.chat 為 false,其餘為 true(W3-3/D-008)', () => {
    for (const f of AI_FEATURES) expect(f.defaultEnabled, f.key).toBe(f.key !== 'assistant.chat')
  })

  it('每個 edgeFunction 目錄確實存在於 supabase/functions/', () => {
    for (const f of AI_FEATURES) {
      const dir = path.join(functionsDir, f.edgeFunction)
      expect(fs.existsSync(dir), `缺少 edge function 目錄: ${f.edgeFunction}`).toBe(true)
      expect(fs.statSync(dir).isDirectory(), `${f.edgeFunction} 不是目錄`).toBe(true)
    }
  })

  it('key 不重複、edgeFunction 不重複', () => {
    expect(new Set(AI_FEATURE_KEYS).size).toBe(16)
    expect(new Set(AI_FEATURES.map((f) => f.edgeFunction)).size).toBe(16)
  })
})
