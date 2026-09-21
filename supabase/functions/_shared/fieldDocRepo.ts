// draft-field-documents 的 Supabase 存取層(DraftRepo 的實作;流程在 fieldDocDraftRun.ts)。
// ---------------------------------------------------------------------------
// 讀一律走 userClient(RLS 決定看得到的批次、照片、標單、既有日誌、文件);寫只用 serviceClient,
// 且只寫設計 §3.1 允許的四處:photos.ai_*（含補空的 caption／location／work_item_id)、
// photo_intakes 進度、field_documents／_versions 的 AI 版本、agent_actions。
// 業務規則不在這裡:DB 的 guard(有人工版本後 AI 不得寫版本、版本不可變、雜湊由 DB 算、
// 批次上傳方=文件責任方)是安全邊界,這裡的錯誤只經 maskDbError 遮罩後回給流程層。
// 只有 type import 來自 npm:,vitest 不會載到 runtime 依賴。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { maskDbError } from './publicError.ts'
import { fetchAllRows } from './integrityAuditTool.ts'
import type { DraftRepo, IntakePhotoRow, IntakeRow, DocRow, VersionRow, RepoError } from './fieldDocDraftRun.ts'
import type { ChecklistTemplateRow, DayDefect, DayInspection, FormalDailyLog, LeafWorkItem, LegacyDailyLog, OpenInspection } from './fieldDocDraft.ts'
import type { FieldDocTemplate } from './fieldDocTemplate.ts'
import { taipeiDayRange } from './fieldDocDraft.ts'
import { normalizeCqKey } from './fieldDocTemplate.ts'

const PHOTO_COLS = 'id, storage_path, content_sha256, ai_status, ai_result, work_item_id, caption, location, taken_at, created_at'
const err = (scope: string, e: { message?: string; code?: string; details?: string; hint?: string } | null): RepoError =>
  ({ error: maskDbError(`draft-field-documents.${scope}`, e).message })

// Blob → base64(分段 btoa;不引入 jsr:@std 以維持 deno.lock --frozen)
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

// 可計價末端工項(與前端 boqCalc.billableLeaves 同一把尺:is_billable、非合計列、沒有子項)
export function billableLeafRows<T extends { id: string; parent_id: string | null; is_billable: boolean | null; is_rollup: boolean | null }>(rows: T[]): T[] {
  const hasChild = new Set(rows.map((r) => r.parent_id).filter((p): p is string => !!p))
  return rows.filter((r) => r.is_billable && !r.is_rollup && !hasChild.has(r.id))
}

