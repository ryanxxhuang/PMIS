// draft-field-documents 的執行流程(P2b／P3a／P3b;設計 field-documents-lifecycle.md §3.1–§3.5)。
// ---------------------------------------------------------------------------
// 這裡沒有任何 npm: 執行期 import——DB 與模型都經 DraftRepo／DraftVision 兩個介面注入,
// index.ts 才把 supabase client 與 claudeJson 接上(fieldDocRepo.ts);vitest 用記憶體版
// 驗冪等、部分失敗、角色隔離、未配對、預算切斷、閘門 fail-closed。
//
// 流程(每次呼叫一段,處理不完回 remaining 由前端續呼叫):
//   1. 讀批次(RLS)→ 呼叫者組織必須=批次上傳方 → 認領 run(CAS:同批同時只有一個在跑;
//      掛掉的 run 超過 staleMs 可被接手;失敗／過期重啟才計 attempts,正常續跑不計)。
//   2. 同批同雜湊標 duplicate(不辨識、不計量、不建文件)。
//   3. 逐張(有界併發、時間預算):下載 → photo.classify(各記各的用量;功能關閉=整批停、
//      fail-closed)→ 不可辨=unreadable、非工地=not_site、有板子再跑 sitelog.whiteboard
//      → 配工項(與前端同一支 matchLeaf)→ 只由 service 寫 photos.ai_*;caption／location／
//      work_item_id 只在原本為空時補,不覆蓋人填的。
//   4. 依上傳方推候選文書(純規則);逐份起稿(廠商→施工日誌＋每個配到工項的自主檢查表、監造→監造日誌,
//      同一段寫入邏輯,只有「找活文件」的鍵(日誌類=日期;自檢表=批次＋工項＋日期)與「湊內容」依類型不同):
//      活文件不存在→建立＋AI 版本 1;存在且無人工版本→內容有變才新增 AI 版本;已有人工版本→只留
//      suggest_field_update;已簽署／提送→不動(locked)。範本(監造日誌示範範本、自檢表示範框架)於執行期向
//      DB fn_field_document_template 取(repo.getFieldDocumentTemplate),Edge 不再維護鏡像常數。
//      同一張照片可掛多份文件附件,數量只在確認量表計一次(P4)。
//   5. 批次狀態:remaining>0→recognizing(等續跑);有失敗→partial;否則 ready。

import type {
  Candidate, ChecklistTemplateRow, DayDefect, DayInspection, DraftPhoto, FieldDocDraft, FormalDailyLog, LeafWorkItem, LegacyDailyLog,
  OpenInspection, PhotoAiStatus,
} from './fieldDocDraft.ts'
import {
  assignPhotoDate, buildDailyLogDraft, buildInspectionFormDraft, buildSelfCheckDraft, buildSupervisorLogDraft, draftUnchanged, duplicateGroups,
  inferCandidates, mergeCandidateExclusions, previousDate, validDate, FIELD_DOC_TYPE_LABELS,
} from './fieldDocDraft.ts'
import type { FieldDocTemplate } from './fieldDocTemplate.ts'
import { matchLeaf } from './photoMatch.ts'
import { normalizeSitePhotoResult, normalizeWhiteboardResult } from './sitePhotoVision.ts'
import type { SitePhotoResult, WhiteboardResult } from './sitePhotoVision.ts'
import type { GateVerdict } from './gatePolicy.ts'

export const MAX_ATTEMPTS = 5
export const DEFAULT_STALE_MS = 10 * 60 * 1000
export const DEFAULT_BUDGET_MS = 100_000
export const DEFAULT_CONCURRENCY = 3

// ── 注入介面 ───────────────────────────────────────────────────────────────
export type IntakeRow = {
  id: string
  project_id: string
  uploader_org: string
  log_date: string | null
  status: string
  attempts: number
  run_started_at: string | null
  last_progress_at: string | null
  candidates: unknown
}

export type IntakePhotoRow = {
  id: string
  storage_path: string
  content_sha256: string | null
  ai_status: PhotoAiStatus | null
  ai_result: unknown
  work_item_id: string | null
  caption: string | null
  location: string | null
  taken_at: string | null
  created_at: string
}

export type PhotoAiPatch = {
  ai_status: PhotoAiStatus
  ai_result: unknown
  ai_run_at: string
  work_item_hint?: string | null
  caption?: string
  location?: string
  work_item_id?: string
}

export type DocRow = { id: string; status: string; current_version_no: number; intake_id: string | null }
// 活文件的定位鍵:日誌類=該案該日一份;自檢表=同批次同工項同日一份(intake_id＋target_key 的起稿冪等索引)
// 活文件定位:日誌類=該日;自檢表=批次＋target_key;監造查驗表單=target_key(查驗 id,跨批次同一份)
export type DocLocator = { docDate: string } | { intakeId: string; targetKey: string } | { targetKey: string }
export type VersionRow = { version_no: number; author_kind: 'ai' | 'human'; content: unknown; attachments: unknown; content_hash: string }

