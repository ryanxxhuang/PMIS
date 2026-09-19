// 現場文書純函式(P2c):上傳狀態機、恢復判讀、欄位來源狀態、施工日誌內容形狀、
// 送件 client_request_id 冪等、簽署錯誤碼分流。
import { describe, it, expect } from 'vitest'
import {
  uploadReducer, initialUploadState, uploadSummary, firstIndexBySha, UPLOAD_STATUS,
  intakeNextAction, RUN_STALE_MS, toggleCandidateExcluded,
  requiredKeysFor, unmetFields, fieldLabel, sourceLabel,
  emptyDailyLogContent, emptyDailyLogSources, contentFromLegacyLog, contentFromAgentDraft, contentToLogShape,
  setFieldValue, confirmField, setFieldNa, addItemRow, removeItemRow, applySuggestion, mergeAttachments, attachmentIssues,
  docStatusMeta, signIntentText, submissionRequestId, clearSubmissionRequestId, fieldDocErrorGuidance,
  templateFields, templateRequiredKeys, templateHumanOnlyKeys, templateFieldLabels, templateConfirmRequiredKeys, checklistItemKeys, docRequiredKeys, docHumanOnlyKeys, docConfirmRequiredKeys, UNMET_STATUS_LABEL,
  emptySelfCheckContent, emptySelfCheckSources, selfCheckValues, setSelfCheckTemplate, checklistItemLabels,
  emptySupervisorLogContent, emptySupervisorLogSources, fillHumanField, attendanceIssues, formalDailyLogFromDetail, applyFormalDailyLog, refTitle,
  docPagePath, docPageLink, docToOrg, docToOrgs, docToOrgLabel, TO_ORGS_BY_DOC_TYPE,
  INSPECTION_VERDICTS, requiredStagesFor, emptyInspectionFormContent, emptyInspectionFormSources, setInspectionFormTemplate, inspectionFormIssues, currentBatchCum,
  printSignature, submissionsChronological, submissionReceipts, returnHistory, nextResponsibleText,
  groupSharedFields, sharedFieldTitle, sharedEffectLabel, sharedPendingDocs, sharedInputValue, sharedApplySummary, documentsAfterShared,
  signedVersionIndex, signedVersionText, signedVersionLink, confirmationDocRef,
} from './fieldDocs.js'
import { demoFieldDocumentTemplate } from '../data/demoFieldDocTemplates.js'
import { composeContractorSummary, isFormalDailyLog, dailyLogReceipt, formalDailyLogSource } from './fieldDocText.js'

const files = [{ key: 'a', name: 'a.jpg', size: 10 }, { key: 'b', name: 'b.jpg', size: 20 }, { key: 'c', name: 'c.jpg', size: 30 }]
const run = (actions) => actions.reduce(uploadReducer, initialUploadState())

describe('上傳批次狀態機', () => {
  it('選檔後全部「仍在本機」;逐張 hashing→uploading→saved 才算已保存', () => {
    let s = run([{ type: 'add_files', files }])
    expect(uploadSummary(s.items)).toMatchObject({ total: 3, saved: 0, local: 3, persisted: 0 })
    s = uploadReducer(s, { type: 'intake', intakeId: 'i1' })
    expect(s.phase).toBe('uploading')
    s = uploadReducer(s, { type: 'hashing', key: 'a' })
    s = uploadReducer(s, { type: 'hashed', key: 'a', sha256: 'ff'.repeat(32) })
    s = uploadReducer(s, { type: 'uploading', key: 'a' })
    expect(uploadSummary(s.items)).toMatchObject({ uploading: 1, local: 3, saved: 0 })
    s = uploadReducer(s, { type: 'saved', key: 'a', photoId: 'p1' })
    expect(s.items[0]).toMatchObject({ status: UPLOAD_STATUS.saved, photoId: 'p1', sha256: 'ff'.repeat(32) })
    expect(uploadSummary(s.items)).toMatchObject({ saved: 1, local: 2, persisted: 1 })
  })

  it('失敗保留本機、可重試(只把 failed 回到 queued,已保存的不動);重複內容引用既有照片不算本機', () => {
    let s = run([{ type: 'add_files', files }, { type: 'intake', intakeId: 'i1' }])
    s = uploadReducer(s, { type: 'saved', key: 'a', photoId: 'p1' })
    s = uploadReducer(s, { type: 'failed', key: 'b', error: '網路中斷' })
    s = uploadReducer(s, { type: 'duplicate', key: 'c', photoId: 'p-old' })
    expect(uploadSummary(s.items)).toMatchObject({ saved: 1, failed: 1, duplicate: 1, local: 1, persisted: 2 })
    expect(s.items[1].error).toBe('網路中斷')
    s = uploadReducer(s, { type: 'retry' })
    expect(s.items.map((it) => it.status)).toEqual([UPLOAD_STATUS.saved, UPLOAD_STATUS.queued, UPLOAD_STATUS.duplicate])
    expect(s.phase).toBe('uploading')
  })

  it('階段:drafting→done;error 帶訊息;reset 回初始;remove 只移除該張', () => {
    let s = run([{ type: 'add_files', files }, { type: 'intake', intakeId: 'i1' }, { type: 'drafting' }])
    expect(s.phase).toBe('drafting')
    s = uploadReducer(s, { type: 'error', error: '模型逾時' })
    expect(s).toMatchObject({ phase: 'error', error: '模型逾時' })
    s = uploadReducer(s, { type: 'remove', key: 'b' })
    expect(s.items.map((it) => it.key)).toEqual(['a', 'c'])
    s = uploadReducer(s, { type: 'done' })
    expect(s.phase).toBe('done')
    expect(uploadReducer(s, { type: 'reset' })).toEqual(initialUploadState())
  })

  it('同批同雜湊只算第一張(第二張引用第一張,不重複上傳)', () => {
    const items = [{ key: 'a', sha256: 'x' }, { key: 'b', sha256: 'y' }, { key: 'c', sha256: 'x' }, { key: 'd', sha256: null }]
    const first = firstIndexBySha(items)
    expect(first.get('x')).toBe(0)
    expect(first.get('y')).toBe(1)
    expect(first.size).toBe(2)
  })
})

describe('恢復:只看伺服器狀態決定下一步', () => {
  const now = Date.parse('2026-09-17T10:00:00Z')
  const base = { status: 'received', run_started_at: null, last_progress_at: null, attempts: 0, photo_count: 0, candidates: [] }
  it('received 有照片=可起稿、沒照片=空批次;recognizing 無 run=續跑;run 進行中=等待;run 過期=可接手', () => {
    expect(intakeNextAction({ ...base, photo_count: 2 }, { now })).toBe('draft')
    expect(intakeNextAction({ ...base }, { now })).toBe('empty')
    expect(intakeNextAction({ ...base, photo_count: 0 }, { now, photoCount: 3 })).toBe('draft')
    expect(intakeNextAction({ ...base, status: 'recognizing' }, { now })).toBe('continue')
    const fresh = new Date(now - 60_000).toISOString()
    expect(intakeNextAction({ ...base, status: 'recognizing', run_started_at: fresh, last_progress_at: fresh }, { now })).toBe('running')
    const old = new Date(now - RUN_STALE_MS - 1).toISOString()
    expect(intakeNextAction({ ...base, status: 'recognizing', run_started_at: old, last_progress_at: old }, { now })).toBe('continue')
  })
  it('partial／failed 可重試,attempts 用盡=請重新上傳;ready 有 blocked 候選=補日期;discarded=無', () => {
    expect(intakeNextAction({ ...base, status: 'partial', attempts: 1 }, { now })).toBe('retry')
    expect(intakeNextAction({ ...base, status: 'failed', attempts: 5 }, { now })).toBe('exhausted')
    expect(intakeNextAction({ ...base, status: 'ready', candidates: [{ state: 'blocked' }] }, { now })).toBe('fix_date')
    expect(intakeNextAction({ ...base, status: 'ready', candidates: [{ state: 'drafted' }] }, { now })).toBe('done')
    expect(intakeNextAction({ ...base, status: 'discarded' }, { now })).toBe('none')
    expect(intakeNextAction(null)).toBe('none')
  })
  it('切換候選 excluded 只改該項的 excluded,其餘欄位逐位元相同(DB guard 逐項比對)', () => {
    const cands = [{ doc_type: 'daily_log', target_key: '2026-09-17', state: 'ready', excluded: false }, { doc_type: 'self_check', target_key: 'w1', state: 'unsupported', excluded: false }]
    const next = toggleCandidateExcluded(cands, 1, true)
    expect(next[1]).toEqual({ ...cands[1], excluded: true })
    expect(next[0]).toEqual(cands[0])
    expect(next).not.toBe(cands)
  })
})

