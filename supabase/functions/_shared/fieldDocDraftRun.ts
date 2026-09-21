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
//      fail-closed)→ 不可辨=unreadable、非工地=not_site、有可讀的書面紀錄再跑 sitelog.whiteboard
//      (紙本表單再跑第二次並只留兩次一致的格子——手寫誤讀不穩定,不一致就留空待人填)
//      → 配工項(與前端同一支 matchLeaf)→ 只由 service 寫 photos.ai_*;caption／location／
//      work_item_id 只在原本為空時補,不覆蓋人填的。
//   4. 依上傳方推候選文書(純規則);逐份起稿(廠商→施工日誌＋每個配到工項的自主檢查表、監造→監造日誌,
//      同一段寫入邏輯,只有「找活文件」的鍵(日誌類=日期;自檢表=批次＋工項＋日期)與「湊內容」依類型不同):
//      活文件不存在→建立＋AI 版本 1;存在且無人工版本→內容有變才新增 AI 版本;已有人工版本→只留
//      suggest_field_update;已簽署／提送→不動(locked)。範本(監造日誌示範範本、自檢表示範框架)於執行期向
//      DB fn_field_document_template 取(repo.getFieldDocumentTemplate),Edge 不再維護鏡像常數。
//      同一張照片可掛多份文件附件,數量只在確認量表計一次(P4)。
//   5. 批次狀態:remaining>0→recognizing(等續跑);有失敗→partial;否則 ready。
//
// 表內上傳(2026-09-21;輸入多帶 target_document_id):使用者在施工日誌／自主檢查表**表單內**按「上傳照片,AI 填表」。
//   第 1–3 步照舊(閘門、角色、認領、逐張辨識),但第 4 步**不推候選、不建其他文件、不寫版本**——只為那一份目標文件
//   湊一份草稿並留一筆 suggest_field_update(evidence.suggestion 與既有建議同形狀),回應多帶 target 由前端合併進畫面上
//   的表單(只補空白欄,人填的不覆蓋;存檔後才成為版本)。目標必須是本案、daily_log／self_check、責任方＝上傳方、
//   狀態仍可編(已簽署／提送 409,請人先建立更正版本)。同內容(同 sha)照片本案已辨識過的直接沿用結果、不再呼叫模型。

import type {
  Candidate, ChecklistTemplateRow, DayDefect, DayInspection, DocType, DraftPhoto, FieldDocDraft, FormalDailyLog, LeafWorkItem, LegacyDailyLog,
  OpenInspection, PhotoAiStatus,
} from './fieldDocDraft.ts'
import {
  assignPhotoDate, buildDailyLogDraft, buildInspectionFormDraft, buildSelfCheckDraft, buildSupervisorLogDraft, draftUnchanged, duplicateGroups,
  inferCandidates, mergeCandidateExclusions, previousDate, validDate, FIELD_DOC_TYPE_LABELS,
} from './fieldDocDraft.ts'
import type { FieldDocTemplate } from './fieldDocTemplate.ts'
import { matchLeaf } from './photoMatch.ts'
import { agreeRecords, groundedLocation, hasWrittenRecord, needsPaperCells, needsSecondPass, normalizeSitePhotoResult, normalizeWhiteboardResult } from './sitePhotoVision.ts'
import type { SitePhotoResult, WhiteboardResult } from './sitePhotoVision.ts'
import { hasCellObservations, runPaperFormCells } from './paperFormCells.ts'
import type { PaperCellsResult } from './paperFormCells.ts'
import { COLUMN_BOUNDARY_RETRY_SHIFT_RATIO } from './paperFormLayout.ts'
import type { TileColumn } from './paperFormLayout.ts'
import type { PreparedTiles } from './paperFormImaging.ts'
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
// 表內上傳的目標文件:多帶類型、日期、責任方(DB generated column,不信任前端)與自檢表範本
export type TargetDocRow = DocRow & { doc_type: string; doc_date: string; owner_org: string; target_key: string | null; template_id: string | null }
// 表內上傳可填的文件狀態(與前端頁面的 EDITABLE_STATUSES 同一份口徑;已簽署／提送／收件要人先建立更正版本)
export const TARGET_OPEN_STATUSES: readonly string[] = ['draft', 'pending_input', 'in_review', 'returned']
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
  // Agent 對話起稿(P6b-2):本案拍攝時間落在該台北日曆日的照片(可限工項);不分批次、RLS 讀
  listPhotosTakenOn(date: string, workItemId?: string | null): Promise<IntakePhotoRow[] | RepoError>
  // 本案已辨識(done／not_site／unreadable)且同內容雜湊的照片(表內上傳沿用辨識結果,不再打模型;呼叫端自行排除本批的列)
  listRecognizedPhotosBySha(shas: string[]): Promise<IntakePhotoRow[] | RepoError>
  // 表內上傳的目標文件(RLS 讀;不在本案或無權限=null)
  getDocumentById(docId: string): Promise<TargetDocRow | null | RepoError>
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
  // 照片起稿帶批次與冪等鍵;Agent 對話起稿沒有批次(intake_id=null;日誌類 target_key=null,自檢表 target_key=agent:…)
  insertDoc(row: { doc_type: string; doc_date: string; intake_id: string | null; target_key: string | null; status: string; required_fields: unknown; recheck: unknown; created_by: string; template_id?: string | null }): Promise<DocRow | { conflict: true } | RepoError>
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
  // 2026-09-20 B2:紙表逐格辨識(獨立 AI 功能 paperform.cells,獨立閘門與用量)。
  // 沒有注入時整條逐格路徑不啟用,退回 B 的「整張圖讀兩次」。
  readCells?(base64: string, mime: string, columnHint: string): Promise<VisionResult<unknown>>
}
/** 影像切塊(唯一需要真正解碼 JPEG 的注入點;測試用假物件即可,執行流程不 import npm)。 */
export interface DraftImaging {
  paperFormTiles(base64: string, mime: string, opts?: { boundaryShift?: number; columns?: TileColumn[] }): PreparedTiles
}