export type RepoError = { error: string }
const isErr = (v: unknown): v is RepoError => !!v && typeof v === 'object' && 'error' in (v as Record<string, unknown>) && typeof (v as RepoError).error === 'string'

export interface DraftRepo {
  callerOrg(): Promise<string>
  getIntake(intakeId: string): Promise<IntakeRow | null | RepoError>
  // CAS 認領:attempts 必須仍等於 expectedAttempts,且 run_started_at 為 null 或已過期
  claimIntake(p: { intakeId: string; expectedAttempts: number; nextAttempts: number; staleBefore: string; now: string }): Promise<'claimed' | 'conflict' | RepoError>
  listIntakePhotos(intakeId: string): Promise<IntakePhotoRow[] | RepoError>
  listPhotosByIds(ids: string[]): Promise<IntakePhotoRow[] | RepoError>
  downloadPhoto(storagePath: string): Promise<{ base64: string; mime: string } | RepoError>
  updatePhoto(photoId: string, patch: PhotoAiPatch): Promise<{ error?: string; code?: string }>
  listLeafWorkItems(): Promise<LeafWorkItem[] | RepoError>
  getDailyLog(date: string): Promise<LegacyDailyLog | null | RepoError>
  fetchWeather(date: string): Promise<{ am?: string | null; pm?: string | null } | null>
  listOpenInspections(): Promise<OpenInspection[] | RepoError>
  // 監造日誌的內容來源(P3a):當日查驗、當日開立∪未結案缺失、同日施工日誌文件現況——讀失敗要回錯誤,
  // 不能當成「沒有紀錄」(那會把讀取失敗寫成事實)
  listInspectionsOn(date: string): Promise<DayInspection[] | RepoError>
  listDefectsForDay(date: string): Promise<DayDefect[] | RepoError>
  getDailyLogDocument(date: string): Promise<FormalDailyLog | null | RepoError>
  // 範本單一定義在 DB(fn_field_document_template);null=該類型沒有範本。讀失敗要回錯誤,不能當成「沒有範本」。
  getFieldDocumentTemplate(docType: string): Promise<FieldDocTemplate | null | RepoError>
  // 本案檢查表範本(P3b 自檢表 kind=self_check、P3c 查驗表單 kind=inspection_form;RLS 讀)
  listChecklistTemplates(): Promise<ChecklistTemplateRow[] | RepoError>
  // 工項的 ITP 必要階段(H 點、required_for_billing;P3c 查驗表單的階段鍵必填與可選值)
  listRequiredStages(workItemId: string): Promise<string[] | RepoError>
  findActiveDoc(docType: string, locator: DocLocator): Promise<DocRow | null | RepoError>
  insertDoc(row: { doc_type: string; doc_date: string; intake_id: string; target_key: string; status: string; required_fields: unknown; recheck: unknown; created_by: string; template_id?: string | null }): Promise<DocRow | { conflict: true } | RepoError>
  latestVersion(docId: string): Promise<VersionRow | null | RepoError>
  hasHumanVersion(docId: string): Promise<boolean | RepoError>
  insertVersion(row: { document_id: string; version_no: number; content: unknown; field_sources: unknown; attachments: unknown; change_note: string }): Promise<{ version_no: number; content_hash: string } | RepoError>
  updateDoc(docId: string, patch: { current_version_no?: number; status?: string; required_fields?: unknown; recheck?: unknown }): Promise<{ error?: string }>
  insertAgentAction(row: { actor_user: string; agent_role: string; kind: string; target_table: string; target_id: string; summary: string; rationale: string; evidence: unknown }): Promise<{ id: string } | RepoError>
  finishIntake(intakeId: string, patch: { status: string; photo_count: number; recognized_count: number; failed_count: number; candidates: unknown; log_date?: string; error_summary: string | null; last_progress_at: string; run_started_at: null }): Promise<{ error?: string }>
}

export type VisionResult<T> = { data: T } | { error: string; errorCode: string } | { blocked: GateVerdict & { allow: false } }
export interface DraftVision {
  classify(base64: string, mime: string): Promise<VisionResult<unknown>>
  readBoard(base64: string, mime: string): Promise<VisionResult<unknown>>
}

export type RunInput = {
  repo: DraftRepo
  vision: DraftVision
  intakeId: string
  userId: string
  now?: () => number
  budgetMs?: number
  concurrency?: number
  staleMs?: number
}

export type PhotoOutcome = {
  id: string
  ai_status: PhotoAiStatus
  work_item_id: string | null
  work_item_hint: string | null
  caption: string | null
  location: string | null
  error: string | null
}

export type DocumentOutcome = {
  doc_type: string
  doc_date: string
  document_id: string | null
  version_no: number | null
  status: string | null
  action: 'created' | 'version_added' | 'unchanged' | 'suggested' | 'locked' | 'error'
  reason: string | null
  pending_fields: string[]
}

