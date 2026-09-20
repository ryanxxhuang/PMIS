// F2｜Edge 寫入允許清單(原始碼掃描)。P4e 的估驗禁單與 F1 的期限禁單都是「列出不可寫的表」;E 包指出這樣擋不住
// 「判定」「簽署」「事實表」這類沒被列進任何禁單的越界寫入(例如日後某支 Edge 直接 update inspections.status)。
// 這裡反過來:AI 只查詢、彙整、擬稿,Edge 寫得到的表就只有草稿／辨識結果／批次進度／建議與 run 記錄這幾張;
// 清單外的一律越界——判定(inspections／checklist_records)、期限(F1 禁單)、簽署與提送(field_document_signatures／
// field_document_submissions)、事實表(daily_logs／supervisor_logs／work_items)、估驗(P4e 禁單)全部不在清單內。
// RPC 同理:只准查詢類與記帳、以及 D-017 的確定性分流 apply_transcription_triage(它會改契約重點狀態並物化義務,
// 是設計允許的唯一「Edge 觸發的狀態變更」,見 docs/architecture/resumable-extraction.md)。
// 新增寫入目標必須有意識地加進來並在這裡說明理由;掃描器與 P4e／F1 共用同一份(tests/lib/edgeWriteScan.ts)。
// DB 端對應:估驗／確認量／期別狀態／計價依據由 20260920001500＋20260920230000 的 guard 擋,e2e-real chain 20 以真 PostgREST 釘住。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listWriteTargets, listEdgeSources } from '../../../tests/lib/edgeWriteScan.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = path.resolve(here, '..')

const EDGE_WRITE_ALLOWED_TABLES = [
  'agent_actions', 'document_ingestion_runs', 'field_document_versions', 'field_documents',
  'photo_intakes', 'photos', 'requirement_sources', 'requirement_work_items', 'requirements',
]
const EDGE_RPC_ALLOWED = [
  'my_org_type', 'ai_feature_allowed', 'record_ai_usage', 'list_project_members', 'get_project_warranty',
  'fn_field_document_template', 'can_manage_documents', 'apply_transcription_triage',
]

function offendersOf(src: string): Array<{ line: number; text: string }> {
  const t = listWriteTargets(src)
  return [
    ...t.tables.filter((x) => !EDGE_WRITE_ALLOWED_TABLES.includes(x.table)).map((x) => ({ line: x.line, text: `.from('${x.table}') → ${x.writes.join(',')}` })),
    ...t.dynamic,
    ...t.rpcs.filter((r) => !EDGE_RPC_ALLOWED.includes(r.name)).map((r) => ({ line: r.line, text: `.rpc('${r.name}')` })),
    ...t.dynamicRpcs,
    ...t.rest,
  ].sort((a, b) => a.line - b.line)
}

describe('掃描器:允許清單(合成片段)', () => {
  it('清單外的表寫入、動態目標、清單外 RPC、動態 RPC 與原始 REST 都會被抓;清單內的寫入與任何讀取不誤判', () => {
    const src = [
      "await service.from('inspections').update({ status: '合格' }).eq('id', id)",
      "await service.from('projects').update({ commencement_date: d }).eq('id', pid)",
      "await service.from('checklist_records').insert(row)",
      "await db.from(table).delete().eq('id', id)",
      "await db.rpc('review_requirement', { p_requirement_id: r, p_decision: 'approve' })",
      "await db.rpc('update_project_anchors', { p_project: pid })",
      "await fetch(`${url}/rest/v1/projects`, { method: 'PATCH' })",
      "await db.rpc(name, {})",
      "await service.from('photos').update({ ai_status: 'done' }).eq('id', photoId)",
      "await service.from('field_documents').insert(doc)",
      "const { data } = await db.from('inspections').select('id, status').eq('project_id', pid)",
      "await db.rpc('apply_transcription_triage', { p_run: runId })",
      "cache.delete(key); hash.update(chunk)",
    ].join('\n')
    expect(offendersOf(src).map((o) => o.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('supabase/functions 只寫允許清單內的表與 RPC(原始碼掃描)', () => {
  const sources = listEdgeSources(FUNCTIONS_DIR)
  it('沒有清單外的表寫入、RPC 或原始 REST', () => {
    const offenders = sources.flatMap(({ rel, src }) => offendersOf(src).map((o) => `${rel}:${o.line}  ${o.text}`))
    expect(offenders, `Edge 只可寫允許清單內的表／RPC(判定、期限、簽署、事實表與估驗一律不可):\n${offenders.join('\n')}`).toEqual([])
  })
  it('掃描有效:允許清單裡的每張表與每支 RPC 在真實原始碼裡都確實用到(清單不是擺著好看)', () => {
    const tables = new Set<string>()
    const rpcs = new Set<string>()
    for (const { src } of sources) {
      const t = listWriteTargets(src)
      for (const x of t.tables) tables.add(x.table)
      for (const r of t.rpcs) rpcs.add(r.name)
    }
    expect([...tables].sort()).toEqual([...EDGE_WRITE_ALLOWED_TABLES].sort())
    expect([...rpcs].sort()).toEqual([...EDGE_RPC_ALLOWED].sort())
  })
})