describe('欄位來源狀態與必填(鏡像 DB)', () => {
  it('必填鍵=固定六欄 ∪ 內容各工項 qty_today;stored 的工項鍵忽略、其他 stored 鍵保留', () => {
    const content = { items: { w1: {}, w2: {} } }
    expect(requiredKeysFor(content, ['items.w9.qty_today', 'extras.sampling'])).toEqual([
      'equipment', 'extras.sampling', 'items.w1.qty_today', 'items.w2.qty_today', 'labor', 'materials', 'weather_am', 'weather_pm', 'work_summary',
    ])
  })
  it('待補判定:缺鍵 missing、pending、na 無 reason、未知狀態;filled／confirmed／na＋reason 通過', () => {
    const sources = {
      weather_am: { status: 'filled', source: 'cwa' }, weather_pm: { status: 'confirmed', source: 'human' },
      labor: { status: 'na', reason: '本日停工' }, equipment: { status: 'na' }, materials: { status: 'pending' },
      work_summary: { status: 'weird' },
    }
    expect(unmetFields(['weather_am', 'weather_pm', 'labor', 'equipment', 'materials', 'work_summary', 'items.w1.qty_today'], sources)).toEqual([
      { key: 'equipment', status: 'na_without_reason' }, { key: 'materials', status: 'pending' },
      { key: 'work_summary', status: 'unknown_status' }, { key: 'items.w1.qty_today', status: 'missing' },
    ])
  })
  it('欄位與來源的中文:工項鍵用工項名;來源字串轉短句', () => {
    const content = { items: { w1: { item_no: '壹.一.1', description: '鋼筋' } } }
    expect(fieldLabel('items.w1.qty_today', content)).toBe('壹.一.1 鋼筋 當日數量')
    expect(fieldLabel('items.w1.location', content)).toBe('壹.一.1 鋼筋 施作位置')
    expect(fieldLabel('extras.sampling')).toBe('施工取樣試驗紀錄')
    expect(sourceLabel('whiteboard:p1')).toBe('告示板轉錄')
    expect(sourceLabel('yesterday:L1')).toBe('沿用昨日')
    expect(sourceLabel('legacy:L1')).toBe('既有紀錄')
    expect(sourceLabel(null)).toBeNull()
  })
})

describe('施工日誌內容形狀', () => {
  const byKey = new Map([['K1', { id: 'w1', item_key: 'K1', item_no: '壹.一.1', description: '鋼筋', unit: 'T' }]])
  it('新文件全部 pending,不假裝有值', () => {
    const content = emptyDailyLogContent('2026-09-17')
    const sources = emptyDailyLogSources(content)
    expect(content).toMatchObject({ log_date: '2026-09-17', items: {}, labor: [] })
    expect(unmetFields(requiredKeysFor(content), sources).map((u) => u.key)).toEqual(['equipment', 'labor', 'materials', 'weather_am', 'weather_pm', 'work_summary'])
  })
  it('既有未簽署日誌→草稿:全標 filled/legacy(待核對),工項鍵換 uuid,空欄仍 pending,不偽造簽署', () => {
    const log = { id: 'L1', log_date: '2026-09-01', weather: '晴', weather_pm: '', labor: [{ type: '鋼筋工', count: 3 }], equipment: [], materials: [], extras: { sampling: '試體 2 組' }, work_summary: '綁紮', items: { K1: 2.5, K9: 1 } }
    const { content, sources } = contentFromLegacyLog(log, byKey)
    expect(content.items.w1).toMatchObject({ item_key: 'K1', item_no: '壹.一.1', qty_today: 2.5 })
    expect(content.items.K9).toMatchObject({ item_key: 'K9', qty_today: 1 }) // 換不到 uuid 的保留原 key,簽署時由 DB 擋
    expect(sources.weather_am).toMatchObject({ status: 'filled', source: 'legacy:L1' })
    expect(sources.weather_pm).toEqual({ status: 'pending', source: null })
    expect(sources.equipment).toEqual({ status: 'pending', source: null })
    expect(sources['extras.sampling']).toMatchObject({ status: 'filled' })
    expect(sources['items.w1.qty_today']).toMatchObject({ status: 'filled', source: 'legacy:L1' })
    expect(Object.values(sources).some((s) => s.status === 'confirmed')).toBe(false)
  })
  it('Agent 草稿 payload→內容:人填數量 confirmed,沒填 pending;天氣依來源 cwa', () => {
    const payload = { log_date: '2026-09-17', weather_am: '晴', weather_pm: '', labor: [{ type: '工', count: 1 }], items: { w1: { item_key: 'K1', description: '鋼筋', qty_today: 3 }, w2: { item_key: 'K2', description: '模板', qty_today: null } }, field_sources: { weather: 'cwa', labor: 'yesterday' }, work_summary: '摘要' }
    const { content, sources } = contentFromAgentDraft(payload)
    expect(content.items.w1.qty_today).toBe(3)
    expect(content.items.w2.qty_today).toBeNull()
    expect(sources['items.w1.qty_today']).toEqual({ status: 'confirmed', source: 'human' })
    expect(sources['items.w2.qty_today'].status).toBe('pending')
    expect(sources.weather_am).toEqual({ status: 'filled', source: 'cwa' })
    expect(sources.weather_pm).toEqual({ status: 'pending', source: null })
    expect(sources.labor.source).toBe('yesterday:agent')
  })
  it('內容→顯示用日誌形狀:只有有數量的工項、鍵回 item_key', () => {
    const content = { log_date: '2026-09-17', weather_am: '晴', items: { w1: { item_key: 'K1', qty_today: 2 }, w2: { item_key: 'K2', qty_today: null } }, labor: [] }
    expect(contentToLogShape(content, { id: 'D1', status: 'draft' })).toMatchObject({ id: 'D1', log_date: '2026-09-17', weather: '晴', items: { K1: 2 } })
  })
  it('列印用:工項項次／名稱／單位取版本內容的快照(item_meta),標 from_document;內容缺日期時以文件業務日期補', () => {
    const content = { weather_am: '晴', weather_pm: null, items: { w1: { item_key: 'K1', item_no: '壹.1', description: '簽署當時名稱', unit: 'M3', qty_today: 2 } } }
    const log = contentToLogShape(content, { id: 'D1', status: 'signed', logDate: '2026-09-18' })
    expect(log.log_date).toBe('2026-09-18')
    expect(log.item_meta).toEqual({ K1: { item_no: '壹.1', description: '簽署當時名稱', unit: 'M3', work_item_id: 'w1' } })
    expect(log.from_document).toBe(true)
    expect(log.weather_pm).toBeNull() // 不把上午天氣回填成下午
  })
  it('給版本的 field_sources:數量標不適用(na)的工項不是當日數量(與簽署分支寫 daily_log_items 同一條規則)', () => {
    // setFieldNa 對數字欄只改來源、不清值:不給 sources 會把 na 列的舊數字印成當日數量
    const content = { items: { w1: { item_key: 'K1', qty_today: 2 }, w2: { item_key: 'K2', qty_today: 7 } } }
    const sources = { 'items.w2.qty_today': { status: 'na', reason: '本日未施作' } }
    expect(contentToLogShape(content, { sources }).items).toEqual({ K1: 2 })
    expect(contentToLogShape(content).items).toEqual({ K1: 2, K2: 7 })
  })
})