export function supabaseDraftRepo(db: SupabaseClient, service: SupabaseClient, projectId: string): DraftRepo {
  let coords: { lat: number; lon: number } | null | undefined
  return {
    async callerOrg() {
      const { data } = await db.rpc('my_org_type')
      return typeof data === 'string' ? data : 'contractor'
    },

    async getIntake(intakeId) {
      const { data, error } = await db.from('photo_intakes')
        .select('id, project_id, uploader_org, log_date, status, attempts, run_started_at, last_progress_at, candidates')
        .eq('id', intakeId).eq('project_id', projectId).maybeSingle()
      if (error) return err('intake', error)
      return (data as IntakeRow | null) ?? null
    },

    async claimIntake({ intakeId, expectedAttempts, nextAttempts, staleBefore, now }) {
      const { data, error } = await service.from('photo_intakes')
        .update({ status: 'recognizing', run_started_at: now, last_progress_at: now, attempts: nextAttempts })
        .eq('id', intakeId).eq('project_id', projectId).eq('attempts', expectedAttempts)
        .or(`run_started_at.is.null,last_progress_at.lt.${staleBefore}`)
        .select('id')
      if (error) return err('claim', error)
      return data?.length ? 'claimed' : 'conflict'
    },

    async listIntakePhotos(intakeId) {
      const res = await fetchAllRows<IntakePhotoRow>((f, t) =>
        db.from('photos').select(PHOTO_COLS).eq('project_id', projectId).eq('intake_id', intakeId)
          .order('created_at').order('id').range(f, t))
      if (res.error) return { error: res.error }
      return res.rows
    },

    async listPhotosByIds(ids) {
      if (!ids.length) return []
      const { data, error } = await db.from('photos').select(PHOTO_COLS).eq('project_id', projectId).in('id', ids.slice(0, 500))
      if (error) return err('photos_by_id', error)
      return (data ?? []) as IntakePhotoRow[]
    },

    async listPhotosTakenOn(date, workItemId = null) {
      // 拍攝時間落在該日者,加上沒有拍攝時間(無 EXIF,taken_at 為 null)而上傳時間落在該日者——
      // 與照片起稿的日期順位同一條(assignPhotoDate:拍攝時間 > 上傳日),兩段各自分頁後合併
      const { start, end } = taipeiDayRange(date)
      const byTaken = await fetchAllRows<IntakePhotoRow>((f, t) => {
        let q = db.from('photos').select(PHOTO_COLS).eq('project_id', projectId).gte('taken_at', start).lt('taken_at', end)
        if (workItemId) q = q.eq('work_item_id', workItemId)
        return q.order('taken_at').order('id').range(f, t)
      })
      if (byTaken.error) return { error: byTaken.error }
      const byUpload = await fetchAllRows<IntakePhotoRow>((f, t) => {
        let q = db.from('photos').select(PHOTO_COLS).eq('project_id', projectId).is('taken_at', null).gte('created_at', start).lt('created_at', end)
        if (workItemId) q = q.eq('work_item_id', workItemId)
        return q.order('created_at').order('id').range(f, t)
      })
      if (byUpload.error) return { error: byUpload.error }
      return [...byTaken.rows, ...byUpload.rows]
    },

    async downloadPhoto(storagePath) {
      // 以呼叫者身分下載(storage policy photos_objects_select 限專案成員)
      const { data, error } = await db.storage.from('photos').download(storagePath)
      if (error || !data) return err('download', error ? { message: error.message } : { message: 'empty' })
      const ext = (storagePath.split('.').pop() || '').toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
      return { base64: await blobToBase64(data), mime }
    },

    async updatePhoto(photoId, patch) {
      const { error } = await service.from('photos').update(patch).eq('id', photoId).eq('project_id', projectId)
      if (!error) return {}
      const pub = maskDbError('draft-field-documents.photo_update', error)
      return { error: pub.message, code: pub.code }
    },

    async listLeafWorkItems() {
      type Row = LeafWorkItem & { parent_id: string | null; is_billable: boolean | null; is_rollup: boolean | null }
      const res = await fetchAllRows<Row>((f, t) =>
        db.from('work_items').select('id, item_key, item_no, description, unit, sort_order, parent_id, is_billable, is_rollup')
          .eq('project_id', projectId).order('sort_order').order('id').range(f, t))
      if (res.error) return { error: res.error }
      return billableLeafRows(res.rows).map(({ id, item_key, item_no, description, unit, sort_order }) =>
        ({ id, item_key, item_no, description, unit, sort_order }))
    },

    async getDailyLog(date) {
      const { data, error } = await db.from('daily_logs')
        .select('id, log_date, weather, weather_am, weather_pm, labor, equipment, materials, extras, work_summary, daily_log_items(work_item_id, qty_today)')
        .eq('project_id', projectId).eq('log_date', date).maybeSingle()
      if (error) return err('daily_log', error)
      return (data as LegacyDailyLog | null) ?? null
    },

    async fetchWeather(date) {
      // 既有 fetch-weather(過自己的閘門、記自己的用量);任何失敗都不阻擋起稿,天氣留 pending
      try {
        if (coords === undefined) {
          const { data: proj } = await db.from('projects').select('latitude, longitude').eq('id', projectId).maybeSingle()
          coords = proj?.latitude != null && proj?.longitude != null ? { lat: Number(proj.latitude), lon: Number(proj.longitude) } : null
        }
        if (!coords) return null
        const { data: wx, error } = await db.functions.invoke('fetch-weather', { body: { lat: coords.lat, lon: coords.lon, date } })
        if (error || !wx || wx.error || (!wx.am && !wx.pm)) return null
        return { am: wx.am ?? null, pm: wx.pm ?? null }
      } catch {
        return null
      }
    },

    async listOpenInspections() {
      const { data, error } = await db.from('inspections').select('id, title, work_item_id, requested_date, location, declared_qty, unit, stage_key, checklist_record_id')
        .eq('project_id', projectId).eq('status', '待查驗').order('created_at', { ascending: false }).limit(200)
      if (error) return err('inspections', error)
      return (data ?? []) as OpenInspection[]
    },

    // 監造日誌的內容來源(P3a):「當日」=台北日曆日;申請日為當日或判定時間落在當日的查驗
    async listInspectionsOn(date) {
      const { start, end } = taipeiDayRange(date)
      const { data, error } = await db.from('inspections')
        .select('id, title, status, work_item_id, location, inspection_type, requested_date, inspected_at, result_note')
        .eq('project_id', projectId)
        .or(`requested_date.eq.${date},and(inspected_at.gte.${start},inspected_at.lt.${end})`)
        .order('inspected_at', { ascending: true, nullsFirst: false }).order('id').limit(500)
      if (error) return err('inspections_day', error)
      return (data ?? []) as DayInspection[]
    },

    // 當日開立的缺失(通知)∪ 未結案的缺失(追蹤)
    async listDefectsForDay(date) {
      const { start, end } = taipeiDayRange(date)
      const { data, error } = await db.from('defects')
        .select('id, title, status, severity, location, due_date, created_at, inspection_id')
        .eq('project_id', projectId)
        .or(`status.neq.已結案,and(created_at.gte.${start},created_at.lt.${end})`)
        .order('created_at').order('id').limit(500)
      if (error) return err('defects_day', error)
      return (data ?? []) as DayDefect[]
    },

    // 同日施工日誌文件現況:狀態、目前版本內容、該版本的簽署／提送／收件／退回時間(收件情形)
    async getDailyLogDocument(date) {
      const { data: doc, error } = await db.from('field_documents').select('id, status, current_version_no')
        .eq('project_id', projectId).eq('doc_type', 'daily_log').eq('doc_date', date)
        .not('status', 'in', '("discarded","superseded")').maybeSingle()
      if (error) return err('daily_log_doc', error)
      if (!doc) return null
      const ver = Number(doc.current_version_no) || 0
      const base: FormalDailyLog = { document_id: doc.id, status: doc.status, version_no: ver, content: null, signed_at: null, submitted_at: null, received_at: null, returned_at: null }
      if (ver < 1) return base
      const [v, sigs, subs] = await Promise.all([
        db.from('field_document_versions').select('content').eq('document_id', doc.id).eq('version_no', ver).maybeSingle(),
        db.from('field_document_signatures').select('signed_at').eq('document_id', doc.id).eq('version_no', ver).order('signed_at', { ascending: false }).limit(1),
        db.from('field_document_submissions').select('action, created_at').eq('document_id', doc.id).eq('version_no', ver).order('created_at', { ascending: false }).limit(50),
      ])
      if (v.error || sigs.error || subs.error) return err('daily_log_doc', v.error ?? sigs.error ?? subs.error)
      const at = (action: string) => ((subs.data ?? []) as { action: string; created_at: string }[]).find((s) => s.action === action)?.created_at ?? null
      return {
        ...base, content: (v.data?.content as FormalDailyLog['content']) ?? null,
        signed_at: ((sigs.data ?? []) as { signed_at: string }[])[0]?.signed_at ?? null,
        submitted_at: at('submit'), received_at: at('receive'), returned_at: at('return'),
      }
    },

    // 範本單一定義在 DB:service client 直呼 fn_field_document_template(純映射;每批只取一次,呼叫端有快取)
    async getFieldDocumentTemplate(docType) {
      const { data, error } = await service.rpc('fn_field_document_template', { p_doc_type: docType })
      if (error) return err('template', error)
      return (data && typeof data === 'object' ? data as FieldDocTemplate : null)
    },

    // 本案檢查表範本(P3b 自檢表 kind=self_check、P3c 查驗表單 kind=inspection_form):候選推斷先看範本作者宣告的
    // 適用範圍(P3g applies_to 指名工項／關鍵字、stage_key 查驗階段),分不出來才退回工項描述與標題的相似度;RLS 只看得到本案
    async listChecklistTemplates() {
      const res = await fetchAllRows<ChecklistTemplateRow>((f, t) =>
        db.from('checklist_templates').select('id, title, source, items, kind, stage_key, applies_to').eq('project_id', projectId)
          .order('created_at').order('id').range(f, t))
      if (res.error) return { error: res.error }
      return res.rows.map((r) => ({ ...r, items: Array.isArray(r.items) ? r.items : [] }))
    },

    // 工項的 ITP 必要階段(P3c;與 DB fn_cq_required_stages_internal 同一口徑:H 點且 required_for_billing;鍵已正規化)
    async listRequiredStages(workItemId) {
      const { data, error } = await db.from('inspection_points').select('stage_key')
        .eq('project_id', projectId).eq('work_item_id', workItemId).eq('point_type', 'H').eq('required_for_billing', true).limit(200)
      if (error) return err('required_stages', error)
      return [...new Set(((data ?? []) as { stage_key: string | null }[]).map((r) => normalizeCqKey(r.stage_key)).filter(Boolean))].sort()
    },

    async findActiveDoc(docType, locator) {
      let q = db.from('field_documents').select('id, status, current_version_no, intake_id')
        .eq('project_id', projectId).eq('doc_type', docType)
      q = 'docDate' in locator ? q.eq('doc_date', locator.docDate)
        : 'intakeId' in locator ? q.eq('intake_id', locator.intakeId).eq('target_key', locator.targetKey)
          : q.eq('target_key', locator.targetKey)
      const { data, error } = await q.not('status', 'in', '("discarded","superseded")').maybeSingle()
      if (error) return err('find_doc', error)
      return (data as DocRow | null) ?? null
    },

    async insertDoc(row) {
      const { data, error } = await service.from('field_documents')
        .insert({ project_id: projectId, ...row })
        .select('id, status, current_version_no, intake_id').single()
      if (error) {
        if ((error as { code?: string }).code === '23505') return { conflict: true }
        return err('doc_insert', error)
      }
      return data as DocRow
    },

    async latestVersion(docId) {
      const { data, error } = await db.from('field_document_versions')
        .select('version_no, author_kind, content, attachments, content_hash')
        .eq('document_id', docId).order('version_no', { ascending: false }).limit(1).maybeSingle()
      if (error) return err('latest_version', error)
      return (data as VersionRow | null) ?? null
    },

    async hasHumanVersion(docId) {
      const { data, error } = await db.from('field_document_versions').select('id')
        .eq('document_id', docId).eq('author_kind', 'human').limit(1)
      if (error) return err('human_version', error)
      return !!data?.length
    },

    async insertVersion(row) {
      const { data, error } = await service.from('field_document_versions')
        .insert({ ...row, author_kind: 'ai' })
        .select('version_no, content_hash').single()
      if (error) return err('version_insert', error)
      return data as { version_no: number; content_hash: string }
    },

    async updateDoc(docId, patch) {
      const { error } = await service.from('field_documents').update(patch).eq('id', docId).eq('project_id', projectId)
      return error ? err('doc_update', error) : {}
    },

    async insertAgentAction(row) {
      const { data, error } = await service.from('agent_actions')
        .insert({ project_id: projectId, ...row }).select('id').single()
      if (error) return err('agent_action', error)
      return data as { id: string }
    },

    async finishIntake(intakeId, patch) {
      const { error } = await service.from('photo_intakes').update(patch).eq('id', intakeId).eq('project_id', projectId)
      return error ? err('finish', error) : {}
    },
  }
}
