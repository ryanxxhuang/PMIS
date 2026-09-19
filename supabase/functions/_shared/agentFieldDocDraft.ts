// Agent 對話起稿 → 現場文書草稿(P6b-2;D-026、設計 field-documents-lifecycle §3.1)。
// ---------------------------------------------------------------------------
// 廠商 Agent 的 draft_daily_log／draft_inspection 以前只寫一筆 agent_actions(target_table 指向 daily_logs／
// checklist_records、沒有 target_id),文件要等使用者在收件匣按接受、由前端另一份轉換(contentFromAgentDraft／
// createChecklistRecord)才建立——而那兩張事實表自 P2c／P3b 起只由簽署 RPC 寫。現在改為與照片起稿同一條路:
//   * 湊內容:同一支 builder(fieldDocDraft.buildDailyLogDraft／buildSelfCheckDraft),讀同一份照片辨識結果;
//   * 寫入:同一段 writeDraftDocument(建活文件＋AI 版本;內容沒變不加版本;已有人工版本只留 suggest_field_update;
//     已簽署／提送不動),agent_actions 的 target 一律是那份 field_documents。
// 收件匣的「接受」只在那份文件上加人工版本(人填的數量)或帶人去文件頁逐項確認——事實表仍只由簽署寫。
// 這裡沒有 npm: 執行期 import:repo 注入(fieldDocRepo.supabaseDraftRepo;測試用記憶體版)。

import type { ChecklistTemplateRow, DraftPhoto, FieldDocDraft, LeafWorkItem } from './fieldDocDraft.ts'
import { buildDailyLogDraft, buildSelfCheckDraft, previousDate, FIELD_DOC_TYPE_LABELS } from './fieldDocDraft.ts'
import type { DocRow, DraftRepo, DraftWriteResult, IntakePhotoRow, VersionRow } from './fieldDocDraftRun.ts'
import { readStored, toDraftPhoto, unionPriorAttachments, writeDraftDocument } from './fieldDocDraftRun.ts'

type RepoErr = { error: string }
const isErr = (v: unknown): v is RepoErr => !!v && typeof v === 'object' && 'error' in (v as Record<string, unknown>) && typeof (v as RepoErr).error === 'string'

export type AgentDraftOutcome =
  | { error: string }
  | { note: string; document_id?: string }
  | { written: DraftWriteResult; draft: FieldDocDraft; photoCount: number }

// 非工地／不可辨／重複的照片不進草稿(與照片起稿同一條);未辨識或辨識失敗但人已配工項的照片仍是「有施作」的證據
const usable = (rows: IntakePhotoRow[]) => rows.filter((r) => r.ai_status !== 'not_site' && r.ai_status !== 'unreadable' && r.ai_status !== 'duplicate')

const STATUS_WORD: Record<string, string> = { signed: '簽署', in_review: '送內部核對', submitted: '提送', received: '被收件' }
const locked = (doc: DocRow | null) => !!doc && doc.status !== 'draft' && doc.status !== 'pending_input'

async function latestOf(repo: DraftRepo, doc: DocRow | null): Promise<VersionRow | null | RepoErr> {
  return doc ? repo.latestVersion(doc.id) : null
}

// 收件匣卡片要顯示的工項(數量由人在卡片上填,接受時只把人填的寫成人工版本)
export function dailyLogInboxItems(draft: FieldDocDraft): Record<string, { item_no: string | null; description: string; unit: string | null; qty_today: number | null }> {
  const items = (draft.content as { items?: Record<string, { item_no: string | null; description: string; unit: string | null; qty_today: number | null }> }).items ?? {}
  return Object.fromEntries(Object.entries(items).map(([wid, it]) => [wid, { item_no: it.item_no, description: it.description, unit: it.unit, qty_today: it.qty_today }]))
}

// ── 施工日誌:該日一份(與照片起稿同一份活文件)──────────────────────────
export async function agentDraftDailyLog(p: { repo: DraftRepo; userId: string; date: string }): Promise<AgentDraftOutcome> {
  const { repo, userId, date } = p
  const found = await repo.findActiveDoc('daily_log', { docDate: date })
  if (isErr(found)) return found
  if (locked(found)) {
    return { note: `該日(${date})施工日誌已${STATUS_WORD[found!.status] ?? found!.status},未變更;要補充請使用者到施工日誌頁建立新版本。`, document_id: found!.id }
  }
  const rows = await repo.listPhotosTakenOn(date)
  if (isErr(rows)) return rows
  const photos = usable(rows)
  if (!photos.length) {
    // 誠實回報,不是失敗 —— agent 要能把這句話轉述給使用者
    return { note: `該日(${date})沒有已上傳的現場照片,無法據以擬稿。請先上傳照片,或直接到施工日誌頁填寫。` }
  }
  const leaves = await repo.listLeafWorkItems()
  if (isErr(leaves)) return leaves
  const latest = await latestOf(repo, found)
  if (isErr(latest)) return latest
  const draftPhotos = new Map<string, DraftPhoto>(photos.map((r) => [r.id, toDraftPhoto(r, readStored(r.ai_result))]))
  if (found) await unionPriorAttachments(repo, latest, draftPhotos)
  const [sameDay, yesterday, weather] = await Promise.all([repo.getDailyLog(date), repo.getDailyLog(previousDate(date)), repo.fetchWeather(date)])
  const draft = buildDailyLogDraft({
    date, dateSource: { source: 'agent:request', refs: [] }, photos: [...draftPhotos.values()], workItems: leaves,
    sameDayLog: isErr(sameDay) ? null : sameDay, yesterdayLog: isErr(yesterday) ? null : yesterday, weather,
    hasBoq: leaves.length > 0, notes: [],
  })
  try {
    const written = await writeDraftDocument(repo, {
      docType: 'daily_log', locator: { docDate: date }, existing: found, latest,
      insert: { doc_date: date, intake_id: null, target_key: null }, draft, userId,
      origin: {
        agentRole: 'contractor', actionKind: 'draft_daily_log',
        evidence: { origin: 'agent', log_date: date, items: dailyLogInboxItems(draft) },
        suggestSummary: `Agent 擬的內容可補入 ${date} 施工日誌(文件已有人工版本,未自動套用)`,
        changeNote: (n) => (n === 1 ? 'Agent 對話起稿' : 'Agent 對話起稿(更新草稿)'),
      },
    })
    return { written, draft, photoCount: draftPhotos.size }
  } catch (e) {
    return { error: (e as Error)?.message || '草稿寫入失敗,可重試' }
  }
}