export type RunInput = {
  repo: DraftRepo
  vision: DraftVision
  imaging?: DraftImaging
  intakeId: string
  userId: string
  now?: () => number
  budgetMs?: number
  concurrency?: number
  staleMs?: number
  // 明確要求重新辨識的照片(使用者在批次頁按「重新辨識」;伺服器只認這一批內的 id)。
  // 2026-09-20 B:辨識規則改版後,已辨識過的照片不會自動重跑(會重複計費),但要有一條
  // 明確的路可以更新,不能永遠卡在舊快取。重跑只改 photos.ai_*;人填過的說明／位置不覆寫,
  // 已有人工版本或已簽署的文件仍走 suggested／locked,不會被覆寫。
  rerecognizePhotoIds?: string[]
  // 表內上傳:只為這一份文件湊草稿並留建議(不推候選、不建其他文件、不寫版本);見檔頭
  targetDocumentId?: string
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

export type StoredAiResult = {
  classify: SitePhotoResult | null
  whiteboard: WhiteboardResult | null
  whiteboard_skipped: string | null
  // B2:紙表逐格辨識沒跑或沒採用的原因(揭露用;null=沒有這一步或已採用)
  paper_cells_skipped?: string | null
  match: { work_item_id: string | null; hint: string | null }
  duplicate_of?: string
  error?: string
}

// photos.ai_result 讀回:形狀由 normalize* 驗,不合就當沒有(重跑會重新辨識)。Agent 對話起稿(P6b-2)讀同一份辨識結果。
export function readStored(raw: unknown): StoredAiResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const classify = normalizeSitePhotoResult(r.classify)
  if (!classify) return null
  const match = (r.match && typeof r.match === 'object') ? r.match as Record<string, unknown> : {}
  return {
    classify,
    whiteboard: normalizeWhiteboardResult(r.whiteboard),
    whiteboard_skipped: typeof r.whiteboard_skipped === 'string' ? r.whiteboard_skipped : null,
    paper_cells_skipped: typeof r.paper_cells_skipped === 'string' ? r.paper_cells_skipped : null,
    match: {
      work_item_id: typeof match.work_item_id === 'string' ? match.work_item_id : null,
      hint: typeof match.hint === 'string' ? match.hint : null,
    },
  }
}

/**
 * 逐格辨識結果併回整張圖的轉錄結果(B2)。
 * * 逐格有讀到東西 → **observations 整批換成逐格的**(每一筆都帶原圖座標);整張圖那一份
 *   observations 是同一件事的較差版本,留著只會出現兩套說法。表頭欄位(日期／位置／表上工項)
 *   仍來自整張圖那一支——那些欄位本來就讀得準,而且不在任何一欄裡面。
 * * 逐格沒讀到(或不成立) → 保留整張圖的結果,只把原因附進 dropped 讓人看得到。
 * * 整張圖那一支失敗但逐格成功 → 用逐格結果補一份最小紀錄,不要把讀到的實測值丟掉。
 */
export function applyPaperCells(whiteboard: WhiteboardResult | null, cells: PaperCellsResult): WhiteboardResult | null {
  const used = hasCellObservations(cells)
  if (!whiteboard) {
    if (!used) return null
    return {
      record_medium: 'paper_form', log_date: '', log_date_text: '', log_date_conflict: null,
      weather: '', location: '', location_text: '', work_item_text: '', work_summary: '',
      observations: cells.observations, items: [], dropped: [...cells.dropped],
    }
  }
  return {
    ...whiteboard,
    observations: used ? cells.observations : whiteboard.observations,
    dropped: [...whiteboard.dropped, ...cells.dropped],
  }
}

