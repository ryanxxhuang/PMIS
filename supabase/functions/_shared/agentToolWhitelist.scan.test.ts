// 工具白名單凍結(B4 拆檔後以原始碼掃描釘住)—— 這是紅線一「AI 只產生草稿」的
// 執行機制,不是 prompt 約束:
//   * 12 支工具 = 7 支唯讀 + 5 支草稿,三個角色的聯集不多不少、每個角色都以七支唯讀開頭。
//   * 唯讀模組(agentQueryTools / ballInCourt / agentToolCommon / agentToolDefs)不得出現寫入動詞。
//   * 草稿模組每一次 insert/update/upsert/delete 的前一個 .from() 都只能是 agent_actions。
//   * 日誌／自主檢查表草稿(P6b-2)不直接寫表:只經 agentFieldDocDraft → writeDraftDocument 寫「現場文書草稿」
//     (field_documents 草稿列、field_document_versions 的 AI 版本、agent_actions),與照片起稿同一段;
//     不碰照片、批次或任何事實表(事實表只由使用者簽署落庫,DB 版本 guard 另擋 AI 帶入人填欄)。
//   * 工具層能呼叫的 RPC 只有三支唯讀(my_org_type / list_project_members / get_project_warranty);
//     resolve_agent_action 這類狀態轉移 RPC 絕不在 agent 手上。get_project_warranty(P5e)是 stable 的
//     唯讀事實查詢(保固期滿日由 DB 單一日期規則算、成員檢查),收集器靠它判保固類的停止條件,不在工具層重算日期。
//   * 分派器只把 service role client 交給草稿工具,查詢七支的 case 拿不到 service。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUERY_TOOLS, toolsForRole } from './agentToolDefs.ts'
import { AGENT_ROLES } from './agentPersona.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f: string) => fs.readFileSync(path.join(here, f), 'utf8')

const READ_ONLY_MODULES = ['agentQueryTools.ts', 'ballInCourt.ts', 'ballInCourtRules.ts', 'agentToolCommon.ts', 'agentToolDefs.ts']
const DRAFT_MODULES = ['draftDailyLog.ts', 'draftInspection.ts', 'draftSubmittalReview.ts', 'raiseTo.ts', 'integrityAuditTool.ts', 'agentFieldDocDraft.ts']
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
    // 掃描器本身要有效:送審意見、交接(兩次)、稽核提示直接寫 agent_actions;日誌／自檢草稿改經 writeDraftDocument(下一條)
    expect(writes).toBeGreaterThanOrEqual(4)
  })

  it('日誌／自主檢查表草稿只經共用 writeDraftDocument 寫現場文書草稿;不碰照片、批次與事實表', () => {
    // 工具模組只能把工作交給 agentFieldDocDraft,不自己呼叫 repo 的寫入
    for (const f of ['draftDailyLog.ts', 'draftInspection.ts']) {
      const repoCalls = [...read(f).matchAll(/repo\.(\w+)\(/g)].map((m) => m[1])
      expect(repoCalls.filter((c) => /^(insert|update|finish|claim)/.test(c)), f).toEqual([])
    }
    // agentFieldDocDraft 可用的 repo 方法:讀＋交給 writeDraftDocument;不得出現照片／批次寫入
    const AGENT_REPO_ALLOWED = new Set(['findActiveDoc', 'listPhotosTakenOn', 'listLeafWorkItems', 'latestVersion', 'getDailyLog', 'fetchWeather', 'getFieldDocumentTemplate'])
    const used = new Set([...read('agentFieldDocDraft.ts').matchAll(/repo\.(\w+)\(/g)].map((m) => m[1]))
    expect([...used].filter((c) => !AGENT_REPO_ALLOWED.has(c)), 'agentFieldDocDraft 用到不在允許清單的 repo 方法').toEqual([])
    expect(read('agentFieldDocDraft.ts')).toContain('writeDraftDocument(')
    // writeDraftDocument 本體只寫文件草稿、AI 版本與 agent_actions
    const src = read('fieldDocDraftRun.ts')
    const body = src.slice(src.indexOf('export async function writeDraftDocument('), src.indexOf('export async function runDraftFieldDocuments('))
    const writes = new Set([...body.matchAll(/repo\.(\w+)\(/g)].map((m) => m[1]).filter((c) => /^(insert|update|finish|claim)/.test(c)))
    expect([...writes].sort()).toEqual(['insertAgentAction', 'insertDoc', 'insertVersion', 'updateDoc'])
    // 這四支在 supabase repo 的寫入目標:field_documents／field_document_versions／agent_actions
    const repoSrc = read('fieldDocRepo.ts')
    for (const [fn, table] of [['insertDoc', 'field_documents'], ['insertVersion', 'field_document_versions'], ['updateDoc', 'field_documents'], ['insertAgentAction', 'agent_actions']]) {
      const fnBody = repoSrc.slice(repoSrc.indexOf(`async ${fn}(`)).split('\n    },')[0]
      expect(fnBody, fn).toContain(`service.from('${table}')`)
    }
    // AI 版本一律標 author_kind='ai'(人工版本只由使用者經 save_field_document_version RPC 寫)
    expect(repoSrc.slice(repoSrc.indexOf('async insertVersion(')).split('\n    },')[0]).toContain("author_kind: 'ai'")
  })

  it('工具層只呼叫三支唯讀 RPC,沒有 resolve_agent_action 之類的狀態轉移', () => {
    const calls = new Set<string>()
    for (const f of ALL_MODULES) {
      for (const m of read(f).matchAll(/\.rpc\(\s*'([^']+)'/g)) calls.add(m[1])
    }
    expect([...calls].sort()).toEqual(['get_project_warranty', 'list_project_members', 'my_org_type'])
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
