// draft-field-documents 流程(P2b／P3a):以記憶體 repo 與 stub 視覺驗
// 冪等(重跑不重複建件、內容相同不加版本、有人工版本只留建議)、部分失敗與逐張重試、
// 角色隔離(呼叫者≠上傳方拒絕;監造批次起監造日誌不起施工日誌、廠商批次反之;機關批次無文件)、
// 未配對(未匯標單)、重複照片、時間預算切斷與續跑、run 認領衝突、逐功能閘門 fail-closed、
// 監造日誌內容來源讀取失敗不建半份。stub 只證明流程,不證明模型辨識正確(模型品質見 P7b)。
import { describe, it, expect } from 'vitest'
import { runDraftFieldDocuments, MAX_ATTEMPTS } from './fieldDocDraftRun.ts'
import { agentDraftDailyLog, agentDraftSelfCheck, agentSelfCheckKey } from './agentFieldDocDraft.ts'
import { taipeiDateOf } from './fieldDocDraft.ts'
import type { DraftRepo, DraftVision, IntakePhotoRow, IntakeRow, PhotoAiPatch, VisionResult } from './fieldDocDraftRun.ts'
import type { ChecklistTemplateRow, DayDefect, DayInspection, FormalDailyLog, LeafWorkItem } from './fieldDocDraft.ts'
import type { FieldDocTemplate } from './fieldDocTemplate.ts'
// 範本單一定義在 DB;記憶體 repo 以示範模式 fixture(對 migration 原文釘住)代替執行期取回
import { demoFieldDocumentTemplate } from '../../../src/data/demoFieldDocTemplates.js'

const LEAVES: LeafWorkItem[] = [
  { id: 'wi-steel', item_key: 'K1', item_no: '壹.一.1', description: '鋼筋,SD420W,#4(D13),加工及組立', unit: 'T', sort_order: 1 },
  { id: 'wi-form', item_key: 'K2', item_no: '壹.一.2', description: '模板,普通模板,樓版,含支撐', unit: 'M2', sort_order: 2 },
]

type Doc = { id: string; doc_type: string; doc_date: string; intake_id: string | null; target_key: string | null; status: string; current_version_no: number; required_fields: unknown; recheck: unknown; template_id?: string | null }
type Ver = { document_id: string; version_no: number; author_kind: 'ai' | 'human'; content: unknown; attachments: unknown; field_sources: unknown; content_hash: string }