// 各類文書的業務日期欄(待確認清單用)
const DOC_DATE_KEY: Record<string, string> = { daily_log: 'log_date', supervisor_log: 'log_date', self_check: 'check_date', inspection_form: 'inspection_date' }

// 表內上傳的自檢表沒指定工項時,用本批照片配到的工項多數決;平手或沒有 → null(留空待人選,不猜)
export function majorityWorkItem(ids: (string | null | undefined)[]): string | null {
  const count = new Map<string, number>()
  for (const id of ids) if (id) count.set(id, (count.get(id) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  let tie = false
  for (const [id, n] of count) {
    if (n > bestN) { best = id; bestN = n; tie = false } else if (n === bestN) tie = true
  }
  return tie ? null : best
}

// 照片列＋已存辨識結果 → 起稿用照片(照片起稿與 Agent 對話起稿同一支)
export const toDraftPhoto = (p: IntakePhotoRow, s: StoredAiResult | null): DraftPhoto => ({
  id: p.id, storage_path: p.storage_path, content_sha256: p.content_sha256, work_item_id: p.work_item_id,
  caption: p.caption, location: p.location, taken_at: p.taken_at, created_at: p.created_at,
  classify: s?.classify ?? null, whiteboard: s?.whiteboard ?? null, whiteboardSkipped: s?.whiteboard_skipped ?? null,
})

// 證據聯集:既有版本附件裡、這次沒帶到的照片也要留著(另一批上傳或另一次起稿的證據不能因重跑而掉);
// 非工地／不可辨／重複照片不併入。就地加進 draftPhotos。
export async function unionPriorAttachments(repo: DraftRepo, latest: VersionRow | null, draftPhotos: Map<string, DraftPhoto>): Promise<void> {
  const prevIds = Array.isArray(latest?.attachments)
    ? (latest!.attachments as { photo_id?: unknown }[]).map((a) => a?.photo_id).filter((id): id is string => typeof id === 'string' && !draftPhotos.has(id))
    : []
  if (!prevIds.length) return
  const prevRows = await repo.listPhotosByIds(prevIds)
  if (isErr(prevRows)) return
  for (const row of prevRows) {
    if (row.ai_status === 'not_site' || row.ai_status === 'unreadable' || row.ai_status === 'duplicate') continue
    draftPhotos.set(row.id, toDraftPhoto(row, readStored(row.ai_result)))
  }
}

// ── 草稿寫入(照片起稿與 Agent 對話起稿共用同一段;設計 field-documents-lifecycle §3.1):
// 活文件不存在→建立(撞唯一索引改走既有)＋AI 版本;內容與最新版本相同→不加版本;已有人工版本→只留
// suggest_field_update(DB guard 也拒 AI 寫版本);否則新增 AI 版本並留一筆 agent_actions(target=該文件)。
// 鎖定(已簽署／提送)由呼叫端在湊內容前判斷——鎖定的文件連內容都不必湊。失敗一律 throw(呼叫端決定怎麼揭露)。
export type DraftWriteOrigin = {
  agentRole: string
  actionKind: string                       // 新版本時留的 agent_actions.kind(照片起稿 draft_field_document;對話起稿 draft_daily_log／draft_inspection)
  evidence: Record<string, unknown>        // 併入 agent_actions.evidence(來源識別:intake_id 或對話起稿的顯示資料)
  suggestSummary: string                   // 已有人工版本時建議的摘要
  changeNote: (versionNo: number) => string
}
export type DraftWriteResult = {
  action: 'created' | 'version_added' | 'unchanged' | 'suggested'
  document_id: string
  version_no: number
  status: string
  reason: string
  agent_action_id: string | null
}
export async function writeDraftDocument(repo: DraftRepo, p: {
  docType: string
  locator: DocLocator
  existing: DocRow | null
  latest: VersionRow | null
  insert: { doc_date: string; intake_id: string | null; target_key: string | null; template_id?: string | null }
  draft: FieldDocDraft
  userId: string
  origin: DraftWriteOrigin
}): Promise<DraftWriteResult> {
  const { docType, draft, userId, origin } = p
  let existing = p.existing
  let latest = p.latest
  if (!existing) {
    const ins = await repo.insertDoc({
      doc_type: docType, doc_date: p.insert.doc_date, intake_id: p.insert.intake_id, target_key: p.insert.target_key, status: draft.status,
      required_fields: draft.required_fields, recheck: draft.recheck, created_by: userId,
      ...(docType === 'self_check' || docType === 'inspection_form' ? { template_id: p.insert.template_id ?? null } : {}),
    })
    if (isErr(ins)) throw new Error(ins.error)
    if ('conflict' in ins) {
      // 兩個請求同時建同一份文件:唯一索引收口,輸的一方改走既有文件
      const again = await repo.findActiveDoc(docType, p.locator)
      if (isErr(again) || !again) throw new Error(isErr(again) ? again.error : '同日文件建立衝突後找不到既有文件,請重試')
      existing = again
      const latestRes = await repo.latestVersion(existing.id)
      latest = isErr(latestRes) ? null : latestRes
    } else {
      existing = ins
    }
  }

  if (latest && draftUnchanged({ content: latest.content, attachments: latest.attachments }, { content: draft.content, attachments: draft.attachments })) {
    return { action: 'unchanged', document_id: existing.id, version_no: latest.version_no, status: existing.status, reason: '重跑內容相同,未新增版本', agent_action_id: null }
  }
  const human = await repo.hasHumanVersion(existing.id)
  if (isErr(human)) throw new Error(human.error)
  if (human) {
    // 人已改過:不覆寫、不新增 AI 版本(DB guard 也會拒),只留建議供人套用
    const act = await repo.insertAgentAction({
      actor_user: userId, agent_role: origin.agentRole, kind: 'suggest_field_update', target_table: 'field_documents', target_id: existing.id,
      summary: origin.suggestSummary,
      rationale: draft.rationale,
      evidence: { ...origin.evidence, document_id: existing.id, doc_type: docType, against_version_no: existing.current_version_no, suggestion: { content: draft.content, field_sources: draft.field_sources, attachments: draft.attachments } },
    })
    if (isErr(act)) throw new Error(act.error)
    return { action: 'suggested', document_id: existing.id, version_no: existing.current_version_no, status: existing.status, reason: '文件已有人工版本,新內容只作建議,未覆寫', agent_action_id: act.id }
  }
  const nextNo = (latest?.version_no ?? existing.current_version_no) + 1
  const ver = await repo.insertVersion({
    document_id: existing.id, version_no: nextNo, content: draft.content, field_sources: draft.field_sources, attachments: draft.attachments,
    change_note: origin.changeNote(nextNo),
  })
  if (isErr(ver)) throw new Error(ver.error)
  const upd = await repo.updateDoc(existing.id, { current_version_no: ver.version_no, status: draft.status, required_fields: draft.required_fields, recheck: draft.recheck })
  if (upd.error) throw new Error(upd.error)
  const act = await repo.insertAgentAction({
    actor_user: userId, agent_role: origin.agentRole, kind: origin.actionKind, target_table: 'field_documents', target_id: existing.id,
    summary: draft.summary, rationale: draft.rationale,
    evidence: { ...origin.evidence, document_id: existing.id, doc_type: docType, version_no: ver.version_no, content_hash: ver.content_hash },
  })
  if (isErr(act)) throw new Error(act.error)
  return { action: nextNo === 1 ? 'created' : 'version_added', document_id: existing.id, version_no: ver.version_no, status: draft.status, reason: draft.summary, agent_action_id: act.id }
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

  // ── 1b. 表內上傳的目標文件:認領前先驗(驗不過就不動批次,前端可修正後重送)──────────
  // 責任方讀 DB generated column(owner_org 由 doc_type 決定),與上傳方比對——監造文件永遠不會從廠商批次冒出來。
  let target: TargetDocRow | null = null
  if (input.targetDocumentId) {
    const t = await repo.getDocumentById(input.targetDocumentId)
    if (isErr(t)) return fail(500, 'db_error', t.error)
    if (!t) return fail(404, 'target_not_found', '找不到要填入的文件(可能不在本案、已捨棄或無權限)')
    if (t.doc_type !== 'daily_log' && t.doc_type !== 'self_check') return fail(400, 'target_unsupported', '表內上傳只支援施工日誌與自主檢查表')
    if (t.owner_org !== intake.uploader_org) return fail(403, 'target_org_mismatch', '這份文件的責任方與上傳方不同,不能由這批照片填入')
    if (!TARGET_OPEN_STATUSES.includes(t.status)) {
      const word = t.status === 'signed' ? '簽署' : t.status === 'received' ? '被收件' : '提送'
      return fail(409, 'target_locked', `這份${FIELD_DOC_TYPE_LABELS[t.doc_type as keyof typeof FIELD_DOC_TYPE_LABELS]}已${word},內容已鎖定;請先建立更正版本再上傳照片`)
    }
    target = t
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
  // 使用者明確要求重辨識的照片視同未辨識(重複照片仍不重跑:正本重辨識即可)
  const redo = new Set((input.rerecognizePhotoIds ?? []).filter((id) => photos.some((p) => p.id === id) && !dups.has(id)))
  if (redo.size) notes.push(`${redo.size} 張照片依你的要求重新辨識(會重新計費);人工填過的說明與位置不會被覆寫`)
  const work = photos.filter((p) => !dups.has(p.id) && (redo.has(p.id) || p.ai_status == null || p.ai_status === 'pending' || p.ai_status === 'failed'))
  const terminal = photos.filter((p) => !dups.has(p.id) && !redo.has(p.id) && (p.ai_status === 'done' || p.ai_status === 'not_site' || p.ai_status === 'unreadable'))
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
  let cellsBlocked = false
  let remaining = 0

  // 辨識結果落地(新辨識與沿用快取同一段):狀態由分類結果決定;工項用**目前**標單重配;說明／位置／工項只補空欄、
  // 不覆蓋人填的;非工地／不可辨的照片不套說明、不配工項;被佐證凍結 guard 擋下改掛時只寫辨識結果並揭露。
  type Recognition = { classify: SitePhotoResult; whiteboard: WhiteboardResult | null; whiteboardSkipped: string | null; cellsSkipped: string | null }
  const persistRecognition = async (p: IntakePhotoRow, rec: Recognition): Promise<void> => {
    const { classify, whiteboard } = rec
    let status: PhotoAiStatus = 'done'
    if (!classify.legible) status = 'unreadable'
    else if (!classify.is_construction) status = 'not_site'
    const hint = status === 'done' ? classify.work_item_hint : ''
    const wi = status === 'done' && hint && hasBoq ? matchLeaf(hint, leaves) : null
    const result: StoredAiResult = {
      classify, whiteboard, whiteboard_skipped: rec.whiteboardSkipped, paper_cells_skipped: rec.cellsSkipped,
      match: { work_item_id: p.work_item_id ?? wi?.id ?? null, hint: hint || null },
    }
    const patch: PhotoAiPatch = {
      ai_status: status, ai_result: result, ai_run_at: iso(now()),
      work_item_hint: status === 'done' && !p.work_item_id && !wi && hint ? hint : null,
    }
    if (status === 'done') {
      if (!p.caption && classify.caption) patch.caption = classify.caption
      // 位置只寫有原文佐證的:轉錄讀到的位置優先,分類推測且與轉錄矛盾的一律不落地
      const loc = groundedLocation(classify, whiteboard).value
      if (!p.location && loc) patch.location = loc
      if (!p.work_item_id && wi) patch.work_item_id = wi.id
    } else if (status === 'not_site' && !p.caption) {
      patch.caption = '(AI 判讀:疑似非工地照片,請人工確認)'
    }
    let r = await repo.updatePhoto(p.id, patch)
    if (r.error && r.code === 'P0001') {
      notes.push(`照片 ${p.id.slice(0, 8)} 已為估驗佐證,未改掛工項:${r.error}`)
      r = await repo.updatePhoto(p.id, { ai_status: status, ai_result: result, ai_run_at: patch.ai_run_at, work_item_hint: patch.work_item_hint })
    }
    if (r.error) { setOutcome(p, 'failed', { error: r.error }); return }
    stored.set(p.id, result)
    if (patch.work_item_id) p.work_item_id = patch.work_item_id
    if (patch.caption) p.caption = patch.caption
    if (patch.location) p.location = patch.location
    setOutcome(p, status, { work_item_id: p.work_item_id, work_item_hint: patch.work_item_hint ?? null, caption: p.caption, location: p.location })
  }

  // ── 同內容照片沿用辨識結果(2026-09-21 表內上傳:已上傳過的照片也能引用填表)────────────
  // 本案別批已辨識過的同雜湊照片:直接沿用其分類與轉錄結果寫進這張照片的 ai_*,不呼叫模型、不記用量
  // (用量只在 index.ts 的呼叫器記,這裡根本不呼叫);工項配對用目前標單重算。使用者明確要求重新辨識的不沿用。
  let reused = 0
  const cacheable = work.filter((p) => !redo.has(p.id) && p.content_sha256)
  if (cacheable.length) {
    const priorRes = await repo.listRecognizedPhotosBySha([...new Set(cacheable.map((p) => p.content_sha256!))])
    if (isErr(priorRes)) notes.push(`查詢同內容照片的既有辨識結果失敗,改為重新辨識:${priorRes.error}`)
    else {
      const own = new Set(photos.map((p) => p.id))
      const bySha = new Map<string, StoredAiResult>()
      for (const row of priorRes) {
        if (own.has(row.id) || !row.content_sha256 || bySha.has(row.content_sha256)) continue
        if (row.ai_status !== 'done' && row.ai_status !== 'not_site' && row.ai_status !== 'unreadable') continue
        const s = readStored(row.ai_result)
        if (s) bySha.set(row.content_sha256, s)
      }
      for (const p of cacheable) {
        const s = bySha.get(p.content_sha256!)
        if (!s?.classify) continue
        await persistRecognition(p, { classify: s.classify, whiteboard: s.whiteboard, whiteboardSkipped: s.whiteboard_skipped, cellsSkipped: s.paper_cells_skipped ?? null })
        reused++
      }
      if (reused) notes.push(`${reused} 張沿用先前同內容照片的辨識結果(未重新呼叫模型)`)
    }
  }
  const toRecognize = work.filter((p) => !outcomes.has(p.id))

  // ── B2 紙表逐格辨識:切塊 → 每塊讀兩次 → 兩次一致才採用 → 併塊 ────────────
  // 任何一步不成立都回 skipped 原因,呼叫端退回整張圖一次讀的 B 路徑;不硬切、不猜。
  const readPaperCells = async (base64: string, mime: string): Promise<{ cells: PaperCellsResult | null; skipped: string | null }> => {
    if (cellsBlocked) return { cells: null, skipped: 'feature_disabled' }
    const imaging = input.imaging
    const readCells = vision.readCells
    if (!imaging || !readCells) return { cells: null, skipped: 'unavailable' }
    const r = await runPaperFormCells({
      tiles: (o) => imaging.paperFormTiles(base64, mime, o),
      read: async (t, hint) => {
        const res = await readCells(t.base64, t.mime, hint)
        if ('blocked' in res) { cellsBlocked = true; return { blocked: true } }
        return res
      },
      retryShift: COLUMN_BOUNDARY_RETRY_SHIFT_RATIO,
    })
    return { cells: r.cells, skipped: r.skipped }
  }
  await mapWithConcurrency(toRecognize, concurrency, async (p) => {
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
    let cells: PaperCellsResult | null = null
    let cellsSkipped: string | null = null
    // B2 逐格辨識(只對紙本表單):先切塊、逐欄各讀兩次;成功就由它提供 observations,
    // 整張圖那一支退回只讀一次(負責表頭:日期、位置、表上工項)。
    // 這一步的條件比整張轉錄寬:整張看起來字太小(text_legible=false)的紙表,切成單欄放大後
    // 常常讀得清楚(見 needsPaperCells 註解),不能拿整張圖的可辨識度否決切塊後的結果。
    if (status === 'done' && needsPaperCells(classify)) {
      const r = await readPaperCells(dl.base64, dl.mime)
      cells = r.cells
      cellsSkipped = r.skipped
    }
    // 整張轉錄:紙本查驗表與黑白板同一支(2026-09-20 起 has_board 語意含紙本表單);
    // 場景看得清但字跡／刻度讀不出來(text_legible=false)就不轉錄——看得到鋼筋不等於讀得出卡尺。
    if (status === 'done' && hasWrittenRecord(classify)) {
      if (boardBlocked) whiteboardSkipped = 'feature_disabled'
      else {
        const wb = await vision.readBoard(dl.base64, dl.mime)
        if ('blocked' in wb) { boardBlocked = true; whiteboardSkipped = 'feature_disabled' }
        else if ('error' in wb) whiteboardSkipped = `failed:${wb.errorCode}`
        else {
          whiteboard = normalizeWhiteboardResult(wb.data)
          if (!whiteboard) whiteboardSkipped = 'failed:invalid_output'
          // 紙本表單一律再讀一次整張,只留兩次一致的內容:逐格接手了 observations,
          // 但表頭(手寫的民國年日期)仍由這一支負責,單讀一次曾把 115 讀成 114。
          // 第二次沒讀成(停用／錯誤／輸出不完整)=沒有比對過:第一次的表頭日期、位置與整張觀察**一律不採用**,
          // 不能冒充已核對的內容(2026-09-21 核對 G 包);逐格那一支自己有兩次一致,下面照常併回。
          else if (needsSecondPass(classify)) {
            const wb2 = await vision.readBoard(dl.base64, dl.mime)
            if ('blocked' in wb2) { boardBlocked = true; whiteboard = null; whiteboardSkipped = 'second_pass:feature_disabled' }
            else if ('error' in wb2) { whiteboard = null; whiteboardSkipped = `second_pass_failed:${wb2.errorCode}` }
            else {
              const second = normalizeWhiteboardResult(wb2.data)
              if (second) whiteboard = agreeRecords(whiteboard, second)
              else { whiteboard = null; whiteboardSkipped = 'second_pass_failed:invalid_output' }
            }
          }
        }
      }
    }
    // 逐格結果併回(整張轉錄沒跑或失敗時,逐格讀到的實測值也不能掉)
    if (cells) whiteboard = applyPaperCells(whiteboard, cells)
    await persistRecognition(p, { classify, whiteboard, whiteboardSkipped, cellsSkipped })
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
    if (d.conflict && d.source !== 'upload_time') notes.push(`照片 ${p.id.slice(0, 8)}:${d.conflict}`)
    if (s.whiteboard_skipped?.startsWith('second_pass')) {
      notes.push(`照片 ${p.id.slice(0, 8)}:紙表第二次比對辨識未完成,表頭日期、位置與整張轉錄內容未採用(逐格讀到且兩次一致的實測值仍保留);可對這張照片重新辨識`)
    }
    return { photo: p, stored: s, ...d }
  })
  const byUpload = dated.filter((d) => d.source === 'upload_time')
  if (byUpload.length) {
    notes.push(`${byUpload.length} 張照片沒有拍攝時間、也沒有讀到紙上日期,暫以上傳日 ${[...new Set(byUpload.map((d) => d.date))].join('、')} 起稿;日期不對請捨棄後指定日期重新上傳`)
  }
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
    if (cellsBlocked) out.push('紙表逐格辨識功能未啟用,紙上實測值改由整張辨識判讀,讀不穩的格子會留空待人填')
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
  // 表內上傳不推候選(只填指定文件);一般批次照舊由確定性規則推
  let candidates: Candidate[] = target ? [] : mergeCandidateExclusions(intake.candidates, inferCandidates({
    uploaderOrg: intake.uploader_org,
    sitePhotos: dated.map((d) => ({ id: d.photo.id, date: d.date, work_item_id: d.photo.work_item_id })),
    openInspections, workItems: leaves, checklistTemplates,
  }))

  const documents: DocumentOutcome[] = []
  let docErrors = 0
  let targetBody: Record<string, unknown> | null = null

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

  // ── 4b. 表內上傳:只為目標文件湊草稿、只留建議(不寫版本;前端合併進表單,存檔後才是版本)────────
  // 全部辨識完才湊(remaining>0 先回續跑,免得每輪各留一筆建議)。批次 candidates 記一筆代表這份目標,
  // /site 的「上傳批次」才看得懂這批照片去了哪裡。
  if (target) {
    const docType = target.doc_type as DocType
    const typeLabel = FIELD_DOC_TYPE_LABELS[docType]
    const date = target.doc_date
    const cand: Candidate = {
      doc_type: docType, target_key: `document:${target.id}`, doc_date: date, state: 'ready', support: 'supported',
      reason: `表內上傳:填入指定的${typeLabel}(${date})`, excluded: false, photo_ids: dated.map((d) => d.photo.id), document_id: target.id,
      ...(docType === 'self_check' ? { template_id: target.template_id ?? null } : {}),
    }
    if (remaining === 0) {
      const out: DocumentOutcome = { doc_type: docType, doc_date: date, document_id: target.id, version_no: target.current_version_no, status: target.status, action: 'error', reason: null, pending_fields: [] }
      documents.push(out)
      try {
        // 日誌:目標文件的日期為準,本批所有已辨識的工地照片都納入;照片推得的日期不同的仍納入,但明寫並列待確認,不默默丟掉
        const mismatched = dated.filter((d) => d.date && d.date !== date)
        const mismatchNote = mismatched.length
          ? `${mismatched.length} 張照片推得的日期(${[...new Set(mismatched.map((d) => d.date))].join('、')})與文件日期 ${date} 不同,仍已納入本份文件;請確認文件日期是否正確`
          : null
        if (mismatchNote) notes.push(mismatchNote)
        const latestRes = await repo.latestVersion(target.id)
        if (isErr(latestRes)) throw new Error(latestRes.error)
        const latest = latestRes
        const draftPhotos = new Map<string, DraftPhoto>(dated.map((d) => [d.photo.id, toDraftPhoto(d.photo, d.stored)]))
        await unionPriorAttachments(repo, latest, draftPhotos)
        // 文件日期是人在表上定的,不由照片推;來源標明取自這份文件
        const dateSource = { source: `document:${target.id}`, refs: [] as string[] }
        let draft: FieldDocDraft
        if (docType === 'self_check') {
          const template = (checklistTemplates ?? []).find((t) => t.id === target!.template_id) ?? null
          if (!template) throw new Error('這份自主檢查表的檢查表範本已不存在或讀不到,請在表上重選範本並存檔後再試')
          // 工項:目標文件已填的優先;沒有就用本批照片配到的工項多數決(平手或沒有→留空待人選)
          const latestWid = (latest?.content as { work_item_id?: unknown } | null)?.work_item_id
          const wid = typeof latestWid === 'string' && latestWid ? latestWid : majorityWorkItem(dated.map((d) => d.photo.work_item_id))
          const workItem = wid ? leaves.find((w) => w.id === wid) ?? null : null
          draft = buildSelfCheckDraft({
            date, dateSource, photos: [...draftPhotos.values()], workItem, template, templateReason: '這份文件指定的範本',
            frame: await templateFor('self_check'), hasBoq, notes: statusNotes(),
          })
        } else {
          const [weather, sameDayRes, yesterdayRes] = await Promise.all([repo.fetchWeather(date), repo.getDailyLog(date), repo.getDailyLog(previousDate(date))])
          draft = buildDailyLogDraft({
            date, dateSource, photos: [...draftPhotos.values()], workItems: leaves,
            sameDayLog: isErr(sameDayRes) ? null : sameDayRes, yesterdayLog: isErr(yesterdayRes) ? null : yesterdayRes,
            weather, hasBoq, notes: statusNotes(),
          })
        }
        if (mismatchNote) draft.recheck.push({ key: DOC_DATE_KEY[docType], reason: mismatchNote })
        out.pending_fields = draft.required_fields.filter((k) => draft.field_sources[k]?.status === 'pending')
        const suggestion = { content: draft.content, field_sources: draft.field_sources, attachments: draft.attachments }
        const act = await repo.insertAgentAction({
          actor_user: userId, agent_role: intake.uploader_org, kind: 'suggest_field_update', target_table: 'field_documents', target_id: target.id,
          summary: `照片辨識結果可填入 ${date} ${typeLabel}(表內上傳;只補空白欄,由你核對後存檔)`,
          rationale: draft.rationale,
          evidence: { intake_id: intakeId, origin: 'in_form', document_id: target.id, doc_type: docType, against_version_no: target.current_version_no, suggestion },
        })
        if (isErr(act)) throw new Error(act.error)
        out.action = 'suggested'
        out.reason = '辨識結果已作為建議合併進表單(只補空白欄);存檔後才成為版本'
        cand.state = 'suggested'
        targetBody = { document_id: target.id, agent_action_id: act.id, suggestion, pending_fields: out.pending_fields, recheck: draft.recheck, notes: mismatchNote ? [mismatchNote] : [] }
      } catch (e) {
        docErrors++
        out.action = 'error'
        out.reason = (e as Error)?.message || '起稿寫入失敗,可重試'
        cand.state = 'error'
        cand.reason = out.reason
      }
    }
    candidates = [cand]
  }

  for (const cand of candidates) {
    if (target) break
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
      const existing = existingRes
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
        await unionPriorAttachments(repo, latest, draftPhotos)
      }
      const dateRefs = dayPhotos.filter((d) => d.ref).map((d) => d.ref!)
      const dateSource = dayPhotos.some((d) => d.source === 'whiteboard')
        ? { source: `whiteboard:${dayPhotos.find((d) => d.source === 'whiteboard')!.ref}`, refs: dateRefs }
        : dayPhotos.some((d) => d.source === 'intake') ? { source: 'intake', refs: [] }
        : dayPhotos.some((d) => d.source === 'photo_time')
          ? { source: `photo_time:${dayPhotos.find((d) => d.source === 'photo_time')!.ref}`, refs: dateRefs }
          : { source: `upload_time:${dateRefs[0] ?? ''}`, refs: dateRefs }

      const draft = await buildDraftFor(cand, date, dateSource, [...draftPhotos.values()])
      // 文件日期只有上傳日可依:在文件的待確認清單明寫(批次說明之外,打開文件也看得到)
      if (dateSource.source.startsWith('upload_time:')) {
        draft.recheck.push({ key: DOC_DATE_KEY[docType], reason: `這份文件的日期 ${date} 是照片上傳日(照片沒有拍攝時間、紙上也沒讀到日期),請確認;日期不對請捨棄後指定日期重新上傳` })
      }
      out.pending_fields = draft.required_fields.filter((k) => draft.field_sources[k]?.status === 'pending')

      const res = await writeDraftDocument(repo, {
        docType, locator: locatorOf(cand), existing, latest,
        insert: { doc_date: date, intake_id: intakeId, target_key: cand.target_key, template_id: cand.template_id ?? null },
        draft, userId,
        origin: {
          agentRole: intake.uploader_org, actionKind: 'draft_field_document', evidence: { intake_id: intakeId },
          suggestSummary: `新照片辨識結果可補入 ${date} ${typeLabel}(文件已有人工版本,未自動套用)`,
          changeNote: (n) => (n === 1 ? '系統依照片起稿' : '重新辨識後更新草稿'),
        },
      })
      out.document_id = res.document_id; out.version_no = res.version_no; out.status = res.status; out.action = res.action
      out.reason = res.action === 'suggested' ? '文件已有人工版本,新辨識結果只作建議,未覆寫' : res.reason
      setCand({ state: res.action === 'unchanged' ? 'unchanged' : res.action === 'suggested' ? 'suggested' : 'drafted', document_id: res.document_id })
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
      ...(targetBody ? { target: targetBody } : {}),
    },
  }
}