// ── 自主檢查表:Agent 對話起稿一份(同日＋工項＋範本;與照片起稿的批次文件分開)──────
// 冪等鍵沿用照片起稿「日期:工項」的前兩段(清單頁以第二段對回工項),後綴 :agent:範本 與批次文件區隔;
// 照片起稿的文件以「批次＋鍵」定位,Agent 的文件沒有批次,兩者不會互相認錯。
export const agentSelfCheckKey = (date: string, workItemId: string | null, templateId: string) => `${date}:${workItemId ?? '-'}:agent:${templateId}`

export async function agentDraftSelfCheck(p: {
  repo: DraftRepo
  userId: string
  date: string
  template: ChecklistTemplateRow
  templateReason: string
  workItem: LeafWorkItem | null
  boolSuggestions: Map<string, { value: boolean; basis: string }>
}): Promise<AgentDraftOutcome> {
  const { repo, userId, date, template, workItem } = p
  const key = agentSelfCheckKey(date, workItem?.id ?? null, template.id)
  const found = await repo.findActiveDoc('self_check', { targetKey: key })
  if (isErr(found)) return found
  if (locked(found)) {
    return { note: `這份${FIELD_DOC_TYPE_LABELS.self_check}已${STATUS_WORD[found!.status] ?? found!.status},未變更;要更正請使用者到自主檢查表頁建立新版本。`, document_id: found!.id }
  }
  const frame = await repo.getFieldDocumentTemplate('self_check')
  if (isErr(frame)) return frame
  if (!frame) return { error: '伺服器沒有自主檢查表範本,無法起稿' }
  // 沒指定工項就不掛照片——不把不相干的照片掛上檢查表
  const rows = workItem ? await repo.listPhotosTakenOn(date, workItem.id) : []
  if (isErr(rows)) return rows
  const latest = await latestOf(repo, found)
  if (isErr(latest)) return latest
  const draftPhotos = new Map<string, DraftPhoto>(usable(rows).map((r) => [r.id, toDraftPhoto(r, readStored(r.ai_result))]))
  if (found) await unionPriorAttachments(repo, latest, draftPhotos)
  const leaves = await repo.listLeafWorkItems()
  const draft = buildSelfCheckDraft({
    date, dateSource: { source: 'agent:request', refs: [] }, photos: [...draftPhotos.values()], workItem, template,
    templateReason: p.templateReason, frame, hasBoq: !isErr(leaves) && leaves.length > 0, notes: [], boolSuggestions: p.boolSuggestions,
  })
  try {
    const written = await writeDraftDocument(repo, {
      docType: 'self_check', locator: { targetKey: key }, existing: found, latest,
      insert: { doc_date: date, intake_id: null, target_key: key, template_id: template.id }, draft, userId,
      origin: {
        agentRole: 'contractor', actionKind: 'draft_inspection',
        // 收件匣卡片顯示用:範本、日期、位置、各項目(項次、項目、AI 建議值與依據)
        evidence: {
          origin: 'agent', check_date: date, template_id: template.id, template_title: template.title,
          location: (draft.content as { location?: string | null }).location ?? null,
          work_item_id: workItem?.id ?? null,
          items: template.items.map((it) => ({
            no: it.no, item: it.item ?? null, kind: it.kind ?? null,
            ...(p.boolSuggestions.has(it.no) && it.kind !== 'num' ? { suggested: p.boolSuggestions.get(it.no)!.value, basis: p.boolSuggestions.get(it.no)!.basis } : {}),
          })),
        },
        suggestSummary: `Agent 擬的內容可補入「${template.title}」自主檢查表(文件已有人工版本,未自動套用)`,
        changeNote: (n) => (n === 1 ? 'Agent 對話起稿' : 'Agent 對話起稿(更新草稿)'),
      },
    })
    return { written, draft, photoCount: draftPhotos.size }
  } catch (e) {
    return { error: (e as Error)?.message || '草稿寫入失敗,可重試' }
  }
}