describe('已簽署版本的重用(P6a:月報／監造月報／佐證包)', () => {
  const row = (target, doc, v, at, extra = {}) => ({
    document_id: doc, doc_type: 'daily_log', doc_date: '2026-09-05', doc_status: 'submitted', target_id: target,
    version_no: v, content_hash: `${v}`.repeat(64), signer_name_snapshot: '廠商甲', signed_at: at, ...extra,
  })
  it('事實列的版本＝指向它的文件中最晚一次簽署;沒有簽署列的事實列不在索引裡', () => {
    const idx = signedVersionIndex([
      row('L1', 'dA', 1, '2026-09-05T02:00:00.123456+00:00'),
      row('L1', 'dA', 2, '2026-09-06T02:00:00+00:00'),
      row('L2', 'dB', 1, '2026-09-06T03:00:00+00:00'),
    ])
    expect(idx.get('L1')).toMatchObject({ document_id: 'dA', version_no: 2, latest_of_doc: true, newer: null, signer_name: '廠商甲' })
    expect(idx.has('L3')).toBe(false)
  })
  it('對方收件後另立新文件:新文件簽署前,事實列仍是舊(已取代)文件的版本;簽署後改指新文件', () => {
    const old = row('L1', 'dOld', 3, '2026-09-05T02:00:00Z', { doc_status: 'superseded' })
    expect(signedVersionIndex([old]).get('L1')).toMatchObject({ document_id: 'dOld', doc_status: 'superseded' })
    const idx = signedVersionIndex([old, row('L1', 'dNew', 1, '2026-09-08T02:00:00Z', { doc_status: 'signed' })])
    expect(idx.get('L1')).toMatchObject({ document_id: 'dNew', version_no: 1 })
  })
  it('pinAt:只看該時點(含)以前的簽署,之後的記 newer;該時點以前沒簽署=不在索引', () => {
    const rows = [row('L1', 'dA', 1, '2026-09-05T02:00:00Z'), row('L1', 'dA', 2, '2026-09-10T02:00:00Z'), row('L2', 'dB', 1, '2026-09-10T02:00:00Z')]
    const idx = signedVersionIndex(rows, { pinAt: '2026-09-05T02:00:00Z' })
    expect(idx.get('L1')).toMatchObject({ version_no: 1, latest_of_doc: false, newer: { document_id: 'dA', version_no: 2 } })
    expect(idx.has('L2')).toBe(false)
  })
  it('版本標示與列印連結:只有該版本是文件目前列印版本、且文件在活文件清單才給連結', () => {
    const ref = signedVersionIndex([row('L1', 'doc-12345678-x', 2, '2026-09-06T02:00:00Z')]).get('L1')
    expect(signedVersionText(ref)).toBe(`文件 doc-1234 v2・雜湊 ${'2'.repeat(12)}`)
    expect(signedVersionLink(ref, new Set(['doc-12345678-x']))).toBe('/site-log/print?doc=doc-12345678-x')
    expect(signedVersionLink(ref, new Set())).toBeNull() // 已取代／已捨棄:列印頁找不到
    expect(signedVersionLink({ ...ref, latest_of_doc: false }, new Set(['doc-12345678-x']))).toBeNull() // 連過去會印出別的版本
    expect(signedVersionText(null)).toBe('')
  })
  it('監造確認紀錄 → 查驗表單版本:撤銷後重簽的舊確認指向舊版本,不給列印連結;監造確認單沒有文件', () => {
    const formIdx = signedVersionIndex([
      { document_id: 'f1', doc_type: 'inspection_form', doc_date: '2026-09-10', doc_status: 'signed', target_id: 'i1', version_no: 2, signed_at: '2026-09-10T02:00:00Z' },
      { document_id: 'f1', doc_type: 'inspection_form', doc_date: '2026-09-10', doc_status: 'signed', target_id: 'i1', version_no: 3, signed_at: '2026-09-11T02:00:00Z' },
    ])
    const c = { inspection_id: 'i1', document_id: 'f1', document_version_no: 2, content_hash: 'a'.repeat(64) }
    expect(confirmationDocRef(c, formIdx)).toEqual({ document_id: 'f1', doc_type: 'inspection_form', version_no: 2, content_hash: 'a'.repeat(64), latest_of_doc: false })
    expect(confirmationDocRef({ ...c, document_version_no: 3 }, formIdx).latest_of_doc).toBe(true)
    expect(confirmationDocRef({ basis: 'supervisor_certificate', document_id: null, document_version_no: null }, formIdx)).toBeNull()
  })
})

describe('人工編輯:值與來源一起走', () => {
  const base = () => {
    const content = emptyDailyLogContent('2026-09-17')
    content.weather_am = '晴'
    const sources = { ...emptyDailyLogSources(content), weather_am: { status: 'filled', source: 'cwa' } }
    return { content, sources }
  }
  it('改值=confirmed/human;核對不改值只改狀態;不適用要 reason;工項加減同步來源鍵', () => {
    let s = setFieldValue(base(), 'work_summary', '澆置')
    expect(s.content.work_summary).toBe('澆置')
    expect(s.sources.work_summary).toEqual({ status: 'confirmed', source: 'human' })
    s = confirmField(s, 'weather_am')
    expect(s.sources.weather_am).toEqual({ status: 'confirmed', source: 'cwa' })
    expect(confirmField(s, 'labor').sources.labor.status).toBe('pending') // pending 不能「核對」成確認
    s = setFieldNa(s, 'equipment', ' 本日無機具 ')
    expect(s.sources.equipment).toEqual({ status: 'na', source: null, reason: '本日無機具' })
    expect(s.content.equipment).toEqual([])
    expect(setFieldNa(s, 'materials', '').sources.materials.reason).toBeUndefined()
    s = addItemRow(s, { id: 'w1', item_key: 'K1', item_no: '1', description: '鋼筋', unit: 'T' })
    expect(s.content.items.w1.qty_today).toBeNull()
    expect(s.sources['items.w1.qty_today']).toEqual({ status: 'pending', source: null })
    s = setFieldValue(s, 'items.w1.qty_today', 4)
    expect(s.content.items.w1.qty_today).toBe(4)
    expect(s.sources['items.w1.qty_today'].status).toBe('confirmed')
    s = setFieldValue(s, 'extras.sampling', '試體 1 組')
    expect(s.content.extras.sampling).toBe('試體 1 組')
    s = removeItemRow(s, 'w1')
    expect(s.content.items).toEqual({})
    expect(s.sources['items.w1.qty_today']).toBeUndefined()
  })
  it('AI 建議只補 pending 欄、不覆蓋人填;工項只加不減;附件聯集', () => {
    let s = setFieldValue(base(), 'work_summary', '人寫的')
    const suggestion = {
      content: { work_summary: 'AI 寫的', weather_pm: '陰', labor: [{ type: '工', count: 2 }], items: { w1: { item_key: 'K1', description: '鋼筋', qty_today: 5, location: 'A區' } }, photo_ids: ['p1'] },
      field_sources: { work_summary: { status: 'filled', source: 'ai:photo' }, weather_pm: { status: 'filled', source: 'whiteboard:p1' }, labor: { status: 'pending' }, 'items.w1.qty_today': { status: 'filled', source: 'whiteboard:p1' }, 'items.w1.location': { status: 'filled', source: 'whiteboard:p1' } },
    }
    const { state, applied } = applySuggestion(s, suggestion)
    expect(state.content.work_summary).toBe('人寫的')
    expect(state.content.weather_pm).toBe('陰')
    expect(state.sources.weather_pm).toEqual({ status: 'filled', source: 'whiteboard:p1' })
    expect(state.content.labor).toEqual([]) // 建議本身也是 pending,不套
    expect(state.content.items.w1).toMatchObject({ qty_today: 5, location: 'A區' })
    expect(state.content.photo_ids).toEqual(['p1'])
    expect(applied).toEqual(['weather_pm', 'items.w1', 'items.w1.qty_today', 'items.w1.location'])
    expect(mergeAttachments([{ photo_id: 'p1' }], [{ photo_id: 'p1' }, { photo_id: 'p2' }]).map((a) => a.photo_id)).toEqual(['p1', 'p2'])
  })
  it('recheck 的附件問題轉成逐張說明', () => {
    const m = attachmentIssues([{ key: 'attachments.p1', status: 'uploader_org:supervisor' }, { key: 'attachments.p2', status: 'uploader_unknown' }, { key: 'weather_am', status: 'pending' }])
    expect(m.get('p1')).toContain('監造')
    expect(m.get('p2')).toContain('上傳方不明')
    expect(m.size).toBe(2)
  })
})