type World = {
  callerOrg: string
  intake: IntakeRow
  photos: WorldPhoto[]
  leaves: LeafWorkItem[]
  docs: Doc[]
  versions: Ver[]
  actions: Record<string, unknown>[]
  finishes: Record<string, unknown>[]
  photoPatches: { id: string; patch: PhotoAiPatch }[]
  failUpdatePhoto?: (id: string) => { error: string; code?: string } | null
  failInsertVersion?: string
  downloadFail?: Set<string>
  // 監造日誌的內容來源(P3a)
  inspections?: DayInspection[]
  defects?: DayDefect[]
  dailyLogDoc?: FormalDailyLog | null
  failInspections?: string
  // 自檢表(P3b):本案檢查表範本;範本讀取失敗模擬
  checklistTemplates?: ChecklistTemplateRow[]
  failChecklistTemplates?: string
  failTemplate?: string
  // 查驗表單(P3c):工項的 ITP 必要階段
  requiredStages?: Record<string, string[]>
  seq: number
}
const T_CONC: ChecklistTemplateRow = { id: 'tpl-conc', title: '場鑄結構用混凝土 自主檢查表', source: '03310', items: [
  { no: 'B1', item: '澆置 24 小時前已通知監造', kind: 'bool' },
  { no: 'C2', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm' },
] }

const intake = (over: Partial<IntakeRow> = {}): IntakeRow => ({
  id: 'i1', project_id: 'prj', uploader_org: 'contractor', log_date: null, status: 'received', attempts: 0,
  run_started_at: null, last_progress_at: null, candidates: [], ...over,
})
type WorldPhoto = IntakePhotoRow & { intake_id?: string }
const photo = (id: string, over: Partial<WorldPhoto> = {}): WorldPhoto => ({
  id, storage_path: `prj/intake/i1/${id}.jpg`, content_sha256: null, ai_status: 'pending', ai_result: null,
  work_item_id: null, caption: null, location: null, taken_at: '2026-09-17T02:00:00Z', created_at: `2026-09-17T02:00:0${id.length}Z`, ...over,
})

function world(over: Partial<World> = {}): World {
  return {
    callerOrg: 'contractor', intake: intake(), photos: [], leaves: LEAVES, docs: [], versions: [], actions: [], finishes: [], photoPatches: [], seq: 0, ...over,
  }
}

// 記憶體版 repo:模擬 DB 的三條不變量——同日活文件唯一(23505)、版本號連續、有人工版本後 AI 不得寫
function memoryRepo(w: World): DraftRepo {
  return {
    callerOrg: async () => w.callerOrg,
    getIntake: async (id) => (id === w.intake.id ? { ...w.intake } : null),
    claimIntake: async ({ expectedAttempts, nextAttempts, staleBefore, now }) => {
      const stale = w.intake.run_started_at && (w.intake.last_progress_at ?? '') < staleBefore
      if (w.intake.attempts !== expectedAttempts || (w.intake.run_started_at && !stale)) return 'conflict'
      w.intake = { ...w.intake, status: 'recognizing', attempts: nextAttempts, run_started_at: now, last_progress_at: now }
      return 'claimed'
    },
    listIntakePhotos: async (id) => w.photos.filter((p) => (p.intake_id ?? 'i1') === id).map((p) => ({ ...p })),
    listPhotosByIds: async (ids) => w.photos.filter((p) => ids.includes(p.id)).map((p) => ({ ...p })),
    listPhotosTakenOn: async (date, wid = null) => w.photos.filter((p) => taipeiDateOf(p.taken_at) === date && (!wid || p.work_item_id === wid)).map((p) => ({ ...p })),
    downloadPhoto: async (path) => (w.downloadFail?.has(path) ? { error: '資料存取失敗（代碼 db_error）' } : { base64: `b64:${path}`, mime: 'image/jpeg' }),
    updatePhoto: async (id, patch) => {
      const f = w.failUpdatePhoto?.(id)
      if (f) return f
      w.photoPatches.push({ id, patch })
      const p = w.photos.find((x) => x.id === id)!
      Object.assign(p, patch)
      return {}
    },
    listLeafWorkItems: async () => w.leaves,
    getDailyLog: async () => null,
    fetchWeather: async () => null,
    listOpenInspections: async () => [],
    listInspectionsOn: async () => (w.failInspections ? { error: w.failInspections } : (w.inspections ?? [])),
    listDefectsForDay: async () => w.defects ?? [],
    getDailyLogDocument: async () => w.dailyLogDoc ?? null,
    getFieldDocumentTemplate: async (t) => (w.failTemplate ? { error: w.failTemplate } : (demoFieldDocumentTemplate(t) as FieldDocTemplate | null)),
    listChecklistTemplates: async () => (w.failChecklistTemplates ? { error: w.failChecklistTemplates } : (w.checklistTemplates ?? [])),
    listRequiredStages: async (wid) => w.requiredStages?.[wid] ?? [],
    // 活文件定位:日誌類=該日;自檢表=批次＋target_key;查驗表單=target_key(模擬 DB 三個部分唯一索引)
    findActiveDoc: async (t, loc) => {
      const doc = w.docs.find((x) => x.doc_type === t && !['discarded', 'superseded'].includes(x.status)
        && ('docDate' in loc ? x.doc_date === loc.docDate : 'intakeId' in loc ? (x.intake_id === loc.intakeId && x.target_key === loc.targetKey) : x.target_key === loc.targetKey))
      return doc ? { id: doc.id, status: doc.status, current_version_no: doc.current_version_no, intake_id: doc.intake_id } : null
    },
    insertDoc: async (row) => {
      const dup = row.doc_type === 'self_check'
        ? w.docs.some((x) => x.doc_type === row.doc_type && x.intake_id === row.intake_id && x.target_key === row.target_key && !['discarded', 'superseded'].includes(x.status))
        : row.doc_type === 'inspection_form'
          ? w.docs.some((x) => x.doc_type === row.doc_type && x.target_key === row.target_key && !['discarded', 'superseded'].includes(x.status))
          : w.docs.some((x) => x.doc_type === row.doc_type && x.doc_date === row.doc_date && !['discarded', 'superseded'].includes(x.status))
      if (dup) return { conflict: true }
      const doc: Doc = { id: `doc${++w.seq}`, ...row, current_version_no: 0 }
      w.docs.push(doc)
      return { id: doc.id, status: doc.status, current_version_no: 0, intake_id: doc.intake_id }
    },
    latestVersion: async (docId) => {
      const v = w.versions.filter((x) => x.document_id === docId).sort((a, b) => b.version_no - a.version_no)[0]
      return v ? { version_no: v.version_no, author_kind: v.author_kind, content: v.content, attachments: v.attachments, content_hash: v.content_hash } : null
    },
    hasHumanVersion: async (docId) => w.versions.some((x) => x.document_id === docId && x.author_kind === 'human'),
    insertVersion: async (row) => {
      if (w.failInsertVersion) return { error: w.failInsertVersion }
      if (w.versions.some((x) => x.document_id === row.document_id && x.author_kind === 'human')) return { error: '文件已有人工版本,AI 不得再寫入版本(改以 suggest_field_update 建議)' }
      const next = w.versions.filter((x) => x.document_id === row.document_id).length + 1
      if (row.version_no !== next) return { error: `版本號必須為下一版(${next})` }
      const v: Ver = { document_id: row.document_id, version_no: row.version_no, author_kind: 'ai', content: row.content, attachments: row.attachments, field_sources: row.field_sources, content_hash: `hash${row.document_id}v${row.version_no}` }
      w.versions.push(v)
      return { version_no: v.version_no, content_hash: v.content_hash }
    },
    updateDoc: async (docId, patch) => { Object.assign(w.docs.find((x) => x.id === docId)!, patch); return {} },
    insertAgentAction: async (row) => { w.actions.push(row); return { id: `act${++w.seq}` } },
    finishIntake: async (id, patch) => { w.finishes.push(patch); w.intake = { ...w.intake, ...patch, candidates: patch.candidates } as IntakeRow; return {} },
  }
}

type Classify = { caption?: string; is_construction?: boolean; legible?: boolean; has_board?: boolean; work_item_hint?: string; location?: string | null }
function stubVision(opts: {
  classify?: (base64: string) => VisionResult<unknown>
  board?: (base64: string) => VisionResult<unknown>
  cells?: (base64: string, columnHint: string) => VisionResult<unknown>
  calls?: string[]
} = {}): DraftVision {
  const ok = (c: Classify): VisionResult<unknown> => ({ data: { caption: '鋼筋綁紮', category: '施工作業', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋加工及組立', visible_progress: '', location: null, ...c } })
  return {
    classify: async (b) => { opts.calls?.push(`classify:${b}`); return opts.classify ? opts.classify(b) : ok({}) },
    readBoard: async (b) => { opts.calls?.push(`board:${b}`); return opts.board ? opts.board(b) : { data: { log_date: '', weather: '', location: '', work_summary: '', items: [] } } },
    ...(opts.cells ? { readCells: async (b: string, _m: string, hint: string) => { opts.calls?.push(`cells:${hint}`); return opts.cells!(b, hint) } } : {}),
  }
}

const run = (w: World, vision = stubVision(), extra: Record<string, unknown> = {}) =>
  runDraftFieldDocuments({ repo: memoryRepo(w), vision, intakeId: w.intake.id, userId: 'u1', ...extra })

describe('角色隔離', () => {
  it('呼叫者組織不是批次上傳方 → 403 org_mismatch,不動任何資料', async () => {
    const w = world({ callerOrg: 'supervisor', photos: [photo('p1')] })
    const r = await run(w)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('org_mismatch')
    expect(w.photoPatches).toEqual([])
    expect(w.finishes).toEqual([])
  })
  it('監造批次:起監造日誌＋相符待查驗的監造查驗表單(不起施工日誌);判定與確認量留空;重跑冪等;另一批同查驗接同一份文件', async () => {
    const w = world({ callerOrg: 'supervisor', intake: intake({ uploader_org: 'supervisor' }), photos: [photo('p1')], requiredStages: { 'wi-steel': ['rebar'] } })
    const repo = memoryRepo(w)
    repo.listOpenInspections = async () => [
      { id: 'ins-1', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-17', location: 'A區', declared_qty: 3, unit: 'T', stage_key: 'rebar', checklist_record_id: null },
      { id: 'ins-2', title: '沒工項', work_item_id: null, requested_date: '2026-09-17' },
    ]
    const r = await runDraftFieldDocuments({ repo, vision: stubVision(), intakeId: 'i1', userId: 'u1' })
    expect(r.status).toBe(200)
    expect(w.docs.map((d) => [d.doc_type, d.target_key, d.status])).toEqual([['supervisor_log', '2026-09-17', 'pending_input'], ['inspection_form', 'ins-1', 'pending_input']])
    const cands = (r.body.intake as { candidates: { doc_type: string; state: string; blocked_by?: string[] }[] }).candidates
    expect(cands.map((c) => [c.doc_type, c.state])).toEqual([['supervisor_log', 'drafted'], ['inspection_form', 'drafted'], ['inspection_form', 'blocked']])
    expect(cands[2].blocked_by).toEqual(['work_item'])
    const ver = w.versions.find((v) => v.document_id === w.docs[1].id)!
    const content = ver.content as { verdict: unknown; confirmed_qty: unknown; declared_qty: unknown; stage_key: unknown; unit: unknown; work_item_id: unknown }
    expect(content).toMatchObject({ verdict: null, confirmed_qty: null, declared_qty: 3, stage_key: 'rebar', unit: 'T', work_item_id: 'wi-steel' })
    expect((ver.field_sources as Record<string, { status: string }>).verdict.status).toBe('pending')
    expect((ver.field_sources as Record<string, { status: string }>).confirmed_qty.status).toBe('pending')
    expect(w.docs[1].required_fields).toContain('stage_key')
    expect(w.photos[0].ai_status).toBe('done')
    // 重跑:內容相同不新增版本
    const r2 = await runDraftFieldDocuments({ repo, vision: stubVision(), intakeId: 'i1', userId: 'u1' })
    expect((r2.body.documents as { doc_type: string; action: string }[]).map((d) => [d.doc_type, d.action])).toEqual([['supervisor_log', 'unchanged'], ['inspection_form', 'unchanged']])
    // 另一批同一查驗的照片:接同一份查驗表單(不是每批一份),新增版本
    w.intake = intake({ id: 'i2', uploader_org: 'supervisor' })
    w.photos.push(photo('p2', { intake_id: 'i2' }))
    const r3 = await runDraftFieldDocuments({ repo, vision: stubVision(), intakeId: 'i2', userId: 'u1' })
    expect(r3.status).toBe(200)
    expect(w.docs.filter((d) => d.doc_type === 'inspection_form')).toHaveLength(1)
    expect((r3.body.documents as { doc_type: string; action: string; document_id: string }[]).find((d) => d.doc_type === 'inspection_form')).toMatchObject({ action: 'version_added', document_id: w.docs[1].id })
  })
  it('機關(試用管理者)批次:辨識後無任何候選、無文件', async () => {
    const w = world({ callerOrg: 'owner', intake: intake({ uploader_org: 'owner' }), photos: [photo('p1')] })
    const r = await run(w)
    expect(r.status).toBe(200)
    expect((r.body.intake as { candidates: unknown[] }).candidates).toEqual([])
    expect(w.docs).toEqual([])
  })
})

describe('廠商批次起施工日誌', () => {
  it('建立文件＋AI 版本 1＋agent_actions;照片補說明與工項;批次 ready 並推得 log_date;沒有檢查表範本時自檢表候選 blocked 不建件', async () => {
    const w = world({ photos: [photo('p1'), photo('p2', { caption: '人填的說明' })] })
    const r = await run(w)
    expect(r.status).toBe(200)
    expect(w.docs).toHaveLength(1)
    expect((r.body.intake as { candidates: { doc_type: string; state: string; blocked_by?: string[] }[] }).candidates.find((c) => c.doc_type === 'self_check')).toMatchObject({ state: 'blocked', blocked_by: ['checklist_template'] })
    expect(w.docs[0]).toMatchObject({ doc_type: 'daily_log', doc_date: '2026-09-17', intake_id: 'i1', target_key: '2026-09-17', status: 'pending_input', current_version_no: 1 })
    expect(w.versions).toHaveLength(1)
    expect(w.versions[0]).toMatchObject({ author_kind: 'ai', version_no: 1 })
    expect((w.versions[0].content as { items: Record<string, unknown> }).items['wi-steel']).toMatchObject({ qty_today: null })
    expect(w.actions).toHaveLength(1)
    expect(w.actions[0]).toMatchObject({ kind: 'draft_field_document', agent_role: 'contractor', target_table: 'field_documents', target_id: 'doc1', evidence: { intake_id: 'i1', version_no: 1, content_hash: 'hashdoc1v1' } })
    expect(w.photos[0]).toMatchObject({ ai_status: 'done', caption: '鋼筋綁紮', work_item_id: 'wi-steel' })
    expect(w.photos[1]).toMatchObject({ ai_status: 'done', caption: '人填的說明', work_item_id: 'wi-steel' })
    const body = r.body as { intake: Record<string, unknown>; documents: Record<string, unknown>[]; remaining: number }
    expect(body.intake).toMatchObject({ status: 'ready', photo_count: 2, recognized_count: 2, failed_count: 0, log_date: '2026-09-17' })
    expect(body.documents[0]).toMatchObject({ action: 'created', document_id: 'doc1', version_no: 1, status: 'pending_input' })
    expect(body.remaining).toBe(0)
    expect(w.finishes.at(-1)).toMatchObject({ status: 'ready', log_date: '2026-09-17', run_started_at: null })
  })

  it('冪等:重跑已辨識的照片不再打模型、內容相同不加版本(unchanged);新增照片才加版本 2 並推 current_version_no', async () => {
    const w = world({ photos: [photo('p1')] })
    await run(w)
    const calls: string[] = []
    const r2 = await run(w, stubVision({ calls }))
    expect(calls).toEqual([])
    expect(w.versions).toHaveLength(1)
    expect((r2.body.documents as { action: string }[])[0].action).toBe('unchanged')
    expect(w.actions).toHaveLength(1)

    w.photos.push(photo('p3'))
    const r3 = await run(w, stubVision({ calls }))
    expect(calls).toEqual(['classify:b64:prj/intake/i1/p3.jpg'])
    expect(w.versions.map((v) => v.version_no)).toEqual([1, 2])
    expect(w.docs[0].current_version_no).toBe(2)
    expect((r3.body.documents as { action: string; version_no: number }[])[0]).toMatchObject({ action: 'version_added', version_no: 2 })
    expect((w.versions[1].attachments as { photo_id: string }[]).map((a) => a.photo_id).sort()).toEqual(['p1', 'p3'])
  })

  it('已有人工版本:不新增 AI 版本、不覆寫,只留 suggest_field_update 建議', async () => {
    const w = world({ photos: [photo('p1')] })
    await run(w)
    w.versions.push({ document_id: 'doc1', version_no: 2, author_kind: 'human', content: { log_date: '2026-09-17', work_summary: '人改過' }, attachments: [], field_sources: {}, content_hash: 'h2' })
    w.docs[0].current_version_no = 2
    w.photos.push(photo('p4'))
    const r = await run(w)
    expect(w.versions).toHaveLength(2)
    expect(w.docs[0].current_version_no).toBe(2)
    expect((r.body.documents as { action: string }[])[0].action).toBe('suggested')
    const sug = w.actions.at(-1) as { kind: string; evidence: { suggestion: { content: unknown }; against_version_no: number } }
    expect(sug.kind).toBe('suggest_field_update')
    expect(sug.evidence.against_version_no).toBe(2)
    expect(sug.evidence.suggestion.content).toBeTruthy()
  })

  it('明確要求重新辨識:已 done 的照片重跑辨識並更新草稿;人填過的說明／位置不覆寫', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({ calls }))
    expect(calls.filter((c) => c.startsWith('classify:'))).toHaveLength(1)
    // 人工把說明改掉;照片已是 done,一般重跑不會再打模型
    w.photos[0].caption = '人改過的說明'
    w.photos[0].location = '人填的位置'
    const again: string[] = []
    await run(w, stubVision({ calls: again }))
    expect(again.filter((c) => c.startsWith('classify:'))).toHaveLength(0)
    // 明確要求重辨識 → 重新打模型,但人填過的欄位不覆寫
    const redo: string[] = []
    const r = await run(w, stubVision({ calls: redo, classify: () => ({ data: { caption: '模型新說明', category: '施工作業', is_construction: true, legible: true, text_legible: false, has_board: false, record_medium: 'none', work_item_hint: '鋼筋加工及組立', visible_progress: '', location: 'A區9F', location_text: '施工位置:A區9F', dropped: [] } }) }), { rerecognizePhotoIds: ['p1'] })
    expect(redo.filter((c) => c.startsWith('classify:'))).toHaveLength(1)
    expect(r.status).toBe(200)
    const patch = w.photoPatches.at(-1) as { patch: { caption?: string; location?: string } }
    expect(patch.patch.caption).toBeUndefined()
    expect(patch.patch.location).toBeUndefined()
    expect((r.body.notes as string[]).some((n) => n.includes('重新辨識'))).toBe(true)
  })

  it('重新辨識不能繞過守衛:已有人工版本仍只留建議、已簽署仍 locked', async () => {
    const w = world({ photos: [photo('p1')] })
    await run(w)
    w.versions.push({ document_id: 'doc1', version_no: 2, author_kind: 'human', content: { log_date: '2026-09-17', work_summary: '人改過' }, attachments: [], field_sources: {}, content_hash: 'h2' })
    w.docs[0].current_version_no = 2
    const r = await run(w, stubVision(), { rerecognizePhotoIds: ['p1'] })
    expect(w.versions).toHaveLength(2)
    expect((r.body.documents as { action: string }[])[0].action).toBe('suggested')
    const signed = world({ photos: [photo('p1')], docs: [{ id: 'docS', doc_type: 'daily_log', doc_date: '2026-09-17', intake_id: 'i0', target_key: '2026-09-17', status: 'signed', current_version_no: 1, required_fields: [], recheck: [] }] })
    const r2 = await run(signed, stubVision(), { rerecognizePhotoIds: ['p1'] })
    expect(signed.versions).toEqual([])
    expect((r2.body.documents as { action: string }[])[0].action).toBe('locked')
  })

  it('該日文件已簽署:不動(locked),不寫版本也不留建議', async () => {
    const w = world({ photos: [photo('p1')], docs: [{ id: 'docS', doc_type: 'daily_log', doc_date: '2026-09-17', intake_id: 'i0', target_key: '2026-09-17', status: 'signed', current_version_no: 1, required_fields: [], recheck: [] }] })
    const r = await run(w)
    expect(w.versions).toEqual([])
    expect(w.actions).toEqual([])
    expect((r.body.documents as { action: string; document_id: string }[])[0]).toMatchObject({ action: 'locked', document_id: 'docS' })
    expect((r.body.intake as { candidates: { state: string }[] }).candidates[0].state).toBe('locked')
  })

  it('該日文件已被捨棄(P3f 終態):重新上傳起一份新文件,不碰捨棄的那份(不加版本、不留建議)', async () => {
    const discarded = { id: 'docX', doc_type: 'daily_log', doc_date: '2026-09-17', intake_id: 'i0', target_key: null, status: 'discarded', current_version_no: 1, required_fields: [], recheck: [] }
    const w = world({ photos: [photo('p1')], docs: [discarded], versions: [{ document_id: 'docX', version_no: 1, author_kind: 'ai', content: {}, attachments: [], field_sources: {}, content_hash: 'hX' }] })
    const r = await run(w)
    const out = (r.body.documents as { doc_type: string; action: string; document_id: string }[]).find((d) => d.doc_type === 'daily_log')!
    expect(out.action).toBe('created')
    expect(out.document_id).not.toBe('docX')
    expect(w.docs.find((d) => d.id === 'docX')).toMatchObject({ status: 'discarded', current_version_no: 1 })
    expect(w.versions.filter((v) => v.document_id === 'docX')).toHaveLength(1)
    expect(w.actions.every((a) => a.target_id !== 'docX')).toBe(true)
  })

  it('另一批同日已起稿(無人工版本):不重複建件,改在既有文件加版本並保留前一批的附件', async () => {
    const w = world({ photos: [photo('p1')] })
    await run(w)
    // 第二批(i2)同一天:文件的 intake_id 仍是第一批,第一批的照片仍在 photos 表
    w.intake = intake({ id: 'i2', log_date: '2026-09-17' })
    w.photos.push(photo('p9', { intake_id: 'i2' }))
    const r = await run(w)
    expect(w.docs).toHaveLength(1)
    expect(w.docs[0].intake_id).toBe('i1')
    expect((r.body.documents as { action: string }[])[0].action).toBe('version_added')
    expect((w.versions[1].attachments as { photo_id: string }[]).map((a) => a.photo_id).sort()).toEqual(['p1', 'p9'])
  })

  it('同日文件建立撞唯一索引(並發):改走既有文件,不報錯', async () => {
    const w = world({ photos: [photo('p1')] })
    const repo = memoryRepo(w)
    const origInsert = repo.insertDoc
    repo.insertDoc = async (row) => {
      // 模擬另一個請求搶先建了同日文件
      await origInsert(row)
      return { conflict: true }
    }
    const r = await runDraftFieldDocuments({ repo, vision: stubVision(), intakeId: 'i1', userId: 'u1' })
    expect(r.status).toBe(200)
    expect((r.body.documents as { action: string; document_id: string }[])[0]).toMatchObject({ action: 'created', document_id: 'doc1' })
    expect(w.docs).toHaveLength(1)
  })

  it('使用者排除的候選不起稿', async () => {
    const w = world({ photos: [photo('p1')], intake: intake({ candidates: [{ doc_type: 'daily_log', target_key: '2026-09-17', excluded: true }] }) })
    const r = await run(w)
    expect(w.docs).toEqual([])
    expect((r.body.intake as { candidates: { state: string }[] }).candidates[0].state).toBe('excluded')
  })
})

describe('監造批次起監造日誌(P3a;與施工日誌同一段寫入邏輯)', () => {
  const supervisorWorld = (over: Partial<World> = {}) =>
    world({ callerOrg: 'supervisor', intake: intake({ uploader_org: 'supervisor' }), photos: [photo('s1')], ...over })

  it('建立文件＋AI 版本 1:到場留空 pending、監造事項附來源、查驗／缺失／施工日誌文件只帶系統紀錄;agent_role=supervisor', async () => {
    const w = supervisorWorld({
      inspections: [{ id: 'ins-1', title: '鋼筋查驗', status: '合格', work_item_id: 'wi-steel', location: '1F', inspection_type: null, requested_date: '2026-09-17', inspected_at: '2026-09-17T03:00:00Z', result_note: null }],
      defects: [{ id: 'df-1', title: '箍筋間距', status: '開立', severity: '一般', location: null, due_date: null, created_at: '2026-09-17T05:00:00Z', inspection_id: null }],
      dailyLogDoc: { document_id: 'dl1', status: 'submitted', version_no: 2, content: { work_summary: '鋼筋綁紮' }, signed_at: 't', submitted_at: 't', received_at: null, returned_at: null },
    })
    const r = await run(w)
    expect(r.status).toBe(200)
    expect(w.docs).toHaveLength(1)
    expect(w.docs[0]).toMatchObject({ doc_type: 'supervisor_log', doc_date: '2026-09-17', intake_id: 'i1', target_key: '2026-09-17', status: 'pending_input', current_version_no: 1 })
    const content = w.versions[0].content as Record<string, unknown>
    expect(content.attendance).toEqual([])
    expect((w.versions[0].field_sources as Record<string, { status: string }>).attendance.status).toBe('pending')
    expect((content.supervision_items as { source: string }[]).map((i) => i.source)).toEqual(['ai:photo', 'inspection:ins-1'])
    expect(content.inspection_ids).toEqual(['ins-1'])
    expect((content.notices as { ref_id: string }[]).map((n) => n.ref_id)).toEqual(['df-1'])
    expect(content.contractor_summary).toContain('鋼筋綁紮')
    expect(content.daily_log_receipt).toMatchObject({ document_id: 'dl1', status: 'submitted' })
    expect(w.actions[0]).toMatchObject({ kind: 'draft_field_document', agent_role: 'supervisor', evidence: { doc_type: 'supervisor_log', version_no: 1 } })
    const body = r.body as { documents: Record<string, unknown>[]; intake: Record<string, unknown> }
    expect(body.documents[0]).toMatchObject({ doc_type: 'supervisor_log', action: 'created', status: 'pending_input' })
    expect((body.documents[0].pending_fields as string[])).toContain('attendance')
    expect(body.intake.status).toBe('ready')
  })

  it('冪等:重跑內容相同 unchanged;已有人工版本只留建議;已簽署 locked——與施工日誌同一套', async () => {
    const w = supervisorWorld()
    await run(w)
    const r2 = await run(w)
    expect(w.versions).toHaveLength(1)
    expect((r2.body.documents as { action: string }[])[0].action).toBe('unchanged')

    w.versions.push({ document_id: 'doc1', version_no: 2, author_kind: 'human', content: { attendance: [{ name: '監造' }] }, attachments: [], field_sources: {}, content_hash: 'h2' })
    w.docs[0].current_version_no = 2
    w.photos.push(photo('s2'))
    const r3 = await run(w)
    expect((r3.body.documents as { action: string }[])[0].action).toBe('suggested')
    expect((w.actions.at(-1) as { kind: string; summary: string }).summary).toContain('監造日誌')

    const locked = supervisorWorld({ docs: [{ id: 'docS', doc_type: 'supervisor_log', doc_date: '2026-09-17', intake_id: 'i0', target_key: '2026-09-17', status: 'signed', current_version_no: 1, required_fields: [], recheck: [] }] })
    const r4 = await run(locked)
    expect((r4.body.documents as { action: string; reason: string }[])[0]).toMatchObject({ action: 'locked', reason: expect.stringContaining('監造日誌') })
    expect(locked.versions).toEqual([])
  })

  it('內容來源讀取失敗(當日查驗):該份 error、不建半份文件、批次 partial——讀不到不能寫成「無紀錄」', async () => {
    const w = supervisorWorld({ failInspections: '資料存取失敗（代碼 db_error）' })
    const r = await run(w)
    expect((r.body.documents as { action: string; reason: string }[])[0]).toMatchObject({ action: 'error', reason: '資料存取失敗（代碼 db_error）' })
    expect(w.versions).toEqual([])
    expect((r.body.intake as Record<string, unknown>).status).toBe('partial')
  })
})

describe('照片狀態', () => {
  it('非工地／不可辨／重複各有狀態:不配工項、不入附件;重複只計一次', async () => {
    const sha = 'd'.repeat(64)
    const w = world({ photos: [
      photo('p1', { content_sha256: sha }),
      photo('p2', { content_sha256: sha }),
      photo('p3'), photo('p4'),
    ] })
    const vision = stubVision({ classify: (b) => b.includes('p3')
      ? { data: { caption: '客廳', category: '其他', is_construction: false, legible: true, has_board: false, work_item_hint: '', visible_progress: '', location: null } }
      : b.includes('p4') ? { data: { caption: '', category: '其他', is_construction: true, legible: false, has_board: false, work_item_hint: '鋼筋', visible_progress: '', location: null } }
      : { data: { caption: '鋼筋', category: '施工作業', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋', visible_progress: '', location: null } } })
    const r = await run(w, vision)
    const by = Object.fromEntries((r.body.photos as { id: string; ai_status: string; work_item_id: string | null }[]).map((p) => [p.id, p]))
    expect(by.p1.ai_status).toBe('done')
    expect(by.p2).toMatchObject({ ai_status: 'duplicate', work_item_id: null })
    expect(by.p3).toMatchObject({ ai_status: 'not_site', work_item_id: null })
    expect(by.p4).toMatchObject({ ai_status: 'unreadable', work_item_id: null })
    expect(w.photos.find((p) => p.id === 'p3')!.caption).toContain('疑似非工地')
    expect((w.versions[0].attachments as { photo_id: string }[]).map((a) => a.photo_id)).toEqual(['p1'])
    expect((r.body.intake as Record<string, number>).recognized_count).toBe(4)
    expect(r.body.notes).toEqual(expect.arrayContaining([expect.stringContaining('非工地'), expect.stringContaining('不可辨'), expect.stringContaining('重複')]))
  })

  it('有告示板才跑轉錄;板上日期分到別天→兩份日誌;板上數量帶入並附來源', async () => {
    const w = world({ photos: [photo('p1'), photo('p2')] })
    const vision = stubVision({
      classify: (b) => ({ data: { caption: '鋼筋', category: '施工作業', is_construction: true, legible: true, has_board: b.includes('p2'), work_item_hint: '鋼筋', visible_progress: '', location: null } }),
      board: () => ({ data: { log_date: '2026-09-16', weather: '晴', location: '', work_summary: '', items: [{ description: '鋼筋', quantity: 8, unit: 'T', note: '' }] } }),
    })
    const calls: string[] = []
    const r = await run(w, { classify: vision.classify, readBoard: async (b, m) => { calls.push(b); return vision.readBoard(b, m) } })
    expect(calls).toEqual(['b64:prj/intake/i1/p2.jpg'])
    expect(w.docs.map((d) => d.doc_date).sort()).toEqual(['2026-09-16', '2026-09-17'])
    const v16 = w.versions.find((v) => v.document_id === w.docs.find((d) => d.doc_date === '2026-09-16')!.id)!
    expect((v16.content as { items: Record<string, { qty_today: number }> }).items['wi-steel'].qty_today).toBe(8)
    expect((v16.field_sources as Record<string, { source: string }>)['items.wi-steel.qty_today'].source).toBe('whiteboard:p2')
    expect((r.body.intake as { log_date: string | null }).log_date).toBeNull() // 跨日不推單一日期
    expect(r.body.notes).toEqual(expect.arrayContaining([expect.stringContaining('告示板日期 2026-09-16')]))
  })

  it('未匯標單:照片保存、work_item_hint 留存待配對、不寫工項;匯入後重跑用存的 hint 再配不打模型', async () => {
    const w = world({ leaves: [], photos: [photo('p1')] })
    const r = await run(w)
    expect(w.photos[0]).toMatchObject({ ai_status: 'done', work_item_id: null, work_item_hint: '鋼筋加工及組立' })
    expect((w.versions[0].content as { items: unknown; unmatched_photo_ids: string[] })).toMatchObject({ items: {}, unmatched_photo_ids: ['p1'] })
    expect((r.body.photos as { work_item_hint: string }[])[0].work_item_hint).toBe('鋼筋加工及組立')

    w.leaves = LEAVES
    const calls: string[] = []
    const r2 = await run(w, stubVision({ calls }))
    expect(calls).toEqual([])
    expect(w.photos[0]).toMatchObject({ work_item_id: 'wi-steel', work_item_hint: null })
    expect((r2.body.documents as { action: string }[])[0].action).toBe('version_added')
    expect(Object.keys((w.versions[1].content as { items: Record<string, unknown> }).items)).toEqual(['wi-steel'])
  })
})

describe('部分失敗、重試、預算、認領', () => {
  it('模型失敗與下載失敗:該張 failed、批次 partial;重跑只處理失敗張,成功後補進既有文件', async () => {
    const w = world({ photos: [photo('p1'), photo('p2'), photo('p3')], downloadFail: new Set(['prj/intake/i1/p3.jpg']) })
    const r = await run(w, stubVision({ classify: (b) => b.includes('p2') ? { error: 'AI 服務暫時無法使用（代碼 http_529）', errorCode: 'http_529' } : { data: { caption: 'x', category: '施工作業', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋', visible_progress: '', location: null } } }))
    expect((r.body.intake as Record<string, unknown>)).toMatchObject({ status: 'partial', failed_count: 2, recognized_count: 1 })
    expect(w.photos.map((p) => p.ai_status)).toEqual(['done', 'failed', 'failed'])
    expect(w.versions).toHaveLength(1)
    expect((r.body.intake as { error_summary: string }).error_summary).toContain('2 張辨識失敗')

    w.downloadFail = undefined
    const calls: string[] = []
    const r2 = await run(w, stubVision({ calls }))
    expect(calls.sort()).toEqual(['classify:b64:prj/intake/i1/p2.jpg', 'classify:b64:prj/intake/i1/p3.jpg'])
    expect((r2.body.intake as Record<string, unknown>)).toMatchObject({ status: 'ready', failed_count: 0 })
    expect(w.versions).toHaveLength(2)
    expect((w.versions[1].attachments as { photo_id: string }[]).map((a) => a.photo_id)).toEqual(['p1', 'p2', 'p3'])
    expect(w.intake.attempts).toBe(2) // 失敗後重啟計一次
  })

  it('模型輸出不完整:該張 failed(可重試),不建半份內容', async () => {
    const w = world({ photos: [photo('p1')] })
    const r = await run(w, stubVision({ classify: () => ({ data: { caption: 'x' } }) }))
    expect(w.photos[0].ai_status).toBe('failed')
    expect(w.docs).toEqual([])
    expect((r.body.intake as Record<string, unknown>).status).toBe('partial')
  })

  it('照片寫入被 DB 擋(佐證凍結 P0001):只寫辨識結果不改掛,照片仍算辨識完成並揭露', async () => {
    let blockedOnce = false
    const w = world({ photos: [photo('p1')], failUpdatePhoto: (id) => {
      if (blockedOnce || id !== 'p1') return null
      blockedOnce = true
      return { error: '照片為第 1 期估驗(已核定)的佐證;不可改掛工項', code: 'P0001' }
    } })
    const r = await run(w)
    expect(w.photos[0].ai_status).toBe('done')
    expect(w.photos[0].work_item_id).toBeNull()
    expect(r.body.notes).toEqual(expect.arrayContaining([expect.stringContaining('未改掛工項')]))
  })

  it('文件寫入失敗:該份 error、批次 partial、agent_actions 不留半筆;重跑可補上', async () => {
    const w = world({ photos: [photo('p1')], failInsertVersion: '資料存取失敗（代碼 db_error）' })
    const r = await run(w)
    expect((r.body.documents as { action: string; reason: string }[])[0]).toMatchObject({ action: 'error', reason: '資料存取失敗（代碼 db_error）' })
    expect(w.actions).toEqual([])
    expect(w.docs[0].current_version_no).toBe(0)
    expect((r.body.intake as Record<string, unknown>).status).toBe('partial')
    w.failInsertVersion = undefined
    const r2 = await run(w)
    expect((r2.body.documents as { action: string }[])[0].action).toBe('created')
    expect(w.docs).toHaveLength(1)
    expect(w.docs[0].current_version_no).toBe(1)
  })

  it('時間預算用完:未處理的張回 remaining、批次留 recognizing 且釋放 run;續跑不計 attempts', async () => {
    const w = world({ photos: [photo('p1'), photo('p2'), photo('p3')] })
    let t = 0
    const r = await run(w, stubVision(), { now: () => (t += 60_000), budgetMs: 100_000, concurrency: 1 })
    const body = r.body as { remaining: number; intake: Record<string, unknown> }
    expect(body.remaining).toBeGreaterThan(0)
    expect(body.intake.status).toBe('recognizing')
    expect(w.intake.run_started_at).toBeNull()
    expect(w.intake.attempts).toBe(1)
    const r2 = await run(w, stubVision())
    expect((r2.body as { remaining: number }).remaining).toBe(0)
    expect(w.intake.attempts).toBe(1)
    expect(w.intake.status).toBe('ready')
  })

  it('run 認領:有人在跑 → 409;過期的 run 可接手;attempts 用盡 → 409 並標 failed;已捨棄 → 409', async () => {
    const running = world({ photos: [photo('p1')], intake: intake({ status: 'recognizing', run_started_at: '2026-09-17T00:00:00Z', last_progress_at: '2026-09-17T00:00:00Z' }) })
    const nowMs = Date.parse('2026-09-17T00:05:00Z')
    expect((await run(running, stubVision(), { now: () => nowMs })).body.code).toBe('run_conflict')
    const staleNow = Date.parse('2026-09-17T00:20:00Z')
    const r = await run(running, stubVision(), { now: () => staleNow })
    expect(r.status).toBe(200)
    expect(running.intake.attempts).toBe(1)

    const exhausted = world({ photos: [photo('p1')], intake: intake({ status: 'failed', attempts: MAX_ATTEMPTS }) })
    const re = await run(exhausted)
    expect(re.body.code).toBe('attempts_exhausted')
    expect(exhausted.intake.status).toBe('failed')

    const discarded = world({ intake: intake({ status: 'discarded' }) })
    expect((await run(discarded)).body.code).toBe('intake_discarded')
  })

  it('沒有照片的批次:failed 並說明(上傳失敗的仍在本機)', async () => {
    const w = world()
    const r = await run(w)
    expect(r.status).toBe(200)
    expect((r.body.intake as Record<string, unknown>).status).toBe('failed')
    expect((r.body.intake as { error_summary: string }).error_summary).toContain('仍在本機')
  })
})

describe('逐功能閘門 fail-closed', () => {
  it('photo.classify 關閉或閘門不可用:不辨識、批次 failed、回閘門的 HTTP 狀態與代碼', async () => {
    for (const blocked of [
      { allow: false as const, code: 'feature_disabled' as const, status: 403, message: '此 AI 功能未啟用(施工照片分類),請聯絡系統管理者' },
      { allow: false as const, code: 'gate_unavailable' as const, status: 503, message: 'AI 功能開關暫時無法確認(施工照片分類),為安全起見先暫停服務,請稍後再試' },
    ]) {
      const w = world({ photos: [photo('p1'), photo('p2')] })
      const r = await run(w, stubVision({ classify: () => ({ blocked }) }))
      expect(r.status).toBe(blocked.status)
      expect(r.body.code).toBe(blocked.code)
      expect(w.photos.every((p) => p.ai_status === 'pending')).toBe(true)
      expect(w.docs).toEqual([])
      expect(w.intake.status).toBe('failed')
      expect(w.intake.run_started_at).toBeNull()
      expect((r.body.intake as { error_summary: string }).error_summary).toBe(blocked.message)
    }
  })
  it('sitelog.whiteboard 關閉:照片仍辨識與起稿,只是不轉錄數量並揭露', async () => {
    const w = world({ photos: [photo('p1')] })
    const r = await run(w, stubVision({
      classify: () => ({ data: { caption: '鋼筋', category: '施工作業', is_construction: true, legible: true, has_board: true, work_item_hint: '鋼筋', visible_progress: '', location: null } }),
      board: () => ({ blocked: { allow: false, code: 'feature_disabled', status: 403, message: '此 AI 功能未啟用(工程告示板辨識)' } }),
    }))
    expect(r.status).toBe(200)
    expect(w.photos[0].ai_status).toBe('done')
    expect((w.photos[0].ai_result as { whiteboard_skipped: string }).whiteboard_skipped).toBe('feature_disabled')
    expect(w.versions).toHaveLength(1)
    expect((w.versions[0].content as { items: Record<string, { qty_today: null }> }).items['wi-steel'].qty_today).toBeNull()
    expect(r.body.notes).toEqual(expect.arrayContaining([expect.stringContaining('告示板辨識功能未啟用')]))
  })
})

describe('廠商批次起自主檢查表(P3b;與日誌類同一段寫入邏輯,定位鍵=批次＋工項＋日期)', () => {
  const scWorld = (over: Partial<World> = {}) => world({ photos: [photo('p1'), photo('p2')], checklistTemplates: [T_CONC], ...over })

  it('每個配到工項×日期一份:建立文件(帶範本)＋AI 版本 1 全部項目 pending、實測值不帶值;施工日誌照常;範本取自 DB 而非鏡像', async () => {
    const w = scWorld()
    const r = await run(w)
    expect(r.status).toBe(200)
    expect(w.docs.map((d) => [d.doc_type, d.target_key, d.template_id ?? null])).toEqual([['daily_log', '2026-09-17', null], ['self_check', '2026-09-17:wi-steel', 'tpl-conc']])
    const scDoc = w.docs.find((d) => d.doc_type === 'self_check')!
    const sc = w.versions.find((v) => v.document_id === scDoc.id)!
    const content = sc.content as Record<string, unknown>
    expect(content).toMatchObject({ template_id: 'tpl-conc', work_item_id: 'wi-steel', check_date: '2026-09-17', template: { key: 'self_check_demo', version: 1 } })
    expect(content.results).toEqual({ B1: { value: null }, C2: { value: null } })
    const fs = sc.field_sources as Record<string, { status: string }>
    expect(fs['results.B1'].status).toBe('pending')
    expect(fs['results.C2'].status).toBe('pending')
    expect((sc.attachments as { photo_id: string }[]).map((a) => a.photo_id)).toEqual(['p1', 'p2'])
    expect(scDoc).toMatchObject({ status: 'pending_input', required_fields: ['check_date', 'results.B1', 'results.C2', 'template_id'] })
    expect(w.actions.filter((a) => a.target_id === scDoc.id)[0]).toMatchObject({ kind: 'draft_field_document', agent_role: 'contractor', evidence: { doc_type: 'self_check', version_no: 1 } })
    const body = r.body as { documents: Record<string, unknown>[]; intake: { candidates: { doc_type: string; state: string; document_id: string | null }[] } }
    expect(body.documents.map((d) => [d.doc_type, d.action])).toEqual([['daily_log', 'created'], ['self_check', 'created']])
    expect(body.intake.candidates.find((c) => c.doc_type === 'self_check')).toMatchObject({ state: 'drafted', document_id: scDoc.id })
    // 監造日誌／施工日誌的範本鍵同樣來自 DB fixture(不再有 Edge 鏡像常數)
    expect((w.versions[0].content as { template?: unknown }).template).toBeUndefined() // 施工日誌是公定格式,沒有範本
  })

  it('冪等:重跑內容相同 unchanged(以批次＋工項＋日期定位,不會誤認同日的施工日誌);已有人工版本只留建議;已簽署 locked', async () => {
    const w = scWorld()
    await run(w)
    const r2 = await run(w)
    expect(w.versions).toHaveLength(2)
    expect((r2.body.documents as { doc_type: string; action: string }[]).map((d) => [d.doc_type, d.action])).toEqual([['daily_log', 'unchanged'], ['self_check', 'unchanged']])

    const scDoc = w.docs.find((d) => d.doc_type === 'self_check')!
    w.versions.push({ document_id: scDoc.id, version_no: 2, author_kind: 'human', content: { results: { C2: { value: 18 } } }, attachments: [], field_sources: {}, content_hash: 'h2' })
    scDoc.current_version_no = 2
    w.photos.push(photo('p3'))
    const r3 = await run(w)
    expect((r3.body.documents as { doc_type: string; action: string }[]).find((d) => d.doc_type === 'self_check')?.action).toBe('suggested')
    expect((w.actions.at(-1) as { kind: string; summary: string }).summary).toContain('自主檢查表')

    const locked = scWorld({ docs: [{ id: 'docL', doc_type: 'self_check', doc_date: '2026-09-17', intake_id: 'i1', target_key: '2026-09-17:wi-steel', status: 'signed', current_version_no: 1, required_fields: [], recheck: [] }] })
    const r4 = await run(locked)
    expect((r4.body.documents as { doc_type: string; action: string; reason: string }[]).find((d) => d.doc_type === 'self_check')).toMatchObject({ action: 'locked', reason: expect.stringContaining('自主檢查表') })
    expect(locked.versions.filter((v) => v.document_id === 'docL')).toEqual([])
  })

  it('範本讀取失敗:DB 範本讀不到 → 該份 error、不建半份文件(監造日誌同一條路);檢查表範本讀不到 → 不推自檢表並揭露', async () => {
    const w = scWorld({ failTemplate: '資料存取失敗（代碼 db_error）' })
    const r = await run(w)
    expect((r.body.documents as { doc_type: string; action: string; reason: string }[]).find((d) => d.doc_type === 'self_check')).toMatchObject({ action: 'error', reason: '資料存取失敗（代碼 db_error）' })
    expect(w.docs.map((d) => d.doc_type)).toEqual(['daily_log'])
    expect((r.body.intake as Record<string, unknown>).status).toBe('partial')

    const w2 = scWorld({ failChecklistTemplates: '資料存取失敗（代碼 db_error）' })
    const r2 = await run(w2)
    expect(w2.docs.map((d) => d.doc_type)).toEqual(['daily_log'])
    expect((r2.body.intake as { candidates: { doc_type: string }[] }).candidates.some((c) => c.doc_type === 'self_check')).toBe(false)
    expect((r2.body.notes as string[]).some((n) => n.includes('檢查表範本讀取失敗'))).toBe(true)

    const w3 = world({ callerOrg: 'supervisor', intake: intake({ uploader_org: 'supervisor' }), photos: [photo('s1')], failTemplate: '資料存取失敗（代碼 db_error）' })
    const r3 = await run(w3)
    expect((r3.body.documents as { action: string }[])[0].action).toBe('error')
    expect(w3.versions).toEqual([])
  })
})

// ── Agent 對話起稿(P6b-2):draft_daily_log／draft_inspection 與照片起稿同一支 builder、同一段寫入 ─────────────
describe('Agent 對話起稿 → 現場文書草稿(不寫事實表;agent_actions 指向文件)', () => {
  const done = (id: string, over: Partial<WorldPhoto> = {}) => photo(id, {
    ai_status: 'done', work_item_id: 'wi-steel', caption: '鋼筋綁紮',
    ai_result: { classify: { caption: '鋼筋綁紮', category: '施工作業', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋', visible_progress: '', location: 'A區' }, whiteboard: null, whiteboard_skipped: null, match: { work_item_id: 'wi-steel', hint: '鋼筋' } },
    ...over,
  })

  it('施工日誌:建立該日文件(無批次)＋AI 版本 1＋draft_daily_log(target=文件);數量不帶值、非工地照片不納入', async () => {
    const w = world({ photos: [done('p1'), done('p2', { ai_status: 'not_site', work_item_id: null }), photo('p3', { work_item_id: 'wi-form' })] })
    const out = await agentDraftDailyLog({ repo: memoryRepo(w), userId: 'u1', date: '2026-09-17' })
    if (!('written' in out)) throw new Error(JSON.stringify(out))
    expect(out.written).toMatchObject({ action: 'created', document_id: 'doc1', version_no: 1 })
    expect(w.docs).toEqual([expect.objectContaining({ doc_type: 'daily_log', doc_date: '2026-09-17', intake_id: null, target_key: null, current_version_no: 1 })])
    const content = w.versions[0].content as { items: Record<string, { qty_today: unknown }> }
    expect(Object.keys(content.items).sort()).toEqual(['wi-form', 'wi-steel'])
    expect(content.items['wi-steel'].qty_today).toBeNull()
    expect((w.versions[0].attachments as { photo_id: string }[]).map((a) => a.photo_id).sort()).toEqual(['p1', 'p3'])
    expect((w.versions[0].field_sources as Record<string, { source: string }>).log_date.source).toBe('agent:request')
    expect(w.actions).toEqual([expect.objectContaining({
      kind: 'draft_daily_log', target_table: 'field_documents', target_id: 'doc1', agent_role: 'contractor',
      evidence: expect.objectContaining({ origin: 'agent', log_date: '2026-09-17', document_id: 'doc1', version_no: 1, items: expect.objectContaining({ 'wi-steel': expect.objectContaining({ qty_today: null }) }) }),
    })])
    expect(w.photoPatches).toEqual([]) // 不改照片、不辨識(只讀已存的辨識結果)
  })

  it('施工日誌:與照片起稿同一份活文件——批次文件只有 AI 版本時加版本;內容相同不加;已有人工版本只留建議;已簽署不動', async () => {
    const w = world({ photos: [done('p1')] })
    const repo = memoryRepo(w)
    const a = await agentDraftDailyLog({ repo, userId: 'u1', date: '2026-09-17' })
    expect('written' in a && a.written.action).toBe('created')
    const b = await agentDraftDailyLog({ repo, userId: 'u1', date: '2026-09-17' })
    expect('written' in b && b.written.action).toBe('unchanged')
    expect(w.actions).toHaveLength(1)
    w.photos.push(done('p4', { work_item_id: 'wi-form' }))
    const c = await agentDraftDailyLog({ repo, userId: 'u1', date: '2026-09-17' })
    expect('written' in c && c.written).toMatchObject({ action: 'version_added', document_id: 'doc1', version_no: 2 })
    w.versions.push({ document_id: 'doc1', version_no: 3, author_kind: 'human', content: {}, attachments: [], field_sources: {}, content_hash: 'h3' })
    w.docs[0].current_version_no = 3
    w.photos.push(done('p5'))
    const d = await agentDraftDailyLog({ repo, userId: 'u1', date: '2026-09-17' })
    expect('written' in d && d.written.action).toBe('suggested')
    expect(w.actions.at(-1)).toMatchObject({ kind: 'suggest_field_update', target_id: 'doc1', evidence: expect.objectContaining({ against_version_no: 3 }) })
    expect(w.versions.filter((v) => v.author_kind === 'ai')).toHaveLength(2)
    w.docs[0].status = 'signed'
    const e = await agentDraftDailyLog({ repo, userId: 'u1', date: '2026-09-17' })
    expect(e).toMatchObject({ note: expect.stringContaining('已簽署'), document_id: 'doc1' })
    expect(w.actions).toHaveLength(3)
  })

  it('施工日誌:該日沒有可用照片 → 只回說明,不建件', async () => {
    const w = world({ photos: [done('p1', { ai_status: 'unreadable' }), photo('p2', { taken_at: '2026-09-16T02:00:00Z' })] })
    const out = await agentDraftDailyLog({ repo: memoryRepo(w), userId: 'u1', date: '2026-09-17' })
    expect(out).toMatchObject({ note: expect.stringContaining('沒有已上傳的現場照片') })
    expect(w.docs).toEqual([])
    expect(w.actions).toEqual([])
  })

  it('自主檢查表:建立 agent 冪等鍵的文件(帶範本)＋AI 版本;勾選建議 filled／ai:agent 待確認、實測值永遠不帶值;draft_inspection 指向文件', async () => {
    const w = world({ photos: [done('p1')], checklistTemplates: [T_CONC] })
    const leaf = LEAVES[0]
    const sug = new Map([['B1', { value: true, basis: '對話中他說昨天已通知監造' }]])
    const out = await agentDraftSelfCheck({ repo: memoryRepo(w), userId: 'u1', date: '2026-09-17', template: T_CONC, templateReason: '你指定的範本', workItem: leaf, boolSuggestions: sug })
    if (!('written' in out)) throw new Error(JSON.stringify(out))
    const key = agentSelfCheckKey('2026-09-17', 'wi-steel', 'tpl-conc')
    expect(w.docs).toEqual([expect.objectContaining({ doc_type: 'self_check', intake_id: null, target_key: key, template_id: 'tpl-conc', status: 'pending_input' })])
    const v = w.versions[0]
    const results = (v.content as { results: Record<string, { value: unknown }> }).results
    expect(results.B1.value).toBe(true)
    expect(results.C2.value).toBeNull()
    const fs = v.field_sources as Record<string, { status: string; source: string | null; reason?: string }>
    expect(fs['results.B1']).toMatchObject({ status: 'filled', source: 'ai:agent', reason: expect.stringContaining('昨天已通知監造') })
    expect(fs['results.C2'].status).toBe('pending')
    expect((v.attachments as { photo_id: string }[]).map((a) => a.photo_id)).toEqual(['p1'])
    expect(w.actions).toEqual([expect.objectContaining({
      kind: 'draft_inspection', target_table: 'field_documents', target_id: 'doc1',
      evidence: expect.objectContaining({ template_id: 'tpl-conc', check_date: '2026-09-17', items: [expect.objectContaining({ no: 'B1', suggested: true }), expect.objectContaining({ no: 'C2', kind: 'num' })] }),
    })])
    // 同鍵再擬、內容相同 → 不加版本;照片起稿的同工項批次文件不受影響(鍵不同)
    const again = await agentDraftSelfCheck({ repo: memoryRepo(w), userId: 'u1', date: '2026-09-17', template: T_CONC, templateReason: '你指定的範本', workItem: leaf, boolSuggestions: sug })
    expect('written' in again && again.written.action).toBe('unchanged')
  })

  it('自主檢查表:未指定工項 → 不掛照片、工項待補(非必填);建議 num 項的防線在 validateBoolSuggestions,builder 也不帶值', async () => {
    const w = world({ photos: [done('p1')], checklistTemplates: [T_CONC] })
    const out = await agentDraftSelfCheck({ repo: memoryRepo(w), userId: 'u1', date: '2026-09-17', template: T_CONC, templateReason: '本案僅有這一張範本', workItem: null, boolSuggestions: new Map([['C2', { value: true, basis: '不該被用上的建議' }]]) })
    if (!('written' in out)) throw new Error(JSON.stringify(out))
    const v = w.versions[0]
    expect((v.content as { work_item_id: unknown }).work_item_id).toBeNull()
    expect(v.attachments).toEqual([])
    expect((v.field_sources as Record<string, { status: string }>).work_item_id.status).toBe('pending')
    expect((v.content as { results: Record<string, { value: unknown }> }).results.C2.value).toBeNull()
    expect(w.docs[0].target_key).toBe(agentSelfCheckKey('2026-09-17', null, 'tpl-conc'))
  })
})

describe('紙表逐格辨識(B2;獨立 AI 功能 paperform.cells)', () => {
  // 紙本表單的分類結果:record_medium=paper_form 才會走逐格路徑
  const paperClassify = (): VisionResult<unknown> => ({
    data: {
      caption: '鋼筋查驗紀錄表', category: '查驗會勘', is_construction: true, legible: true, text_legible: true,
      has_board: true, record_medium: 'paper_form', work_item_hint: '鋼筋加工及組立', visible_progress: '',
      location: null, location_text: '',
    },
  })
  // 整張圖那一支:讀得到表頭,observations 卻把實測值誤標成設計值(B 包實測到的症狀)
  const wholeBoard = (): VisionResult<unknown> => ({
    data: {
      record_medium: 'paper_form', log_date_text: '115.8.4', log_date: '2026-08-04', weather: '', location: '',
      location_text: '', work_item_text: '鋼筋', work_summary: '', items: [],
      observations: [{ kind: 'design', label: '線徑', entry_no: '1', raw_text: '13 * 11 MM', value: 13, value2: 11, unit: 'MM', comparator: '', location: '', note: '' }],
    },
  })
  const tile = (index: number, column: 'left' | 'right') =>
    ({ index, column, band: 1, bands: 1, rect: { x: 100 * (index + 1), y: 50, w: 300, h: 400 }, scale: 2, base64: `tile${index}`, mime: 'image/jpeg' as const })
  const imaging = (over: Partial<{ tiles: ReturnType<typeof tile>[]; reason: string | null }> = {}) => ({
    paperFormTiles: () => ({ tiles: [tile(0, 'left'), tile(1, 'right')], reason: null, region: { x: 90, y: 40, w: 700, h: 420 }, notes: [], ...over }),
  })
  // 重切:界線左移後右塊往左長(rect.x 變小),只回被要求的那一側
  const retryImaging = () => ({
    paperFormTiles: (_b: string, _m: string, o?: { boundaryShift?: number; columns?: ('left' | 'right' | 'whole')[] }) => {
      const all = o?.boundaryShift
        ? [{ ...tile(0, 'left'), rect: { x: 100, y: 50, w: 240, h: 400 } }, { ...tile(1, 'right'), rect: { x: 160, y: 50, w: 340, h: 400 }, base64: 'tile1-retry' }]
        : [tile(0, 'left'), tile(1, 'right')]
      const tiles = o?.columns?.length ? all.filter((t) => o.columns!.includes(t.column)) : all
      return { tiles, reason: null, region: { x: 90, y: 40, w: 700, h: 420 }, notes: [] }
    },
  })
  const cellRows = (hint: string) => hint === '左半邊'
    ? { column_seen: '設計值', rows: [{ entry_no: '(1)', label: '線徑', raw_text: '13 * 11 MM', value: 13, value2: 11, unit: 'MM' }] }
    : { column_seen: '實測值', rows: [{ entry_no: '(4)', label: '線徑', raw_text: '11 * 11 MM', value: 11, value2: 11, unit: 'MM' }] }
  const obsOf = (w: World) => (w.photos[0].ai_result as { whiteboard: { observations: { kind: string; value: number; value2: number | null; source: { column: string; rect: { x: number } } | null }[]; log_date: string } }).whiteboard

  it('逐格成功:實測值由逐格結果落地(帶原圖座標),表頭仍來自整張圖,且整張圖只讀一次', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    const r = await run(w, stubVision({ calls, classify: paperClassify, board: wholeBoard, cells: (_b, hint) => ({ data: cellRows(hint) }) }), { imaging: imaging() })
    expect(r.status).toBe(200)
    const wb = obsOf(w)
    expect(wb.log_date).toBe('2026-08-04')
    expect(wb.observations.map((o) => [o.kind, o.value, o.value2])).toEqual([['design', 13, 11], ['measured', 11, 11]])
    expect(wb.observations[1].source).toMatchObject({ column: 'right', rect: { x: 200 } })
    // 每塊各讀兩次(2 塊 × 2 次);整張圖仍讀兩次——逐格接手 observations,但表頭的手寫民國年日期
    // 仍由整張那一支負責,兩次一致才採用不能省(省過一次就出現 115 被讀成 114 的日期)
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(4)
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(2)
    expect((w.photos[0].ai_result as { paper_cells_skipped: string | null }).paper_cells_skipped).toBeNull()
  })

  it('兩塊讀到同一個欄位標題(切歪)→ 不採用逐格,保留整張圖結果並寫明原因', async () => {
    const w = world({ photos: [photo('p1')] })
    const r = await run(w, stubVision({ classify: paperClassify, board: wholeBoard, cells: () => ({ data: cellRows('右半邊') }) }), { imaging: imaging() })
    expect(r.status).toBe(200)
    const wb = obsOf(w) as unknown as { observations: { kind: string }[]; dropped: string[] }
    expect(wb.observations.map((o) => o.kind)).toEqual(['design'])
    expect(wb.dropped.join(' ')).toContain('重複的欄位標題')
    expect((w.photos[0].ai_result as { paper_cells_skipped: string }).paper_cells_skipped).toBe('not_grounded')
  })

  it('功能關閉(閘門擋下)→ 退回整張圖讀兩次,照常起稿並揭露,不整批失敗', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    const blocked = { allow: false as const, code: 'feature_disabled', status: 403, message: '此 AI 功能未啟用(紙本查驗表逐格辨識)' }
    const r = await run(w, stubVision({ calls, classify: paperClassify, board: wholeBoard, cells: () => ({ blocked }) }), { imaging: imaging() })
    expect(r.status).toBe(200)
    expect(w.photos[0].ai_status).toBe('done')
    expect((w.photos[0].ai_result as { paper_cells_skipped: string }).paper_cells_skipped).toBe('feature_disabled')
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(2) // 退回 B 的兩次
    expect(r.body.notes).toEqual(expect.arrayContaining([expect.stringContaining('紙表逐格辨識功能未啟用')]))
  })

  it('偵測不到紙張 → 帶原因跳過,整張圖照 B 讀兩次', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({ calls, classify: paperClassify, board: wholeBoard, cells: () => ({ data: cellRows('右半邊') }) }),
      { imaging: imaging({ tiles: [], reason: '畫面中找不到夠大的紙張區域,未做逐格辨識' }) })
    expect((w.photos[0].ai_result as { paper_cells_skipped: string }).paper_cells_skipped).toContain('找不到夠大的紙張區域')
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(0)
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(2)
  })

  it('沒有注入切塊能力 → unavailable,整張圖照 B 讀兩次(行為完全退回 B 包)', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({ calls, classify: paperClassify, board: wholeBoard }))
    expect((w.photos[0].ai_result as { paper_cells_skipped: string }).paper_cells_skipped).toBe('unavailable')
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(2)
  })

  it('逐格呼叫失敗 → 記下錯誤代碼,整張圖照 B 讀兩次,不讓整張照片失敗', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({ calls, classify: paperClassify, board: wholeBoard, cells: () => ({ error: '模型忙碌', errorCode: 'http_529' }) }), { imaging: imaging() })
    expect(w.photos[0].ai_status).toBe('done')
    expect((w.photos[0].ai_result as { paper_cells_skipped: string }).paper_cells_skipped).toBe('failed:http_529')
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(2)
  })

  it('整張看起來字太小(text_legible=false)仍會走逐格:切成單欄放大後常常讀得清楚', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({
      calls, board: wholeBoard, cells: (_b, hint) => ({ data: cellRows(hint) }),
      classify: () => ({ data: { caption: '鋼筋查驗紀錄表', category: '查驗會勘', is_construction: true, legible: true, text_legible: false, has_board: true, record_medium: 'paper_form', work_item_hint: '鋼筋', visible_progress: '', location: null, location_text: '' } }),
    }), { imaging: imaging() })
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(4)
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(0) // 整張轉錄仍不跑
    const wb = obsOf(w)
    expect(wb.observations.map((o) => o.kind)).toEqual(['design', 'measured'])
  })

  it('紙表但連字都讀不出來(has_board=false)→ 不走逐格,不為此花錢', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({
      calls, board: wholeBoard, cells: (_b, hint) => ({ data: cellRows(hint) }),
      classify: () => ({ data: { caption: '紙張', category: '查驗會勘', is_construction: true, legible: true, text_legible: false, has_board: false, record_medium: 'paper_form', work_item_hint: '', visible_progress: '', location: null, location_text: '' } }),
    }), { imaging: imaging() })
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(0)
  })

  it('黑白板(非紙本表單)不走逐格路徑,不為此多花錢', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({
      calls, board: wholeBoard, cells: () => ({ data: cellRows('右半邊') }),
      classify: () => ({ data: { caption: '告示板', category: '工地環境', is_construction: true, legible: true, text_legible: true, has_board: true, record_medium: 'board', work_item_hint: '', visible_progress: '', location: null, location_text: '' } }),
    }), { imaging: imaging() })
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(0)
    expect(calls.filter((c) => c.startsWith('board:'))).toHaveLength(1) // 黑白板本來就只讀一次
  })

  it('一側讀不到欄位標題 → 把分欄界線左移、只重讀那一側一次,讀到就採用', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    const r = await run(w, stubVision({
      calls, classify: paperClassify, board: wholeBoard,
      // 第一次切的右塊(tile1)欄名被切掉;重切後的右塊(tile1-retry)才讀得到「實測值」
      cells: (b, hint) => ({ data: b === 'tile1' ? { column_seen: '', rows: cellRows('右半邊').rows } : cellRows(hint) }),
    }), { imaging: retryImaging() })
    expect(r.status).toBe(200)
    const wb = obsOf(w)
    expect(wb.observations.map((o) => o.kind)).toEqual(['design', 'measured'])
    expect(wb.observations[1].source).toMatchObject({ rect: { x: 160 } }) // 用的是重切後的座標
    expect((wb as unknown as { dropped: string[] }).dropped.join(' ')).toContain('分欄界線左移重切')
    // 2 塊 ×2 次 + 重讀右側 ×2 次 = 6 次;重試只做一次,不會無上限往左試
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(6)
  })

  it('重切後仍讀不到欄位標題 → 留空待人填,不再試第三次', async () => {
    const w = world({ photos: [photo('p1')] })
    const calls: string[] = []
    await run(w, stubVision({
      calls, classify: paperClassify, board: wholeBoard,
      cells: (b, hint) => ({ data: b.startsWith('tile1') ? { column_seen: '', rows: [] } : cellRows(hint) }),
    }), { imaging: retryImaging() })
    const wb = obsOf(w)
    expect(wb.observations.every((o) => o.kind === 'design')).toBe(true)
    expect(calls.filter((c) => c.startsWith('cells:'))).toHaveLength(6)
  })

  it('整張圖那一支失敗但逐格成功 → 逐格讀到的實測值不會被丟掉', async () => {
    const w = world({ photos: [photo('p1')] })
    await run(w, stubVision({ classify: paperClassify, board: () => ({ error: '模型忙碌', errorCode: 'http_529' }), cells: (_b, hint) => ({ data: cellRows(hint) }) }), { imaging: imaging() })
    const wb = obsOf(w)
    expect(wb.observations.map((o) => [o.kind, o.value])).toEqual([['design', 13], ['measured', 11]])
    expect((w.photos[0].ai_result as { whiteboard_skipped: string }).whiteboard_skipped).toBe('failed:http_529')
  })
})
