// functions/ 錯誤外洩凍結(B1 / H-1、H-2、M-9)——對照 src/lib/errorLeak.scan.test.js
// 的畫面層版本。政府合規基線(附表十構面五):錯誤只回簡短訊息及代碼。
//
// 規則:supabase/functions 內任何回應、回傳值或樣板字串,不得直接放 raw
// error.message(Claude 回應本文、PostgREST policy / constraint 名、runtime 例外)。
// 一律走 publicError.ts 的 mask*、claude.ts 的 dbErrorResponse / exceptionResponse、
// agentTools 的 toolError;console.error 行整行放行(那正是原文該去的地方)。
//
// 另釘三件接線,防止骨架再被手抄回來:
//   1. 13 支「純 schema + prompt」function 只能透過 aiJsonHandler 進閘門;
//   2. UUID_RE 只在 _shared/uuid.ts 定義一次;
//   3. agent-run 不再內嵌第二份 ai_feature_allowed 判定(gatePolicy.test.ts 另釘)。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = path.resolve(here, '..')

const sourceFiles = fs.readdirSync(FUNCTIONS_DIR, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const read = (rel: string) => fs.readFileSync(path.join(FUNCTIONS_DIR, rel), 'utf8')

// 回應 / 回傳 / 樣板拼接裡帶「error 形狀接收者」的 .message 才算(同 src 版本的判準:
// error/err/e/*Error/*Err);pub.message(已遮罩)、verdict.message(gateVerdict 自己的
// 中文)不在此列。console.error 與遮罩呼叫整行放行。
const LEAK = /(?:json\(\{|return \{[^}\n]*\berror:|throw new Error\(`|error:\s*`)[^\n]*\b(?:error|err|e|[A-Za-z]*Error|[A-Za-z]*Err)\??\.message\b/
const SAFE = /console\.|toolError\(|maskDbError\(|maskException\(|maskClaudeError\(|dbErrorResponse\(|exceptionResponse\(/

// 純 schema + prompt 的 13 支:骨架(OPTIONS / 閘門 / 記帳 / 遮罩)只在 aiHandler.ts 一份
const AI_JSON_FUNCTIONS = [
  'analyze-safety-photo', 'assistant-chat', 'audit-summary', 'classify-document',
  'classify-site-photo', 'describe-defect', 'draft-monthly-review', 'draft-rfi-reply',
  'draft-valuation-summary', 'parse-contract', 'read-submittal', 'read-whiteboard',
  'review-submittal',
]

describe('functions/ raw error.message 外洩凍結', () => {
  it('回應、回傳值與樣板字串不得直接放 raw .message', () => {
    const offenders: string[] = []
    for (const rel of sourceFiles) {
      read(rel).split('\n').forEach((line, i) => {
        if (LEAK.test(line) && !SAFE.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`)
      })
    }
    expect(offenders, `以下位置把 raw error.message 直接回給呼叫端或模型,請改走 publicError.ts 的遮罩:\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('String((e as Error)?.message || e) 不得再出現在 json() 回應裡', () => {
    const offenders = sourceFiles.filter((rel) => /json\(\{[^\n]*String\(\(e as Error\)/.test(read(rel)))
    expect(offenders).toEqual([])
  })
})

describe('骨架接線:不得手抄回來', () => {
  it('13 支純 schema + prompt function 都走 aiJsonHandler,不再各自呼叫 openAiGate / closeAiGate', () => {
    for (const name of AI_JSON_FUNCTIONS) {
      const src = read(`${name}/index.ts`)
      expect(src, `${name} 應透過 aiJsonHandler 進閘門`).toContain('aiJsonHandler(')
      expect(src, `${name} 不應再手抄 openAiGate`).not.toContain('openAiGate(')
      expect(src, `${name} 不應再手抄 closeAiGate`).not.toContain('closeAiGate(')
      expect(src, `${name} 不應再手抄 OPTIONS 處理`).not.toContain("req.method === 'OPTIONS'")
    }
  })

  it('UUID_RE 只在 _shared/uuid.ts 定義一次', () => {
    const definers = sourceFiles.filter((rel) => /const UUID_RE\s*=/.test(read(rel)))
    expect(definers).toEqual(['_shared/uuid.ts'])
  })

  it('ai_feature_allowed 只在 aiGate(使用者請求)與 send-reminders(cron)兩處判定', () => {
    const callers = sourceFiles.filter((rel) => read(rel).includes("rpc('ai_feature_allowed'")).sort()
    expect(callers).toEqual(['_shared/aiGate.ts', 'send-reminders/index.ts'])
  })
})
