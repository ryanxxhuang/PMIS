// F1｜Edge／AI 路徑不得改變契約期限(原始碼掃描)——廠商驗收 E 的防回歸:「照片日期不得改變契約期限」。
// 照片日期只落現場文書草稿;契約期限只能來自人:專案基準日(projects 四日期與保固期間,經 update_project_anchors、
// is_project_admin)、驗收事件(acceptance_events,RLS)、義務規則欄位(契約重點審核後由 DB 物化)、期次狀態
// (transition_obligation_period)。結構上 Edge 對這些表全是唯讀,但沒有測試釘住,未來新增一支寫 projects.commencement_date
// 的 Edge 不會被 CI 擋——這裡擋。掃描器與 P4e valuationWrites.scan.test.ts 共用同一份(tests/lib/edgeWriteScan.ts):
//   1. 任何 .from(X) 的方法鏈上出現 insert／update／upsert／delete 時,X 不得是下列期限相關表,也不得是非字串常值;
//   2. 不得呼叫改基準日／期次／義務的 RPC,.rpc() 的名稱也必須是字串常值;
//   3. 不得以原始 REST(/rest/v1/<期限相關表>)繞過 supabase-js。
// 允許的 AI → 契約重點路徑只有 requirements 三張表的 upsert(persist)與 D-019 的 apply_transcription_triage
// (抽取器輸出經確定性驗證後自動確認),不在禁單;它們產生的是義務規則欄位本身(契約原文抽的),不是基準日。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanWrites, listEdgeSources } from '../../../tests/lib/edgeWriteScan.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = path.resolve(here, '..')

const RULES = {
  // 契約期限的來源表:專案基準日(award／notice／commencement／end、保固期間)、驗收事件(實際竣工日、正式驗收合格日)、
  // 基準日版本(append-only 依據)、義務列(觸發點／偏移／指定日期／循環規則)、期次(到期日與狀態)
  tables: ['projects', 'acceptance_events', 'project_anchor_versions', 'contract_obligations', 'obligation_periods'],
  // 改基準日／物化期次／期次狀態轉移／人工審核(核定即物化義務、取代即廢止)——都只能是人在 UI 觸發
  rpcs: [
    'update_project_anchors', 'materialize_obligation_periods', 'materialize_all_obligation_periods',
    'transition_obligation_period', 'review_requirement', 'materialize_requirement_obligation',
    'fn_record_project_anchor_version', 'fn_recompute_obligations_for_anchor_version', 'fn_apply_obligation_recurrence_bound',
  ],
}
const scanAnchorWrites = (src: string) => scanWrites(src, RULES)

describe('掃描器對期限相關表(合成片段)', () => {
  it('抓得到寫基準日、寫驗收事件、寫期次、改基準日 RPC 與原始 REST;讀取與人工審核之外的 RPC 不誤判', () => {
    const src = [
      "await service.from('projects').update({ commencement_date: photoDate }).eq('id', projectId)",
      "await db.from('acceptance_events').insert({ stage_key: 'final', event_date: d })",
      "await db.from('obligation_periods').update({ status: '已完成' }).eq('id', id)",
      "await db.rpc('update_project_anchors', { p_project: projectId, p_anchors: {} })",
      "await fetch(`${url}/rest/v1/project_anchor_versions`, { method: 'POST' })",
      "const { data: proj } = await db.from('projects').select('award_date, commencement_date').eq('id', projectId).maybeSingle()",
      "await db.rpc('get_project_warranty', { p_project: projectId })",
      "await service.from('requirements').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })",
    ].join('\n')
    const r = scanAnchorWrites(src)
    expect(r.offenders.map((o) => o.line)).toEqual([1, 2, 3, 4, 5])
    expect(r.reads.map((x) => x.line)).toEqual([6])
  })
})

describe('supabase/functions 不改契約期限(原始碼掃描)', () => {
  const findings = listEdgeSources(FUNCTIONS_DIR).map(({ rel, src }) => ({ rel, ...scanAnchorWrites(src) }))

  it('沒有任何基準日／驗收事件／基準日版本／義務／期次的寫入、改期限的 RPC 或原始 REST', () => {
    const offenders = findings.flatMap((f) => f.offenders.map((o) => `${f.rel}:${o.line}  ${o.text}`))
    expect(offenders, `Edge／AI 不得改變契約期限(基準日、驗收事件、義務規則與期次只能由人在 UI 經 DB 窄門寫入):\n${offenders.join('\n')}`).toEqual([])
  })

  it('掃描有效:真實原始碼裡確實讀到基準日／驗收事件／義務(早報／Agent 收集器、照片起稿讀開工日)', () => {
    const reads = findings.flatMap((f) => f.reads.map((r) => `${f.rel}:${r.line}  ${r.text}`))
    expect(reads.some((r) => r.startsWith(`_shared${path.sep}ballInCourt.ts`) && r.includes("'projects'"))).toBe(true)
    expect(reads.some((r) => r.startsWith(`_shared${path.sep}ballInCourt.ts`) && r.includes("'acceptance_events'"))).toBe(true)
    expect(reads.some((r) => r.startsWith(`_shared${path.sep}ballInCourt.ts`) && r.includes("'contract_obligations'"))).toBe(true)
    expect(reads.length).toBeGreaterThanOrEqual(5)
  })
})