describe('文件狀態、簽署意願、送件冪等、錯誤碼', () => {
  it('狀態文案依觀看者與文書類型:責任方有動作,提送對象只在已提送時有收件動作;施工日誌送監造、監造日誌送機關', () => {
    const dl = (over) => ({ doc_type: 'daily_log', owner_org: 'contractor', ...over })
    const sl = (over) => ({ doc_type: 'supervisor_log', owner_org: 'supervisor', ...over })
    expect(docStatusMeta(dl({ status: 'pending_input', recheck: [{ key: 'labor' }] }), 'contractor')).toMatchObject({ label: '待補 1', action: '補齊後簽署' })
    expect(docStatusMeta(dl({ status: 'signed' }), 'contractor').action).toBe('提送給監造')
    expect(docStatusMeta(dl({ status: 'submitted' }), 'supervisor').action).toBe('收件或退回')
    expect(docStatusMeta(dl({ status: 'submitted' }), 'contractor').action).toBeNull()
    expect(docStatusMeta(dl({ status: 'received' }), 'contractor').label).toBe('監造已收件')
    expect(docStatusMeta(dl({ status: 'returned' }), 'contractor')).toMatchObject({ tone: 'red', action: '補正後重新簽署' })
    // 監造日誌:責任方監造、提送對象機關;廠商(可讀)沒有任何動作、機關在已提送時才有收件
    expect(docStatusMeta(sl({ status: 'signed' }), 'supervisor').action).toBe('提送給機關')
    expect(docStatusMeta(sl({ status: 'submitted' }), 'owner').action).toBe('收件或退回')
    expect(docStatusMeta(sl({ status: 'submitted' }), 'supervisor').action).toBeNull()
    expect(docStatusMeta(sl({ status: 'submitted' }), 'contractor').action).toBeNull()
    expect(docStatusMeta(sl({ status: 'received' }), 'contractor').label).toBe('機關已收件')
    expect(docToOrg(sl({}))).toBe('owner')
    expect(docPagePath('daily_log')).toBe('/site-log')
    expect(docPagePath('supervisor_log')).toBe('/supervisor-log')
    expect(docPagePath('self_check')).toBe('/self-check')
    expect(docPagePath('inspection_form')).toBe('/inspection-form')
    expect(docPageLink({ doc_type: 'supervisor_log', id: 'D 1' })).toBe('/supervisor-log?doc=D%201')
    expect(docPageLink({ doc_type: 'inspection_form', id: 'X' })).toBe('/inspection-form?doc=X')
    expect(docPageLink({ doc_type: 'other', id: 'X' })).toBeNull()
  })
  it('簽署意願文字含日期、版本與雜湊前 12 碼', () => {
    expect(signIntentText({ docDate: '2026-09-17', versionNo: 2, contentHash: 'abcdef0123456789ff' })).toBe(
      '本人確認 2026-09-17 施工日誌(版本 2,內容雜湊 abcdef012345)內容屬實,同意以本人登入的平台帳號簽署本文件。')
  })
  it('client_request_id:同文件同版本同動作重試拿到同一個 id;清掉後才換新;不同退回原因是不同請求', () => {
    const store = new Map()
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
    let n = 0
    const uuid = () => `u${++n}`
    const key = { documentId: 'D1', versionNo: 1, action: 'submit' }
    expect(submissionRequestId(key, storage, uuid)).toBe('u1')
    expect(submissionRequestId(key, storage, uuid)).toBe('u1')
    expect(submissionRequestId({ ...key, versionNo: 2 }, storage, uuid)).toBe('u2')
    expect(submissionRequestId({ ...key, action: 'return', reason: '缺照片' }, storage, uuid)).toBe('u3')
    expect(submissionRequestId({ ...key, action: 'return', reason: '缺照片' }, storage, uuid)).toBe('u3')
    clearSubmissionRequestId(key, storage)
    expect(submissionRequestId(key, storage, uuid)).toBe('u4')
  })
  it('PD 錯誤碼分流:舊版／雜湊→reload、待補與附件帶 detail 清單、request id 衝突;未登記的代碼一律 unknown', () => {
    expect(fieldDocErrorGuidance({ code: 'PD001', message: '舊版' })).toMatchObject({ kind: 'reload' })
    expect(fieldDocErrorGuidance({ code: 'PD002', message: '雜湊不符' })).toMatchObject({ kind: 'reload' })
    expect(fieldDocErrorGuidance({ code: 'PD004', message: '待補', details: '[{"key":"labor","status":"pending"}]' })).toEqual({ kind: 'pending', message: '待補', details: [{ key: 'labor', status: 'pending' }] })
    expect(fieldDocErrorGuidance({ code: 'PD005', message: '附件', details: 'not json' })).toEqual({ kind: 'attachments', message: '附件', details: [] })
    expect(fieldDocErrorGuidance({ code: 'PD009', message: 'id 衝突' }).kind).toBe('request_id')
    expect(fieldDocErrorGuidance({ code: 'PD008', message: '狀態' }).kind).toBe('state')
    expect(fieldDocErrorGuidance({ code: '42501', message: 'permission denied' }).kind).toBe('unknown')
  })
})