export type RunResult = { status: number; body: Record<string, unknown> }

// 有界併發(與前端 packageUpload.mapWithConcurrency 同語意:共用索引、完成順序不保證、逐項隔離)
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker))
  return results
}

type StoredAiResult = {
  classify: SitePhotoResult | null
  whiteboard: WhiteboardResult | null
  whiteboard_skipped: string | null
  match: { work_item_id: string | null; hint: string | null }
  duplicate_of?: string
  error?: string
}

// photos.ai_result 讀回:形狀由 normalize* 驗,不合就當沒有(重跑會重新辨識)
function readStored(raw: unknown): StoredAiResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const classify = normalizeSitePhotoResult(r.classify)
  if (!classify) return null
  const match = (r.match && typeof r.match === 'object') ? r.match as Record<string, unknown> : {}
  return {
    classify,
    whiteboard: normalizeWhiteboardResult(r.whiteboard),
    whiteboard_skipped: typeof r.whiteboard_skipped === 'string' ? r.whiteboard_skipped : null,
    match: {
      work_item_id: typeof match.work_item_id === 'string' ? match.work_item_id : null,
      hint: typeof match.hint === 'string' ? match.hint : null,
    },
  }
}

export async function runDraftFieldDocuments(input: RunInput): Promise<RunResult> {
  const { repo, vision, intakeId, userId } = input
  const now = input.now ?? (() => Date.now())
  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY
  const staleMs = input.staleMs ?? DEFAULT_STALE_MS
  const startedAt = now()
  const iso = (ms: number) => new Date(ms).toISOString()
  const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RunResult =>
    ({ status, body: { error, code, ...extra } })

  // ── 1. 批次、角色、認領 ─────────────────────────────────────────────────
  const intake = await repo.getIntake(intakeId)
  if (isErr(intake)) return fail(500, 'db_error', intake.error)
  if (!intake) return fail(404, 'intake_not_found', '找不到上傳批次或無權限')
  if (intake.status === 'discarded') return fail(409, 'intake_discarded', '此批次已捨棄,不再處理')

  const callerOrg = await repo.callerOrg()
  if (callerOrg !== intake.uploader_org) {
    return fail(403, 'org_mismatch', '只有上傳方所屬的同一方成員可對此批次起稿')
  }

  const lastProgress = intake.last_progress_at ? Date.parse(intake.last_progress_at) : 0
  const running = !!intake.run_started_at
  const stale = running && startedAt - lastProgress > staleMs
  if (running && !stale) return fail(409, 'run_conflict', '這批照片正在處理中,請稍候再查看')
  // 正常暫停(recognizing 且沒有 run 在跑)=續跑,不計 attempts;失敗／過期重啟才計
  const continuing = !running && intake.status === 'recognizing'
  const nextAttempts = continuing ? intake.attempts : intake.attempts + 1
  if (!continuing && intake.attempts >= MAX_ATTEMPTS) {
    await repo.finishIntake(intakeId, {
      status: 'failed', photo_count: 0, recognized_count: 0, failed_count: 0, candidates: intake.candidates ?? [],
      error_summary: `已重試 ${MAX_ATTEMPTS} 次仍未完成;請把照片重新上傳成新批次`, last_progress_at: iso(now()), run_started_at: null,
    })
    return fail(409, 'attempts_exhausted', `此批次已重試 ${MAX_ATTEMPTS} 次仍未完成,請重新上傳成新批次`)
  }
  const claim = await repo.claimIntake({
    intakeId, expectedAttempts: intake.attempts, nextAttempts, staleBefore: iso(startedAt - staleMs), now: iso(startedAt),
  })
  if (isErr(claim)) return fail(500, 'db_error', claim.error)
  if (claim === 'conflict') return fail(409, 'run_conflict', '這批照片正在處理中,請稍候再查看')

  // ── 2. 照片與重複 ───────────────────────────────────────────────────────
  const photosRes = await repo.listIntakePhotos(intakeId)
  if (isErr(photosRes)) return fail(500, 'db_error', photosRes.error)
  const photos = photosRes
  const notes: string[] = []
  const outcomes = new Map<string, PhotoOutcome>()
  const stored = new Map<string, StoredAiResult>()
  const setOutcome = (p: IntakePhotoRow, ai_status: PhotoAiStatus, patch: Partial<PhotoOutcome> = {}) => {
    outcomes.set(p.id, {
      id: p.id, ai_status, work_item_id: patch.work_item_id ?? p.work_item_id, work_item_hint: patch.work_item_hint ?? null,
      caption: patch.caption ?? p.caption, location: patch.location ?? p.location, error: patch.error ?? null,
    })
  }

  if (!photos.length) {
    await repo.finishIntake(intakeId, {
      status: 'failed', photo_count: 0, recognized_count: 0, failed_count: 0, candidates: [],
      error_summary: '此批次沒有已保存的照片(上傳失敗的照片仍在本機,請重新上傳)', last_progress_at: iso(now()), run_started_at: null,
    })
    return { status: 200, body: { ok: true, intake: { id: intakeId, status: 'failed', photo_count: 0, recognized_count: 0, failed_count: 0, candidates: [], error_summary: '此批次沒有已保存的照片(上傳失敗的照片仍在本機,請重新上傳)' }, photos: [], documents: [], remaining: 0, notes: [] } }
  }

  const leavesRes = await repo.listLeafWorkItems()
  if (isErr(leavesRes)) return fail(500, 'db_error', leavesRes.error)
  const leaves = leavesRes
  const hasBoq = leaves.length > 0

  const dups = duplicateGroups(photos)
  for (const p of photos) {
    const canonical = dups.get(p.id)
    if (!canonical) continue
    if (p.ai_status !== 'duplicate') {
      const r = await repo.updatePhoto(p.id, { ai_status: 'duplicate', ai_result: { duplicate_of: canonical }, ai_run_at: iso(now()) })
      if (r.error) { setOutcome(p, p.ai_status ?? 'pending', { error: r.error }); continue }
    }
    setOutcome(p, 'duplicate')
  }

  // ── 3. 逐張辨識(有界併發、時間預算;功能關閉=整批停) ─────────────────────
  const work = photos.filter((p) => !dups.has(p.id) && (p.ai_status == null || p.ai_status === 'pending' || p.ai_status === 'failed'))
  const terminal = photos.filter((p) => !dups.has(p.id) && (p.ai_status === 'done' || p.ai_status === 'not_site' || p.ai_status === 'unreadable'))
  for (const p of terminal) {
    const s = readStored(p.ai_result)
    if (s) stored.set(p.id, s)
    setOutcome(p, p.ai_status as PhotoAiStatus, { work_item_hint: s?.match.hint ?? null })
  }
  // 已辨識但未配對、現在有標單了→再配一次(匯標單後可對同一批重跑,不再打模型)
  for (const p of terminal) {
    const s = stored.get(p.id)
    if (p.ai_status !== 'done' || p.work_item_id || !s || !hasBoq || !s.match.hint) continue
    const wi = matchLeaf(s.match.hint, leaves)
    if (!wi) continue
    const r = await repo.updatePhoto(p.id, {
      ai_status: 'done', ai_run_at: iso(now()), work_item_hint: null, work_item_id: wi.id,
      ai_result: { ...s, match: { work_item_id: wi.id, hint: s.match.hint } },
    })
    if (!r.error) { p.work_item_id = wi.id; setOutcome(p, 'done', { work_item_id: wi.id, work_item_hint: null }) }
  }

  // 用物件承載跨閉包的旗標:TS 的流程分析不追閉包內的賦值,裸 let 會在迴圈後被窄成初始值
  const stop = { verdict: null as (GateVerdict & { allow: false }) | null }
  let boardBlocked = false
  let remaining = 0
  await mapWithConcurrency(work, concurrency, async (p) => {
    if (stop.verdict || now() - startedAt > budgetMs) { remaining++; return }
    const dl = await repo.downloadPhoto(p.storage_path)
    if (isErr(dl)) {
      const r = await repo.updatePhoto(p.id, { ai_status: 'failed', ai_result: { error: 'download_failed' }, ai_run_at: iso(now()) })
      setOutcome(p, 'failed', { error: r.error ?? '照片下載失敗,可重試' })
      return
    }
    const cls = await vision.classify(dl.base64, dl.mime)
    if ('blocked' in cls) { stop.verdict = cls.blocked; remaining++; return }
    if ('error' in cls) {
      const r = await repo.updatePhoto(p.id, { ai_status: 'failed', ai_result: { error: cls.errorCode }, ai_run_at: iso(now()) })
      setOutcome(p, 'failed', { error: r.error ?? cls.error })
      return
    }
    const classify = normalizeSitePhotoResult(cls.data)
    if (!classify) {
      const r = await repo.updatePhoto(p.id, { ai_status: 'failed', ai_result: { error: 'invalid_output' }, ai_run_at: iso(now()) })
      setOutcome(p, 'failed', { error: r.error ?? '模型輸出不完整,可重試' })
      return
    }
    let status: PhotoAiStatus = 'done'
    if (!classify.legible) status = 'unreadable'
    else if (!classify.is_construction) status = 'not_site'

    let whiteboard: WhiteboardResult | null = null
    let whiteboardSkipped: string | null = null
    if (status === 'done' && classify.has_board) {
      if (boardBlocked) whiteboardSkipped = 'feature_disabled'
      else {
        const wb = await vision.readBoard(dl.base64, dl.mime)
        if ('blocked' in wb) { boardBlocked = true; whiteboardSkipped = 'feature_disabled' }
        else if ('error' in wb) whiteboardSkipped = `failed:${wb.errorCode}`
        else {
          whiteboard = normalizeWhiteboardResult(wb.data)
          if (!whiteboard) whiteboardSkipped = 'failed:invalid_output'
        }
      }
    }
    const hint = status === 'done' ? classify.work_item_hint : ''
    const wi = status === 'done' && hint && hasBoq ? matchLeaf(hint, leaves) : null
    const result: StoredAiResult = {
      classify, whiteboard, whiteboard_skipped: whiteboardSkipped,
      match: { work_item_id: p.work_item_id ?? wi?.id ?? null, hint: hint || null },
    }
    const patch: PhotoAiPatch = {
      ai_status: status, ai_result: result, ai_run_at: iso(now()),
      work_item_hint: status === 'done' && !p.work_item_id && !wi && hint ? hint : null,
    }
    // 只補空欄,不覆蓋人填的;非工地／不可辨的照片不套說明、不配工項
    if (status === 'done') {
      if (!p.caption && classify.caption) patch.caption = classify.caption
      const loc = classify.location ?? (whiteboard?.location || null)
      if (!p.location && loc) patch.location = loc
      if (!p.work_item_id && wi) patch.work_item_id = wi.id
    } else if (status === 'not_site' && !p.caption) {
      patch.caption = '(AI 判讀:疑似非工地照片,請人工確認)'
    }
    let r = await repo.updatePhoto(p.id, patch)
    if (r.error && r.code === 'P0001') {
      // 佐證凍結 guard 擋下改掛(照片已屬已核定估驗):只寫辨識結果,不改連結欄
      notes.push(`照片 ${p.id.slice(0, 8)} 已為估驗佐證,未改掛工項:${r.error}`)
      r = await repo.updatePhoto(p.id, { ai_status: status, ai_result: result, ai_run_at: patch.ai_run_at, work_item_hint: patch.work_item_hint })
    }
    if (r.error) { setOutcome(p, 'failed', { error: r.error }); return }
    stored.set(p.id, result)
    if (patch.work_item_id) p.work_item_id = patch.work_item_id
    if (patch.caption) p.caption = patch.caption
    if (patch.location) p.location = patch.location
    setOutcome(p, status, { work_item_id: p.work_item_id, work_item_hint: patch.work_item_hint ?? null, caption: p.caption, location: p.location })
  })

  const outcomeList = () => photos.map((p) => outcomes.get(p.id) ?? ({ id: p.id, ai_status: (p.ai_status ?? 'pending') as PhotoAiStatus, work_item_id: p.work_item_id, work_item_hint: null, caption: p.caption, location: p.location, error: null }))
  const counts = () => {
    const list = outcomeList()
    return {
      photo_count: photos.length,
      recognized_count: list.filter((o) => o.ai_status === 'done' || o.ai_status === 'not_site' || o.ai_status === 'unreadable' || o.ai_status === 'duplicate').length,
      failed_count: list.filter((o) => o.ai_status === 'failed').length,
    }
  }

  if (stop.verdict) {
    const b = stop.verdict
    const c = counts()
    await repo.finishIntake(intakeId, {
      status: 'failed', ...c, candidates: intake.candidates ?? [], error_summary: b.message, last_progress_at: iso(now()), run_started_at: null,
    })
    return fail(b.status, b.code, b.message, { intake: { id: intakeId, status: 'failed', ...c, error_summary: b.message }, photos: outcomeList() })
  }

  // ── 4. 候選文書與日誌類起稿 ─────────────────────────────────────────────
  const sitePhotoRows = photos.filter((p) => outcomes.get(p.id)?.ai_status === 'done' && stored.has(p.id))
  const dated = sitePhotoRows.map((p) => {
    const s = stored.get(p.id)!
    const d = assignPhotoDate(p, s.whiteboard, validDate(intake.log_date))
    if (d.conflict) notes.push(`照片 ${p.id.slice(0, 8)}:${d.conflict}`)
    return { photo: p, stored: s, ...d }
  })
  const statusNotes = () => {
    const list = outcomeList()
    const n = (s: PhotoAiStatus) => list.filter((o) => o.ai_status === s).length
    const out: string[] = []
    if (n('not_site')) out.push(`${n('not_site')} 張判為非工地照片,未納入`)
    if (n('unreadable')) out.push(`${n('unreadable')} 張模糊或不可辨,未納入`)
    if (n('duplicate')) out.push(`${n('duplicate')} 張為重複照片,只計一次`)
    if (n('failed')) out.push(`${n('failed')} 張辨識失敗,可重試`)
    if (remaining) out.push(`${remaining} 張尚未處理,將於下次呼叫繼續`)
    if (boardBlocked) out.push('告示板辨識功能未啟用,數量與日期未轉錄')
    return out
  }

  const inspectionsRes = intake.uploader_org === 'supervisor' ? await repo.listOpenInspections() : []
  const openInspections = isErr(inspectionsRes) ? [] : inspectionsRes
  // 本案檢查表範本(廠商批次:自檢表候選由 kind=self_check 確定性挑選;監造批次:查驗表單的查驗項目取 kind=inspection_form);
  // 讀失敗=整批不推自檢表候選、查驗表單不帶範本,但要揭露,不能當成「沒有範本」
  let checklistTemplates: ChecklistTemplateRow[] | null = []
  if (intake.uploader_org === 'contractor' || intake.uploader_org === 'supervisor') {
    const tplRes = await repo.listChecklistTemplates()
    if (isErr(tplRes)) { notes.push(`檢查表範本讀取失敗,本次${intake.uploader_org === 'contractor' ? '未推自主檢查表' : '查驗表單未帶查驗項目範本'}:${tplRes.error}`); checklistTemplates = null }
    else checklistTemplates = tplRes
  }
  let candidates = mergeCandidateExclusions(intake.candidates, inferCandidates({
    uploaderOrg: intake.uploader_org,
    sitePhotos: dated.map((d) => ({ id: d.photo.id, date: d.date, work_item_id: d.photo.work_item_id })),
    openInspections, workItems: leaves, checklistTemplates,
  }))

  const documents: DocumentOutcome[] = []
  let docErrors = 0
  const toDraftPhoto = (p: IntakePhotoRow, s: StoredAiResult | null): DraftPhoto => ({
    id: p.id, storage_path: p.storage_path, content_sha256: p.content_sha256, work_item_id: p.work_item_id,
    caption: p.caption, location: p.location, taken_at: p.taken_at, created_at: p.created_at,
    classify: s?.classify ?? null, whiteboard: s?.whiteboard ?? null, whiteboardSkipped: s?.whiteboard_skipped ?? null,
  })

  // 範本於執行期向 DB 取,每批只取一次;null=沒有範本(該類型不能起稿,回錯誤而不是硬湊)
  const templateCache = new Map<string, FieldDocTemplate | null>()
  const templateFor = async (docType: string): Promise<FieldDocTemplate> => {
    if (!templateCache.has(docType)) {
      const t = await repo.getFieldDocumentTemplate(docType)
      if (isErr(t)) throw new Error(t.error)
      templateCache.set(docType, t)
    }
    const t = templateCache.get(docType)
    if (!t) throw new Error(`伺服器沒有${FIELD_DOC_TYPE_LABELS[docType as keyof typeof FIELD_DOC_TYPE_LABELS] ?? docType}範本,無法起稿`)
    return t
  }

  // 「湊內容」是唯一依類型不同的地方;寫入、冪等、建議、鎖定對每類都是同一段
  const buildDraftFor = async (cand: Candidate, date: string, dateSource: { source: string; refs: string[] }, dayPhotos: DraftPhoto[]): Promise<FieldDocDraft> => {
    if (cand.doc_type === 'inspection_form') {
      const inspection = openInspections.find((i) => i.id === cand.target_key)
      const workItem = leaves.find((w) => w.id === cand.work_item_id)
      if (!inspection || !workItem) throw new Error('查驗申請或其工項已不存在,請重試')
      const stagesRes = await repo.listRequiredStages(workItem.id)
      if (isErr(stagesRes)) throw new Error(stagesRes.error)
      const template = cand.template_id ? (checklistTemplates ?? []).find((t) => t.id === cand.template_id) ?? null : null
      return buildInspectionFormDraft({
        date, dateSource, photos: dayPhotos, inspection, workItem, requiredStages: stagesRes, template,
        templateReason: template ? cand.reason : null, frame: await templateFor('inspection_form'), hasBoq, notes: statusNotes(),
      })
    }
    if (cand.doc_type === 'self_check') {
      const template = (checklistTemplates ?? []).find((t) => t.id === cand.template_id)
      const workItem = leaves.find((w) => w.id === cand.work_item_id)
      if (!template || !workItem) throw new Error('自主檢查表的範本或工項已不存在,請重試')
      return buildSelfCheckDraft({
        date, dateSource, photos: dayPhotos, workItem, template, templateReason: cand.reason, frame: await templateFor('self_check'),
        hasBoq, notes: statusNotes(),
      })
    }
    const weather = await repo.fetchWeather(date)
    if (cand.doc_type === 'daily_log') {
      const sameDayRes = await repo.getDailyLog(date)
      const yesterdayRes = await repo.getDailyLog(previousDate(date))
      return buildDailyLogDraft({
        date, dateSource, photos: dayPhotos, workItems: leaves,
        sameDayLog: isErr(sameDayRes) ? null : sameDayRes, yesterdayLog: isErr(yesterdayRes) ? null : yesterdayRes,
        weather, hasBoq, notes: statusNotes(),
      })
    }
    const [insRes, defRes, dlRes] = await Promise.all([repo.listInspectionsOn(date), repo.listDefectsForDay(date), repo.getDailyLogDocument(date)])
    if (isErr(insRes)) throw new Error(insRes.error)
    if (isErr(defRes)) throw new Error(defRes.error)
    if (isErr(dlRes)) throw new Error(dlRes.error)
    return buildSupervisorLogDraft({
      date, dateSource, photos: dayPhotos, workItems: leaves, inspections: insRes, openInspections, defects: defRes,
      dailyLog: dlRes, weather, template: await templateFor('supervisor_log'), hasBoq, notes: statusNotes(),
    })
  }
  // 活文件的定位鍵:日誌類每案每日一份;自檢表同批次同工項同日一份;查驗表單每份查驗一份(跨批次)
  const locatorOf = (cand: Candidate): DocLocator =>
    cand.doc_type === 'self_check' ? { intakeId, targetKey: cand.target_key! }
      : cand.doc_type === 'inspection_form' ? { targetKey: cand.target_key! }
        : { docDate: cand.doc_date! }
  const SUPPORTED: readonly string[] = ['daily_log', 'supervisor_log', 'self_check', 'inspection_form']

  for (const cand of candidates) {
    if (cand.state !== 'ready' || !cand.doc_date || !cand.target_key) continue
    if (!SUPPORTED.includes(cand.doc_type)) continue
    const docType = cand.doc_type
    const typeLabel = FIELD_DOC_TYPE_LABELS[docType]
    const date = cand.doc_date
    const out: DocumentOutcome = { doc_type: docType, doc_date: date, document_id: null, version_no: null, status: null, action: 'error', reason: null, pending_fields: [] }
    documents.push(out)
    const setCand = (patch: Partial<Candidate>) => { candidates = candidates.map((c) => (c === cand ? { ...c, ...patch } : c)) }
    try {
      const existingRes = await repo.findActiveDoc(docType, locatorOf(cand))
      if (isErr(existingRes)) throw new Error(existingRes.error)
      let existing = existingRes
      if (existing && existing.status !== 'draft' && existing.status !== 'pending_input') {
        out.action = 'locked'; out.document_id = existing.id; out.status = existing.status; out.version_no = existing.current_version_no
        out.reason = `${docType === 'inspection_form' ? '此查驗的' : '該日'}${typeLabel}已${existing.status === 'signed' ? '簽署' : existing.status === 'in_review' ? '送內部核對' : '提送'},未變更;新照片請由人另開版本`
        setCand({ state: 'locked', document_id: existing.id, reason: out.reason })
        continue
      }

      // 證據聯集:候選推斷配到的本批照片(日誌類=該日全部;自檢表=該日該工項;查驗表單=日期或工項相符)∪ 既有版本的附件照片
      // (另一批上傳的證據不能因重跑而掉)
      const candPhotoIds = new Set(cand.photo_ids)
      const dayPhotos = dated.filter((d) => candPhotoIds.has(d.photo.id))
      const draftPhotos = new Map<string, DraftPhoto>(dayPhotos.map((d) => [d.photo.id, toDraftPhoto(d.photo, d.stored)]))
      let latest: VersionRow | null = null
      if (existing) {
        const latestRes = await repo.latestVersion(existing.id)
        if (isErr(latestRes)) throw new Error(latestRes.error)
        latest = latestRes
        const prevIds = Array.isArray(latest?.attachments)
          ? (latest!.attachments as { photo_id?: unknown }[]).map((a) => a?.photo_id).filter((id): id is string => typeof id === 'string' && !draftPhotos.has(id))
          : []
        if (prevIds.length) {
          const prevRows = await repo.listPhotosByIds(prevIds)
          if (!isErr(prevRows)) {
            for (const row of prevRows) {
              if (row.ai_status === 'not_site' || row.ai_status === 'unreadable' || row.ai_status === 'duplicate') continue
              draftPhotos.set(row.id, toDraftPhoto(row, readStored(row.ai_result)))
            }
          }
        }
      }
      const dateRefs = dayPhotos.filter((d) => d.ref).map((d) => d.ref!)
      const dateSource = dayPhotos.some((d) => d.source === 'whiteboard')
        ? { source: `whiteboard:${dayPhotos.find((d) => d.source === 'whiteboard')!.ref}`, refs: dateRefs }
        : dayPhotos.some((d) => d.source === 'intake') ? { source: 'intake', refs: [] } : { source: `photo_time:${dateRefs[0] ?? ''}`, refs: dateRefs }

      const draft = await buildDraftFor(cand, date, dateSource, [...draftPhotos.values()])
      out.pending_fields = draft.required_fields.filter((k) => draft.field_sources[k]?.status === 'pending')

      if (!existing) {
        const ins = await repo.insertDoc({
          doc_type: docType, doc_date: date, intake_id: intakeId, target_key: cand.target_key, status: draft.status,
          required_fields: draft.required_fields, recheck: draft.recheck, created_by: userId,
          ...(docType === 'self_check' || docType === 'inspection_form' ? { template_id: cand.template_id ?? null } : {}),
        })
        if (isErr(ins)) throw new Error(ins.error)
        if ('conflict' in ins) {
          // 兩個請求同時建同一份文件:唯一索引收口,輸的一方改走既有文件
          const again = await repo.findActiveDoc(docType, locatorOf(cand))
          if (isErr(again) || !again) throw new Error(isErr(again) ? again.error : '同日文件建立衝突後找不到既有文件,請重試')
          existing = again
          const latestRes = await repo.latestVersion(existing.id)
          latest = isErr(latestRes) ? null : latestRes
        } else {
          existing = ins
        }
      }
      out.document_id = existing.id

      if (latest && draftUnchanged({ content: latest.content, attachments: latest.attachments }, { content: draft.content, attachments: draft.attachments })) {
        out.action = 'unchanged'; out.version_no = latest.version_no; out.status = existing.status; out.reason = '重跑內容相同,未新增版本'
        setCand({ state: 'unchanged', document_id: existing.id })
        continue
      }
      const human = await repo.hasHumanVersion(existing.id)
      if (isErr(human)) throw new Error(human.error)
      if (human) {
        // 人已改過:不覆寫、不新增 AI 版本(DB guard 也會拒),只留建議供人套用
        const act = await repo.insertAgentAction({
          actor_user: userId, agent_role: intake.uploader_org, kind: 'suggest_field_update', target_table: 'field_documents', target_id: existing.id,
          summary: `新照片辨識結果可補入 ${date} ${typeLabel}(文件已有人工版本,未自動套用)`,
          rationale: draft.rationale,
          evidence: { intake_id: intakeId, document_id: existing.id, doc_type: docType, against_version_no: existing.current_version_no, suggestion: { content: draft.content, field_sources: draft.field_sources, attachments: draft.attachments } },
        })
        if (isErr(act)) throw new Error(act.error)
        out.action = 'suggested'; out.version_no = existing.current_version_no; out.status = existing.status
        out.reason = '文件已有人工版本,新辨識結果只作建議,未覆寫'
        setCand({ state: 'suggested', document_id: existing.id })
        continue
      }
      const nextNo = (latest?.version_no ?? existing.current_version_no) + 1
      const ver = await repo.insertVersion({
        document_id: existing.id, version_no: nextNo, content: draft.content, field_sources: draft.field_sources, attachments: draft.attachments,
        change_note: nextNo === 1 ? '系統依照片起稿' : '重新辨識後更新草稿',
      })
      if (isErr(ver)) throw new Error(ver.error)
      const upd = await repo.updateDoc(existing.id, { current_version_no: ver.version_no, status: draft.status, required_fields: draft.required_fields, recheck: draft.recheck })
      if (upd.error) throw new Error(upd.error)
      const act = await repo.insertAgentAction({
        actor_user: userId, agent_role: intake.uploader_org, kind: 'draft_field_document', target_table: 'field_documents', target_id: existing.id,
        summary: draft.summary, rationale: draft.rationale,
        evidence: { intake_id: intakeId, document_id: existing.id, doc_type: docType, version_no: ver.version_no, content_hash: ver.content_hash },
      })
      if (isErr(act)) throw new Error(act.error)
      out.action = nextNo === 1 ? 'created' : 'version_added'; out.version_no = ver.version_no; out.status = draft.status
      out.reason = draft.summary
      setCand({ state: 'drafted', document_id: existing.id })
    } catch (e) {
      docErrors++
      out.action = 'error'
      out.reason = (e as Error)?.message || '起稿寫入失敗,可重試'
      setCand({ state: 'error', reason: out.reason })
    }
  }

  // ── 5. 批次收尾 ─────────────────────────────────────────────────────────
  const c = counts()
  const inferredDates = [...new Set(dated.map((d) => d.date).filter((d): d is string => !!d))]
  const status = remaining > 0 ? 'recognizing' : (c.failed_count > 0 || docErrors > 0 ? 'partial' : 'ready')
  const errorSummary = [
    ...(c.failed_count ? [`${c.failed_count} 張辨識失敗,可重試`] : []),
    ...(docErrors ? [`${docErrors} 份文件起稿失敗,可重試`] : []),
    ...(candidates.some((x) => x.state === 'blocked') ? ['部分照片無法判定日期,請補批次日期後重試'] : []),
  ].join(';') || null
  const finish = await repo.finishIntake(intakeId, {
    status, ...c, candidates,
    ...(!intake.log_date && inferredDates.length === 1 ? { log_date: inferredDates[0] } : {}),
    error_summary: errorSummary, last_progress_at: iso(now()), run_started_at: null,
  })
  if (finish.error) return fail(500, 'db_error', finish.error, { photos: outcomeList(), documents })

  return {
    status: 200,
    body: {
      ok: true,
      intake: { id: intakeId, status, ...c, log_date: intake.log_date ?? (inferredDates.length === 1 ? inferredDates[0] : null), candidates, error_summary: errorSummary },
      photos: outcomeList(),
      documents,
      remaining,
      notes: [...notes, ...statusNotes()],
    },
  }
}
