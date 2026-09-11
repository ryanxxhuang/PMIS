// 工具白名單凍結(B4 拆檔後以原始碼掃描釘住)—— 這是紅線一「AI 只產生草稿」的
// 執行機制,不是 prompt 約束:
//   * 12 支工具 = 7 支唯讀 + 5 支草稿,三個角色的聯集不多不少、每個角色都以七支唯讀開頭。
//   * 唯讀模組(agentQueryTools / ballInCourt / agentToolCommon / agentToolDefs)不得出現寫入動詞。
//   * 草稿模組每一次 insert/update/upsert/delete 的前一個 .from() 都只能是 agent_actions。
//   * 工具層能呼叫的 RPC 只有兩支唯讀(my_org_type / list_project_members);
//     resolve_agent_action 這類狀態轉移 RPC 絕不在 agent 手上。
//   * 分派器只把 service role client 交給草稿工具,查詢七支的 case 拿不到 service。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUERY_TOOLS, toolsForRole } from './agentToolDefs.ts'
import { AGENT_ROLES } from './agentPersona.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f: string) => fs.readFileSync(path.join(here, f), 'utf8')

const READ_ONLY_MODULES = ['agentQueryTools.ts', 'ballInCourt.ts', 'agentToolCommon.ts', 'agentToolDefs.ts']
const DRAFT_MODULES = ['draftDailyLog.ts', 'draftInspection.ts', 'draftSubmittalReview.ts', 'raiseTo.ts', 'integrityAuditTool.ts']
const ALL_MODULES = [...READ_ONLY_MODULES, ...DRAFT_MODULES, 'agentTools.ts']
const WRITE_VERB = /\.(insert|update|upsert|delete)\(/g

const QUERY_NAMES = ['search_boq', 'list_daily_logs', 'get_valuation', 'get_requirements', 'list_my_open_items', 'find_evidence', 'get_record']
const DRAFT_NAMES = ['draft_daily_log', 'draft_inspection', 'draft_submittal_review', 'raise_to', 'run_integrity_audit']

describe('工具白名單:12 支 = 7 唯讀 + 5 草稿', () => {
  it('QUERY_TOOLS 恰為七支唯讀', () => {
    expect(QUERY_TOOLS.map((t) => t.name)).toEqual(QUERY_NAMES)
  })

  it('三個角色的工具聯集恰為 12 支,沒有第 13 支', () => {
    const union = new Set(AGENT_ROLES.flatMap((r) => toolsForRole(r).map((t) => t.name)))
    expect([...union].sort()).toEqual([...QUERY_NAMES, ...DRAFT_NAMES].sort())
  })

  it('每個角色的工具都以七支唯讀開頭(順序即 prompt cache 前綴)', () => {
    for (const r of AGENT_ROLES) expect(toolsForRole(r).slice(0, 7).map((t) => t.name)).toEqual(QUERY_NAMES)
  })
})

describe('草稿只寫 agent_actions、業務表零寫入(原始碼掃描)', () => {
  it('唯讀模組沒有任何寫入動詞', () => {
    for (const f of READ_ONLY_MODULES) {
      expect(read(f).match(WRITE_VERB) ?? [], `${f} 不得出現寫入動詞`).toEqual([])
    }
  })

  it('草稿模組每一次寫入的前一個 .from() 都是 agent_actions', () => {
    const offenders: string[] = []
    let writes = 0
    for (const f of DRAFT_MODULES) {
      const src = read(f)
      for (const m of src.matchAll(WRITE_VERB)) {
        writes += 1
        const from = [...src.slice(0, m.index).matchAll(/\.from\(([^)]*)\)/g)].at(-1)
        if (!from || from[1].trim() !== "'agent_actions'") {
          offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}  ${m[0]} ← .from(${from?.[1] ?? '?'})`)
        }
      }
    }
    expect(offenders, `以下寫入不是落在 agent_actions:\n${offenders.join('\n')}`).toEqual([])
    expect(writes).toBeGreaterThanOrEqual(6) // 掃描器本身要有效:五支草稿工具至少各有一次寫入(raise_to 兩次)
  })

  it('工具層只呼叫兩支唯讀 RPC,沒有 resolve_agent_action 之類的狀態轉移', () => {
    const calls = new Set<string>()
    for (const f of ALL_MODULES) {
      for (const m of read(f).matchAll(/\.rpc\(\s*'([^']+)'/g)) calls.add(m[1])
    }
    expect([...calls].sort()).toEqual(['list_project_members', 'my_org_type'])
  })

  it('分派器只把 service role client 交給草稿工具;查詢七支的 case 沒有 service', () => {
    const lines = read('agentTools.ts').split('\n')
    const caseLine = (name: string) => lines.find((l) => l.includes(`case '${name}'`))
    for (const name of QUERY_NAMES) {
      expect(caseLine(name), `${name} 的分派行`).toBeDefined()
      expect(caseLine(name)).not.toContain('service')
    }
    for (const name of DRAFT_NAMES) expect(caseLine(name)).toContain('service')
  })
})