// ── 監造日誌(P3a 前端):範本推導、到場確認閘門、引用施工日誌、來源 ────────────────────
describe('監造日誌:範本推導與到場確認閘門(鏡像 DB 範本與 needs_confirmation)', () => {
  const tpl = demoFieldDocumentTemplate('supervisor_log')
  it('範本標記與推導:示範範本／免責聲明;必填鍵與人填欄由範本 required／human_only 推導;施工日誌沒有範本', () => {
    expect(tpl).toMatchObject({ key: 'supervisor_log_demo', version: 1, is_demo: true, demo_label: '示範範本' })
    expect(tpl.disclaimer).toContain('非任何機關公定或法定格式')
    expect(templateRequiredKeys(tpl)).toEqual(['attendance', 'contractor_summary', 'log_date', 'supervision_items', 'weather_am', 'weather_pm'])
    expect(templateHumanOnlyKeys(tpl)).toEqual(['attendance'])
    expect(templateFieldLabels(tpl)).toMatchObject({ attendance: '到場人員與時段', notices: '通知事項' })
    expect(templateFields(tpl).find((f) => f.key === 'note')).toMatchObject({ section: 'note', sectionTitle: '八、備註' })
    expect(demoFieldDocumentTemplate('daily_log')).toBeNull()
    expect(templateRequiredKeys(null)).toEqual([])
    expect(fieldLabel('attendance', null, templateFieldLabels(tpl))).toBe('到場人員與時段')
    expect(fieldLabel('attendance')).toBe('到場人員與時段') // 範本讀不到時的後備
  })
  it('必填鍵依類型:監造日誌=stored ∪ 範本必填(不帶施工日誌固定欄與工項數量);施工日誌不變', () => {
    const content = { ...emptySupervisorLogContent('2026-09-17', tpl), items: { w1: {} } }
    expect(requiredKeysFor(content, ['photos'], { docType: 'supervisor_log', template: tpl })).toEqual(['attendance', 'contractor_summary', 'log_date', 'photos', 'supervision_items', 'weather_am', 'weather_pm'])
    expect(requiredKeysFor(content, [], { docType: 'supervisor_log', template: null })).toEqual([])
    expect(requiredKeysFor({ items: { w1: {} } }, [])).toEqual(['equipment', 'items.w1.qty_today', 'labor', 'materials', 'weather_am', 'weather_pm', 'work_summary'])
  })
  it('新文件:範本鍵入內容、其餘全 pending,日期是人選的;到場人填了只是「待親自確認」,確認後才齊備,再改又回待確認;本日未到場=na＋原因且清空', () => {
    const content = emptySupervisorLogContent('2026-09-17', tpl)
    expect(content).toMatchObject({ log_date: '2026-09-17', template: { key: 'supervisor_log_demo', version: 1 }, attendance: [], supervision_items: [], contractor_summary: null })
    const sources = emptySupervisorLogSources(tpl)
    expect(sources.log_date).toEqual({ status: 'confirmed', source: 'human' })
    expect(sources.attendance).toEqual({ status: 'pending', source: null })
    const required = requiredKeysFor(content, [], { docType: 'supervisor_log', template: tpl })
    const human = templateHumanOnlyKeys(tpl)
    expect(unmetFields(required, sources, human).map((u) => u.key)).toEqual(['attendance', 'contractor_summary', 'supervision_items', 'weather_am', 'weather_pm'])
    let s = fillHumanField({ content, sources }, 'attendance', [{ name: '王監造', from: '09:00', to: '12:00' }])
    expect(s.sources.attendance).toEqual({ status: 'filled', source: 'human' })
    expect(unmetFields(required, s.sources, human)).toContainEqual({ key: 'attendance', status: 'needs_confirmation' })
    expect(UNMET_STATUS_LABEL.needs_confirmation).toBe('待親自確認')
    s = confirmField(s, 'attendance')
    expect(s.sources.attendance).toEqual({ status: 'confirmed', source: 'human' })
    expect(unmetFields(required, s.sources, human).some((u) => u.key === 'attendance')).toBe(false)
    s = fillHumanField(s, 'attendance', [...s.content.attendance, { name: '李監造' }])
    expect(s.sources.attendance.status).toBe('filled') // 確認後再改=回到待確認
    s = fillHumanField(s, 'attendance', [])
    expect(s.sources.attendance).toEqual({ status: 'pending', source: null }) // 清空=沒有到場資料,不是「已填」
    s = setFieldNa(s, 'attendance', '本日未到場,例假日')
    expect(s.content.attendance).toEqual([])
    expect(s.sources.attendance).toEqual({ status: 'na', source: null, reason: '本日未到場,例假日' })
    expect(unmetFields(required, s.sources, human).some((u) => u.key === 'attendance')).toBe(false)
    // 一般欄位(非人填欄)照舊:改值即 confirmed;文字欄標不適用會清成 null
    s = setFieldValue(s, 'contractor_summary', '廠商今日澆置')
    expect(s.sources.contractor_summary).toEqual({ status: 'confirmed', source: 'human' })
    s = setFieldNa(s, 'contractor_summary', '廠商本日未施工')
    expect(s.content.contractor_summary).toBeNull()
    // 到場列預檢鏡像 DB PD010
    expect(attendanceIssues([{ name: '王' }, { user_id: 'u1' }, { name: '', from: '9:00' }, 'x'])).toEqual([
      { index: 2, reason: '須有姓名' }, { index: 2, reason: '到場時間須為 HH:MM' }, { index: 3, reason: '格式不正確' },
    ])
  })
  it('引用同日施工日誌:只在已簽署／提送／收件時帶入摘要並標 field_document 來源;草稿只更新收件情形;組字與 Edge 同一支', () => {
    const wi = new Map([['w1', { item_no: '壹.一.3', description: '結構用混凝土', unit: 'M3' }]])
    const detail = {
      doc: { id: 'dl1', status: 'signed', current_version_no: 3 },
      version: { version_no: 3, content: { work_summary: '3F 版牆混凝土澆置', items: { w1: { qty_today: 12, unit: 'M3' }, w2: { qty_today: null } } } },
      signatures: [{ version_no: 3, signed_at: '2026-09-17T09:00:00Z' }],
      submissions: [{ action: 'submit', version_no: 3, created_at: '2026-09-17T09:30:00Z' }, { action: 'return', version_no: 2, created_at: '2026-09-16T09:30:00Z' }],
    }
    const formal = formalDailyLogFromDetail(detail)
    expect(formal).toEqual({ document_id: 'dl1', status: 'signed', version_no: 3, content: detail.version.content, signed_at: '2026-09-17T09:00:00Z', submitted_at: '2026-09-17T09:30:00Z', received_at: null, returned_at: null })
    expect(isFormalDailyLog(formal)).toBe(true)
    expect(composeContractorSummary(formal, wi)).toBe('3F 版牆混凝土澆置;數量:壹.一.3 結構用混凝土 12M3(依廠商施工日誌 v3)')
    expect(formalDailyLogSource(formal)).toBe('field_document:dl1:v3')
    const base = { content: emptySupervisorLogContent('2026-09-17', tpl), sources: emptySupervisorLogSources(tpl) }
    const helpers = { compose: composeContractorSummary, isFormal: isFormalDailyLog, receipt: dailyLogReceipt, source: formalDailyLogSource }
    const r = applyFormalDailyLog(base, formal, wi, helpers)
    expect(r.applied).toBe(true)
    expect(r.state.content.contractor_summary).toContain('依廠商施工日誌 v3')
    expect(r.state.sources.contractor_summary).toMatchObject({ status: 'filled', source: 'field_document:dl1:v3' })
    expect(r.state.content.daily_log_receipt).toMatchObject({ document_id: 'dl1', version_no: 3, status: 'signed' })
    expect(r.state.sources.daily_log_receipt).toMatchObject({ status: 'filled', source: 'system:field_documents', refs: ['dl1'] })
    // 草稿中的施工日誌:不引用摘要(仍 pending),收件情形照實記錄現況
    const draft = formalDailyLogFromDetail({ ...detail, doc: { ...detail.doc, status: 'pending_input' }, signatures: [] })
    const r2 = applyFormalDailyLog(base, draft, wi, helpers)
    expect(r2.applied).toBe(false)
    expect(r2.state.sources.contractor_summary.status).toBe('pending')
    expect(r2.state.content.daily_log_receipt).toMatchObject({ status: 'pending_input' })
    // 沒有施工日誌:收件情形=none
    expect(applyFormalDailyLog(base, null, wi, helpers).state.content.daily_log_receipt).toEqual({ status: 'none' })
    expect(formalDailyLogFromDetail(null)).toBeNull()
  })
  it('來源短句與引用名稱:查驗／系統紀錄／同日施工日誌文件;引用找得到用標題,找不到只給短碼', () => {
    expect(sourceLabel('inspection:i1')).toBe('查驗紀錄')
    expect(sourceLabel('field_document:d1:v2')).toBe('同日施工日誌文件')
    expect(sourceLabel('system:inspections')).toBe('系統查驗紀錄')
    expect(sourceLabel('system:defects,inspections')).toBe('系統缺失／查驗紀錄')
    expect(sourceLabel('system:field_documents')).toBe('系統文件狀態')
    const lookups = { inspections: [{ id: 'i1', title: '4F 模板查驗' }], defects: [{ id: 'd1', title: '柱箍筋間距過大' }] }
    expect(refTitle({ ref_type: 'inspection', ref_id: 'i1' }, lookups)).toBe('查驗:4F 模板查驗')
    expect(refTitle({ ref_type: 'defect', ref_id: 'd1' }, lookups)).toBe('缺失:柱箍筋間距過大')
    expect(refTitle({ ref_type: 'defect', ref_id: 'zzzzzzzz-0000' }, lookups)).toBe('缺失:zzzzzzzz')
    expect(refTitle({ ref_type: null, ref_id: null }, lookups)).toBeNull()
  })
  it('AI 建議對監造日誌也只補 pending 欄:到場永遠不會被建議帶入(建議本身 pending);附件問題依上傳方標示', () => {
    const base = { content: emptySupervisorLogContent('2026-09-17', tpl), sources: emptySupervisorLogSources(tpl) }
    const suggestion = {
      content: { weather_am: '晴', attendance: [{ name: 'AI 猜的' }], supervision_items: [{ item: '抽查', source: 'ai:photo', photo_ids: ['p1'] }], notices: [], photo_ids: ['p1'], template: { key: 'supervisor_log_demo', version: 1 } },
      field_sources: { weather_am: { status: 'filled', source: 'cwa' }, attendance: { status: 'pending', source: null }, supervision_items: { status: 'filled', source: 'ai:photo' }, notices: { status: 'pending' } },
    }
    const { state, applied } = applySuggestion(base, suggestion)
    expect(applied).toEqual(['weather_am', 'supervision_items'])
    expect(state.content.attendance).toEqual([])
    expect(state.sources.attendance).toEqual({ status: 'pending', source: null })
    expect(state.content.supervision_items).toHaveLength(1)
    expect(state.content.photo_ids).toEqual(['p1'])
    const m = attachmentIssues([{ key: 'attachments.p1', status: 'uploader_org:contractor' }])
    expect(m.get('p1')).toBe('施工廠商上傳的照片,只能以「參考」附上')
  })
})

