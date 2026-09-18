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
} from './fieldDocs.js'

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
  it('狀態文案依觀看者:廠商看自己的文件有動作,監造只在已提送時有收件動作', () => {
    expect(docStatusMeta({ status: 'pending_input', owner_org: 'contractor', recheck: [{ key: 'labor' }] }, 'contractor')).toMatchObject({ label: '待補 1', action: '補齊後簽署' })
    expect(docStatusMeta({ status: 'signed', owner_org: 'contractor' }, 'contractor').action).toBe('提送給監造')
    expect(docStatusMeta({ status: 'submitted', owner_org: 'contractor' }, 'supervisor').action).toBe('收件或退回')
    expect(docStatusMeta({ status: 'submitted', owner_org: 'contractor' }, 'contractor').action).toBeNull()
    expect(docStatusMeta({ status: 'returned', owner_org: 'contractor' }, 'contractor')).toMatchObject({ tone: 'red', action: '補正後重新簽署' })
  })
  it('簽署意願文字含日期、版本與雜湊前 12 碼', () => {
    expect(signIntentText({ docDate: '2026-09-17', versionNo: 2, contentHash: 'abcdef0123456789ff' })).toBe(
      '本人確認 2026-09-17 施工日誌(版本 2,內容雜湊 abcdef012345)內容屬實,同意以平台帳號及兩步驟驗證簽署本文件。')
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
  it('PD 錯誤碼分流:舊版／雜湊→reload、aal→mfa、待補與附件帶 detail 清單、request id 衝突', () => {
    expect(fieldDocErrorGuidance({ code: 'PD001', message: '舊版' })).toMatchObject({ kind: 'reload' })
    expect(fieldDocErrorGuidance({ code: 'PD002', message: '雜湊不符' })).toMatchObject({ kind: 'reload' })
    expect(fieldDocErrorGuidance({ code: 'PD003', message: '需要兩步驟驗證' })).toMatchObject({ kind: 'mfa' })
    expect(fieldDocErrorGuidance({ code: 'PD004', message: '待補', details: '[{"key":"labor","status":"pending"}]' })).toEqual({ kind: 'pending', message: '待補', details: [{ key: 'labor', status: 'pending' }] })
    expect(fieldDocErrorGuidance({ code: 'PD005', message: '附件', details: 'not json' })).toEqual({ kind: 'attachments', message: '附件', details: [] })
    expect(fieldDocErrorGuidance({ code: 'PD009', message: 'id 衝突' }).kind).toBe('request_id')
    expect(fieldDocErrorGuidance({ code: 'PD008', message: '狀態' }).kind).toBe('state')
    expect(fieldDocErrorGuidance({ code: '42501', message: 'permission denied' }).kind).toBe('unknown')
  })
})