describe('自主檢查表(P3b):範本推導、內容形狀、逐項確認', () => {
  const frame = demoFieldDocumentTemplate('self_check')
  const tpl = { id: 'T1', title: '混凝土自主檢查表', source: '03310', items: [
    { no: 'B1', item: '已通知監造', kind: 'bool', standard: '≥24 小時' },
    { no: 'C2', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18±2.5' },
  ] }
  it('必填=框架(檢查日期、範本)＋每個範本項目;人填欄=實測值;須確認=全部項目;項目鍵標籤', () => {
    expect(docRequiredKeys('self_check', frame, tpl.items)).toEqual(['check_date', 'results.B1', 'results.C2', 'template_id'])
    expect(docHumanOnlyKeys('self_check', frame, tpl.items)).toEqual(['results.C2'])
    expect(docConfirmRequiredKeys('self_check', frame, tpl.items)).toEqual(['results.B1', 'results.C2'])
    expect(checklistItemKeys(tpl.items, frame, 'human_only')).toEqual(['results.C2'])
    expect(templateConfirmRequiredKeys(demoFieldDocumentTemplate('supervisor_log'))).toEqual(['attendance'])
    expect(checklistItemLabels(tpl.items)).toEqual({ 'results.B1': 'B1 已通知監造', 'results.C2': 'C2 坍度' })
    const c = emptySelfCheckContent('2026-09-17', frame, tpl, { workItemId: 'w1' })
    expect(requiredKeysFor(c, ['results.Z9', 'note'], { docType: 'self_check', template: frame, checklistItems: tpl.items })).toEqual(['check_date', 'note', 'results.B1', 'results.C2', 'template_id'])
    expect(fieldLabel('results.C2', c, checklistItemLabels(tpl.items))).toBe('C2 坍度')
  })
  it('新文件:框架欄人選=confirmed、位置沒填 pending、每項 pending;值改在 results[no].value;不適用清值;換範本重來', () => {
    const c = emptySelfCheckContent('2026-09-17', frame, tpl, { workItemId: 'w1' })
    expect(c).toMatchObject({ check_date: '2026-09-17', template_id: 'T1', template_title: tpl.title, work_item_id: 'w1', location: null, results: { B1: { value: null }, C2: { value: null } }, template: { key: 'self_check_demo', version: 1 } })
    const s = emptySelfCheckSources(c, tpl)
    expect(s).toMatchObject({ check_date: { status: 'confirmed' }, template_id: { status: 'confirmed' }, work_item_id: { status: 'confirmed' }, location: { status: 'pending' }, 'results.B1': { status: 'pending' }, 'results.C2': { status: 'pending' } })
    let st = setFieldValue({ content: c, sources: s }, 'results.C2', 18)
    expect(st.content.results.C2).toEqual({ value: 18 })
    expect(st.sources['results.C2']).toEqual({ status: 'confirmed', source: 'human' })
    expect(selfCheckValues(st.content)).toEqual({ B1: null, C2: 18 })
    st = setFieldNa(st, 'results.C2', '本次未量測')
    expect(st.content.results.C2).toEqual({ value: null })
    expect(st.sources['results.C2']).toEqual({ status: 'na', source: null, reason: '本次未量測' })
    const unmet = unmetFields(docRequiredKeys('self_check', frame, tpl.items), { ...st.sources, 'results.B1': { status: 'filled', source: 'legacy:x' } }, docConfirmRequiredKeys('self_check', frame, tpl.items))
    expect(unmet).toEqual([{ key: 'results.B1', status: 'needs_confirmation' }])
    const swapped = setSelfCheckTemplate(st, { id: 'T2', title: '另一張', source: null, items: [{ no: 'S1', item: '間距', kind: 'num' }] })
    expect(swapped.content).toMatchObject({ template_id: 'T2', results: { S1: { value: null } } })
    expect(Object.keys(swapped.sources).filter((k) => k.startsWith('results.'))).toEqual(['results.S1'])
  })
  it('AI 建議永不帶入檢查結果;來源短句', () => {
    const c = emptySelfCheckContent('2026-09-17', frame, tpl)
    const { state, applied } = applySuggestion({ content: c, sources: emptySelfCheckSources(c, tpl) }, { content: { location: 'A區1F', results: { C2: { value: 18 } } }, field_sources: { location: { status: 'filled', source: 'ai:photo' }, 'results.C2': { status: 'filled', source: 'ai:photo' } } })
    expect(applied).toEqual(['location'])
    expect(state.content.results.C2).toEqual({ value: null })
    expect(sourceLabel('system:template_match')).toBe('依工項挑選範本')
  })
})

// P3d:列印選版本、提送回執、退回歷史、下一責任方(只挑選／排列伺服器列,不重算)
describe('列印版本與提送回執', () => {
  const sig = (version_no, signed_at, over = {}) => ({ id: `G${version_no}`, document_id: 'D1', version_no, content_hash: `h${version_no}`, signer_name_snapshot: '陳怡君', signed_at, ...over })
  it('印簽署列指向的版本:取版本號最大的簽署(更正後重簽);同版本取伺服器時間較晚者;沒有簽署=null(草稿)', () => {
    // getFieldDocument 回新→舊;這裡故意打亂順序
    expect(printSignature([sig(2, '2026-09-19T02:00:00Z'), sig(3, '2026-09-19T05:00:00Z'), sig(1, '2026-09-18T01:00:00Z')]).version_no).toBe(3)
    expect(printSignature([sig(2, '2026-09-19T02:00:00Z', { id: 'a' }), sig(2, '2026-09-19T03:00:00Z', { id: 'b' })]).id).toBe('b')
    expect(printSignature([])).toBeNull()
    expect(printSignature(null)).toBeNull()
  })

  // 施工日誌:v2 提送 → 監造退回 → v3 再送(diff 由 DB 算)→ 監造再退回 → v4 再送 → 監造收件
  const rows = [
    { id: 'S1', document_id: 'D1', action: 'submit', version_no: 2, content_hash: 'h2', actor_id: 'u1', actor_org: 'contractor', to_org: 'supervisor', reason: null, diff: null, created_at: '2026-09-19T01:00:00Z' },
    { id: 'R1', document_id: 'D1', action: 'return', version_no: 2, content_hash: 'h2', actor_id: 'u2', actor_org: 'supervisor', to_org: 'supervisor', reason: '材料使用請補進料證明', diff: null, created_at: '2026-09-19T02:00:00Z' },
    { id: 'S2', document_id: 'D1', action: 'submit', version_no: 3, content_hash: 'h3', actor_id: 'u1', actor_org: 'contractor', to_org: 'supervisor', reason: null, diff: { against_version_no: 2, changed_keys: ['materials'] }, created_at: '2026-09-19T03:00:00Z' },
    { id: 'R2', document_id: 'D1', action: 'return', version_no: 3, content_hash: 'h3', actor_id: 'u3', actor_org: 'supervisor', to_org: 'supervisor', reason: '天氣下午欄漏填', diff: null, created_at: '2026-09-19T04:00:00Z' },
    { id: 'S3', document_id: 'D1', action: 'submit', version_no: 4, content_hash: 'h4', actor_id: 'u1', actor_org: 'contractor', to_org: 'supervisor', reason: null, diff: { against_version_no: 3, changed_keys: ['weather_pm'] }, created_at: '2026-09-19T05:00:00Z' },
    { id: 'C1', document_id: 'D1', action: 'receive', version_no: 4, content_hash: 'h4', actor_id: 'u2', actor_org: 'supervisor', to_org: 'supervisor', reason: null, diff: null, created_at: '2026-09-19T06:00:00Z' },
  ]
  const newestFirst = rows.slice().reverse() // 與 getFieldDocument 的排序一致

  it('提送列一律由舊到新排列', () => {
    expect(submissionsChronological(newestFirst).map((r) => r.id)).toEqual(['S1', 'R1', 'S2', 'R2', 'S3', 'C1'])
  })

  it('退回歷史:歷次退回全列(不只最新),各配上其後相對該退回版本的再送列與 DB 算的差異;尚未再送者為 null', () => {
    const hist = returnHistory(newestFirst)
    expect(hist.map((r) => [r.id, r.version_no, r.reason, r.actor_id])).toEqual([
      ['R1', 2, '材料使用請補進料證明', 'u2'],
      ['R2', 3, '天氣下午欄漏填', 'u3'],
    ])
    expect(hist[0].resubmit).toMatchObject({ id: 'S2', version_no: 3, diff: { against_version_no: 2, changed_keys: ['materials'] } })
    expect(hist[1].resubmit).toMatchObject({ id: 'S3', version_no: 4, diff: { against_version_no: 3, changed_keys: ['weather_pm'] } })
    // 第二次退回後尚未再送
    expect(returnHistory(rows.slice(0, 4))[1].resubmit).toBeNull()
    expect(returnHistory([])).toEqual([])
  })

  it('回執:最近一輪送件的 submit 列(submission_id、伺服器時間、對象)配上對象方的回應', () => {
    const [r] = submissionReceipts(newestFirst)
    expect(r.submit).toMatchObject({ id: 'S3', version_no: 4, to_org: 'supervisor', created_at: '2026-09-19T05:00:00Z' })
    expect(r.response).toMatchObject({ id: 'C1', action: 'receive' })
    // 退回後尚未再送:最近一輪是 v3,回應=退回
    expect(submissionReceipts(rows.slice(0, 4))[0]).toMatchObject({ submit: { id: 'S2' }, response: { id: 'R2', action: 'return' } })
    // 剛送出:待收件
    expect(submissionReceipts(rows.slice(0, 1))[0].response).toBeNull()
    expect(submissionReceipts([])).toEqual([])
  })

  it('回執:同版本送兩個對象(監造查驗表單)各一張回執,各自配對自己的回應', () => {
    const two = [
      { id: 'A', document_id: 'F1', action: 'submit', version_no: 1, actor_org: 'supervisor', to_org: 'contractor', created_at: '2026-09-19T01:00:00Z' },
      { id: 'B', document_id: 'F1', action: 'submit', version_no: 1, actor_org: 'supervisor', to_org: 'owner', created_at: '2026-09-19T01:01:00Z' },
      { id: 'C', document_id: 'F1', action: 'receive', version_no: 1, actor_org: 'owner', to_org: 'owner', created_at: '2026-09-19T02:00:00Z' },
    ]
    const receipts = submissionReceipts(two)
    expect(receipts.map((r) => [r.submit.id, r.response?.id ?? null])).toEqual([['A', null], ['B', 'C']])
  })

  it('下一責任方與今日工作球權同一支判定', () => {
    const doc = (status, current_version_no) => ({ id: 'D1', doc_type: 'daily_log', owner_org: 'contractor', status, current_version_no })
    expect(nextResponsibleText(doc('submitted', 2), rows.slice(0, 1))).toBe('監造（待收件）')
    expect(nextResponsibleText(doc('returned', 2), rows.slice(0, 2))).toBe('施工廠商（被退回待補正）')
    expect(nextResponsibleText(doc('received', 4), rows)).toBe('無（已收件）')
    expect(nextResponsibleText(doc('signed', 1), [])).toBe('施工廠商（待提送）')
  })
})

describe('監造查驗表單(P3c):提送對象矩陣、內容形狀、判定與確認量規則', () => {
  it('提送對象矩陣與 DB fn_field_document_to_org_allowed 逐字一致(解析 migration 原文)', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync(`${process.cwd()}/supabase/migrations/20260917201000_field_documents.sql`, 'utf8')
    const body = sql.slice(sql.indexOf('fn_field_document_to_org_allowed('))
    const fromDb = {}
    for (const m of body.matchAll(/when '([a-z_]+)'\s+then p_to_org (?:= '([a-z]+)'|in \(([^)]+)\))/g)) {
      fromDb[m[1]] = m[2] ? [m[2]] : m[3].split(',').map((x) => x.trim().replace(/'/g, ''))
    }
    expect(fromDb).toEqual({ daily_log: ['supervisor'], self_check: ['supervisor'], supervisor_log: ['owner'], inspection_form: ['contractor', 'owner'] })
    expect(Object.fromEntries(Object.entries(TO_ORGS_BY_DOC_TYPE).map(([k, v]) => [k, [...v]]))).toEqual(fromDb)
    const doc = { doc_type: 'inspection_form', owner_org: 'supervisor', status: 'signed' }
    expect(docToOrgs(doc)).toEqual(['contractor', 'owner'])
    expect(docToOrg(doc)).toBe('contractor')
    expect(docToOrgLabel(doc)).toBe('施工廠商／機關')
    expect(docStatusMeta(doc, 'supervisor').action).toBe('提送給施工廠商／機關')
    expect(docStatusMeta({ ...doc, status: 'submitted' }, 'owner').action).toBe('收件或退回')
    expect(docStatusMeta({ ...doc, status: 'submitted' }, 'contractor').action).toBe('收件或退回')
    expect(docStatusMeta({ ...doc, status: 'received' }, 'contractor').label).toBe('對方已收件')
  })
  it('必要階段:只算 H 點且 required_for_billing,uuid 或 item_key 都對得到,鍵正規化', () => {
    const pts = [
      { work_item_id: 'W1', point_type: 'H', stage_key: ' Rebar ' }, { work_item_id: 'W1', point_type: 'H', stage_key: 'pour', required_for_billing: false },
      { work_item_key: 'K1', point_type: 'H', stage_key: 'Ｐour' }, { work_item_id: 'W1', point_type: 'W', stage_key: 'x' }, { work_item_id: 'W2', point_type: 'H', stage_key: 'z' },
    ]
    expect(requiredStagesFor(pts, ['W1', 'K1'])).toEqual(['pour', 'rebar'])
    expect(requiredStagesFor(pts, 'W3')).toEqual([])
    expect(requiredStagesFor(pts, null)).toEqual([])
  })
  it('空白表單:查驗申請資料帶入待核對、判定與確認量 pending;換範本項目重來', () => {
    const insp = { id: 'I1', title: '3F 版牆查驗', location: '3F 版牆', stage_key: 'rebar', declared_qty: 100, checklist_record_id: 'R1' }
    const wi = { id: 'W1', unit: 'M3' }
    const frame = { key: 'inspection_form_demo', version: 1 }
    const c = emptyInspectionFormContent('2026-09-19', frame, insp, wi)
    expect(c).toMatchObject({ inspection_id: 'I1', work_item_id: 'W1', location: '3F 版牆', stage_key: 'rebar', unit: 'M3', declared_qty: 100, self_check_record_id: 'R1', verdict: null, confirmed_qty: null, template: frame, results: {} })
    const s = emptyInspectionFormSources(c, { requiredStages: ['rebar', 'pour'] })
    expect(s.declared_qty).toMatchObject({ status: 'filled', source: 'inspection:I1' })
    expect(s.location).toMatchObject({ status: 'filled', source: 'inspection:I1' })
    expect(s.stage_key).toMatchObject({ status: 'filled' })
    expect(s.verdict.status).toBe('pending'); expect(s.confirmed_qty.status).toBe('pending')
    expect(emptyInspectionFormSources({ ...c, stage_key: 'bogus' }, { requiredStages: ['rebar'] }).stage_key.status).toBe('pending')
    expect(emptyInspectionFormSources(c, { requiredStages: [] }).stage_key).toBeUndefined()
    const tpl = { id: 'T1', title: '查驗表', items: [{ no: 'B1', kind: 'bool' }] }
    const next = setInspectionFormTemplate({ content: c, sources: s }, tpl)
    expect(next.content.template_id).toBe('T1'); expect(next.content.results).toEqual({ B1: { value: null } })
    expect(next.sources['results.B1'].status).toBe('pending')
    expect(setInspectionFormTemplate(next, null).content.results).toEqual({})
  })
  it('判定與確認量一致性(鏡像 DB):超申報、合格須等於申報、部分合格 0<x<申報、不合格=0、說明必填、單位、階段、項目不合格', () => {
    const wi = { unit: 'M3' }
    const base = { unit: 'M3', declared_qty: 100, verdict: '部分合格', confirmed_qty: 60, result_note: '蜂窩', stage_key: null }
    expect(inspectionFormIssues(base, { workItem: wi })).toEqual([])
    expect(inspectionFormIssues({ ...base, confirmed_qty: 120 }, { workItem: wi }).map((i) => i.key)).toEqual(['confirmed_qty'])
    expect(inspectionFormIssues({ ...base, verdict: '合格' }, { workItem: wi })[0].message).toContain('等於申報數量 100')
    expect(inspectionFormIssues({ ...base, verdict: '合格', confirmed_qty: 100, result_note: null }, { workItem: wi })).toEqual([])
    expect(inspectionFormIssues({ ...base, verdict: '部分合格', confirmed_qty: 100 }, { workItem: wi }).map((i) => i.key)).toEqual(['confirmed_qty'])
    expect(inspectionFormIssues({ ...base, verdict: '不合格', confirmed_qty: 5 }, { workItem: wi }).map((i) => i.key)).toEqual(['confirmed_qty'])
    expect(inspectionFormIssues({ ...base, verdict: '不合格', confirmed_qty: 0, result_note: '' }, { workItem: wi }).map((i) => i.key)).toEqual(['result_note'])
    expect(inspectionFormIssues({ ...base, unit: 'M2' }, { workItem: wi }).map((i) => i.key)).toEqual(['unit'])
    expect(inspectionFormIssues({ ...base, stage_key: 'x' }, { workItem: wi, requiredStages: ['rebar'] }).map((i) => i.key)).toEqual(['stage_key'])
    expect(inspectionFormIssues({ ...base, stage_key: 'x' }, { workItem: wi })).toMatchObject([{ key: 'stage_key' }])
    expect(inspectionFormIssues({ ...base, verdict: '合格', confirmed_qty: 100 }, { workItem: wi, judged: { overall: '不合格', failed: ['C2'] } })[0].message).toContain('C2')
    expect(inspectionFormIssues({ ...base, verdict: null, confirmed_qty: null }, { workItem: wi })).toEqual([])
    expect(INSPECTION_VERDICTS).toEqual(['合格', '部分合格', '不合格'])
  })
  it('此批次目前有效累計:取最新 active,批次鍵與階段鍵正規化;沒有位置回 null', () => {
    const rows = [
      { status: 'active', batch_key: '3f版牆', stage_key: null, qty_cum: 60, confirmed_at: '2026-09-19T01:00:00Z' },
      { status: 'revoked', batch_key: '3f版牆', stage_key: null, qty_cum: 90, confirmed_at: '2026-09-19T02:00:00Z' },
      { status: 'active', batch_key: '3f版牆', stage_key: 'rebar', qty_cum: 10, confirmed_at: '2026-09-19T03:00:00Z' },
    ]
    expect(currentBatchCum(rows, { location: '3F 版牆' })).toBe(60)
    expect(currentBatchCum(rows, { location: '3F 版牆', stageKey: 'Rebar' })).toBe(10)
    expect(currentBatchCum(rows, { location: 'B區' })).toBe(0)
    expect(currentBatchCum(rows, { location: '' })).toBeNull()
  })
})

describe('共用補值(P3e):只呈現伺服器的欄位與效果', () => {
  const W1 = 'a3e30000-0000-0000-0000-000000000001'
  const loc = {
    key: `location:2026-09-18:${W1}`, field: 'location', label: '施作位置', date: '2026-09-18', value_kind: 'text',
    work_item: { id: W1, item_no: '壹.一.1', description: '結構混凝土', unit: 'M3' }, value: 'A區 3F',
    documents: [
      { document_id: 'D1', doc_type: 'daily_log', status: 'pending_input', effect: 'update' },
      { document_id: 'S1', doc_type: 'self_check', status: 'signed', effect: 'locked' },
      { document_id: 'S2', doc_type: 'self_check', status: 'pending_input', effect: 'human_value', current_value: 'B棟 2F', current_source: { status: 'confirmed', source: 'human' } },
    ],
  }
  const qty = { ...loc, key: `qty:2026-09-18:${W1}`, field: 'qty', label: '當日完成數量', value_kind: 'number', value: null, documents: [{ document_id: 'D1', doc_type: 'daily_log', status: 'pending_input', effect: 'update' }] }
  const wx = { key: 'weather_am:2026-09-19', field: 'weather_am', label: '天氣(上午)', date: '2026-09-19', value_kind: 'text', work_item: null, value: null, documents: [] }

  it('標題=欄位＋工項;依日期分組(保留伺服器順序)', () => {
    expect(sharedFieldTitle(loc)).toBe('施作位置・壹.一.1 結構混凝土')
    expect(sharedFieldTitle(wx)).toBe('天氣(上午)')
    expect(groupSharedFields([loc, qty, wx]).map((g) => [g.date, g.fields.map((f) => f.field)])).toEqual([
      ['2026-09-18', ['location', 'qty']], ['2026-09-19', ['weather_am']],
    ])
  })

  it('效果文案:已簽署／提送不受影響、人親自填的不覆蓋、有補值卻未套用標「尚未套用」', () => {
    const [d1, s1, s2] = loc.documents
    expect(sharedEffectLabel(d1, loc)).toBe('尚未套用')
    expect(sharedEffectLabel(d1, qty)).toBe('將寫入')
    expect(sharedEffectLabel(s1, loc)).toBe('已簽署，不受影響')
    expect(sharedEffectLabel({ ...s1, status: 'pending_input' }, loc)).toBe('簽後更正中，不受影響')
    expect(sharedEffectLabel(s2, loc)).toBe('已個別填寫「B棟 2F」，不覆蓋')
    expect(sharedEffectLabel({ ...s2, current_value: null, current_source: { status: 'na', reason: '不分區' } }, loc)).toBe('已標不適用，不覆蓋')
    expect(sharedEffectLabel({ effect: 'applied' }, loc)).toBe('已套用')
    expect(sharedPendingDocs(loc).map((d) => d.document_id)).toEqual(['D1'])
  })

  it('輸入轉型:數量送數字、非數字原樣送(由伺服器回 PD010),文字去頭尾空白', () => {
    expect(sharedInputValue(qty, ' 12.5 ')).toBe(12.5)
    expect(sharedInputValue(qty, '0')).toBe(0)
    expect(sharedInputValue(qty, 'abc')).toBe('abc')
    expect(sharedInputValue(qty, '-3')).toBe(-3)
    expect(sharedInputValue(loc, '  A區 3F ')).toBe('A區 3F')
  })

  it('套用結果一句話:更新的文件與新版本、未變更的原因', () => {
    expect(sharedApplySummary({ documents: [
      { document_id: 'D1', doc_type: 'daily_log', result: 'updated', version_no: 3 },
      { document_id: 'S1', doc_type: 'self_check', result: 'locked', version_no: 3 },
      { document_id: 'S2', doc_type: 'self_check', result: 'human_value', version_no: 3 },
    ] })).toBe('已更新 1 份（施工日誌 版本 3）；1 份已簽署或提送，未變更；1 份已個別填寫，未覆蓋')
    expect(sharedApplySummary({ documents: [{ document_id: 'D1', doc_type: 'daily_log', result: 'unchanged' }] }))
      .toBe('沒有文件需要更新；1 份已是此值')
  })

  it('上傳當下的文件清單以伺服器回傳的新版本號更新(Edge 回應形狀 document_id／store 形狀 id 都認)', () => {
    const res = { documents: [{ document_id: 'D1', result: 'updated', version_no: 2, status: 'pending_input' }, { document_id: 'S1', result: 'locked', version_no: 3 }] }
    expect(documentsAfterShared([{ document_id: 'D1', version_no: 1 }, { id: 'S1', current_version_no: 3 }], res)).toEqual([
      { document_id: 'D1', version_no: 2, current_version_no: 2, status: 'pending_input' }, { id: 'S1', current_version_no: 3 },
    ])
  })
})
