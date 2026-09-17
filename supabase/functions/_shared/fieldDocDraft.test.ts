// 現場文書起稿純規則(P2b):候選推斷、欄位來源、重複照片、日期分組。
// 釘住的紅線:沒來源不猜數量／天氣／出工;不把空白填成「無」「0」「合格」;
// 廠商批次推不出監造文件;未支援的文書列為 unsupported 而不是假裝完成。
import { describe, it, expect } from 'vitest'
import {
  assignPhotoDate, buildDailyLogDraft, draftUnchanged, duplicateGroups, inferCandidates,
  mergeCandidateExclusions, taipeiDateOf, validDate, DAILY_LOG_EXTRAS_KEYS,
} from './fieldDocDraft.ts'
import type { DraftPhoto, LeafWorkItem } from './fieldDocDraft.ts'
import type { WhiteboardResult } from './sitePhotoVision.ts'

const LEAVES: LeafWorkItem[] = [
  { id: 'wi-steel', item_key: 'K1', item_no: '壹.一.1', description: '鋼筋,SD420W,#4(D13),加工及組立', unit: 'T', sort_order: 1 },
  { id: 'wi-form', item_key: 'K2', item_no: '壹.一.2', description: '模板,普通模板,樓版,含支撐', unit: 'M2', sort_order: 2 },
  { id: 'wi-conc', item_key: 'K3', item_no: '壹.一.3', description: '結構用混凝土,預拌,280kgf/cm2,澆置', unit: 'M3', sort_order: 3 },
]

const photo = (over: Partial<DraftPhoto> & { id: string }): DraftPhoto => ({
  storage_path: `p/intake/i1/${over.id}.jpg`, content_sha256: null, work_item_id: null, caption: null, location: null,
  taken_at: '2026-09-17T02:00:00Z', created_at: '2026-09-17T02:00:00Z', classify: null, whiteboard: null, whiteboardSkipped: null,
  ...over,
})
const board = (over: Partial<WhiteboardResult> = {}): WhiteboardResult =>
  ({ log_date: '', weather: '', location: '', work_summary: '', items: [], ...over })

const base = () => ({
  date: '2026-09-17', dateSource: { source: 'intake', refs: [] }, workItems: LEAVES,
  sameDayLog: null, yesterdayLog: null, weather: null, hasBoq: true, notes: [],
})

describe('日期', () => {
  it('validDate 只接受能回轉的 YYYY-MM-DD', () => {
    expect(validDate('2026-09-17')).toBe('2026-09-17')
    expect(validDate('2026-13-40')).toBeNull()
    expect(validDate('26/9/17')).toBeNull()
    expect(validDate('')).toBeNull()
  })
  it('taipeiDateOf 依台北日曆日(UTC 17:00 之後已是隔天)', () => {
    expect(taipeiDateOf('2026-09-17T15:59:00Z')).toBe('2026-09-17')
    expect(taipeiDateOf('2026-09-17T16:30:00Z')).toBe('2026-09-18')
    expect(taipeiDateOf(null)).toBeNull()
  })
  it('assignPhotoDate:告示板 > 批次指定 > 照片時間;板日與照片時間不同要標衝突', () => {
    const p = { id: 'p1', taken_at: '2026-09-17T02:00:00Z' }
    expect(assignPhotoDate(p, board({ log_date: '2026-09-16' }), '2026-09-15')).toMatchObject({ date: '2026-09-16', source: 'whiteboard', ref: 'p1' })
    expect(assignPhotoDate(p, board({ log_date: '2026-09-16' }), null).conflict).toContain('2026-09-16')
    expect(assignPhotoDate(p, board({ log_date: 'x' }), '2026-09-15')).toMatchObject({ date: '2026-09-15', source: 'intake', conflict: null })
    expect(assignPhotoDate(p, null, null)).toMatchObject({ date: '2026-09-17', source: 'photo_time', ref: 'p1' })
    expect(assignPhotoDate({ id: 'p2', taken_at: null }, null, null)).toMatchObject({ date: null, source: null })
  })
})

describe('重複照片', () => {
  it('同雜湊最早上傳者為正本,其餘指向它;無雜湊不判', () => {
    const dups = duplicateGroups([
      { id: 'b', content_sha256: 'a'.repeat(64), created_at: '2026-09-17T01:00:01Z' },
      { id: 'a', content_sha256: 'a'.repeat(64), created_at: '2026-09-17T01:00:00Z' },
      { id: 'c', content_sha256: null, created_at: '2026-09-17T01:00:02Z' },
      { id: 'd', content_sha256: 'b'.repeat(64), created_at: '2026-09-17T01:00:03Z' },
    ])
    expect([...dups.entries()]).toEqual([['b', 'a']])
  })
})

describe('inferCandidates(確定性、依上傳方)', () => {
  const sitePhotos = [
    { id: 'p1', date: '2026-09-17', work_item_id: 'wi-steel' },
    { id: 'p2', date: '2026-09-17', work_item_id: null },
    { id: 'p3', date: '2026-09-18', work_item_id: 'wi-form' },
    { id: 'p4', date: null, work_item_id: null },
  ]
  it('廠商:每個日期一份施工日誌(ready)、無法判日的一份 blocked、自檢表列為 unsupported;絕無監造文件', () => {
    const c = inferCandidates({ uploaderOrg: 'contractor', sitePhotos, openInspections: [{ id: 'ins1', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-17' }] })
    expect(c.filter((x) => x.doc_type === 'daily_log' && x.state === 'ready').map((x) => x.doc_date)).toEqual(['2026-09-17', '2026-09-18'])
    expect(c.find((x) => x.doc_type === 'daily_log' && x.target_key === '2026-09-17')?.photo_ids).toEqual(['p1', 'p2'])
    expect(c.find((x) => x.state === 'blocked')).toMatchObject({ doc_type: 'daily_log', target_key: null, blocked_by: ['log_date'], photo_ids: ['p4'] })
    expect(c.filter((x) => x.doc_type === 'self_check').map((x) => [x.target_key, x.state, x.support])).toEqual([['wi-form', 'unsupported', 'unsupported'], ['wi-steel', 'unsupported', 'unsupported']])
    expect(c.some((x) => x.doc_type === 'supervisor_log' || x.doc_type === 'inspection_form')).toBe(false)
  })
  it('監造:監造日誌與相符的待查驗表單都列出但 unsupported;絕無施工日誌／自檢表', () => {
    const c = inferCandidates({
      uploaderOrg: 'supervisor', sitePhotos,
      openInspections: [
        { id: 'ins-a', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-10' },
        { id: 'ins-b', title: '無關', work_item_id: 'wi-conc', requested_date: '2026-08-01' },
        { id: 'ins-c', title: '當日', work_item_id: null, requested_date: '2026-09-18' },
      ],
    })
    expect(c.filter((x) => x.doc_type === 'supervisor_log').map((x) => [x.doc_date, x.state])).toEqual([['2026-09-17', 'unsupported'], ['2026-09-18', 'unsupported']])
    expect(c.filter((x) => x.doc_type === 'inspection_form').map((x) => x.target_key)).toEqual(['ins-a', 'ins-c'])
    expect(c.every((x) => x.support === 'unsupported')).toBe(true)
    expect(c.some((x) => x.doc_type === 'daily_log' || x.doc_type === 'self_check')).toBe(false)
  })
  it('機關(試用模式管理者)批次不推任何文件', () => {
    expect(inferCandidates({ uploaderOrg: 'owner', sitePhotos, openInspections: [] })).toEqual([])
  })
  it('mergeCandidateExclusions:使用者先前排除的同類同 target 沿用並標 excluded', () => {
    const next = inferCandidates({ uploaderOrg: 'contractor', sitePhotos, openInspections: [] })
    const merged = mergeCandidateExclusions([{ doc_type: 'daily_log', target_key: '2026-09-18', excluded: true }, { doc_type: 'daily_log', target_key: '2026-09-17', excluded: false }], next)
    expect(merged.find((x) => x.target_key === '2026-09-18')).toMatchObject({ excluded: true, state: 'excluded' })
    expect(merged.find((x) => x.target_key === '2026-09-17')).toMatchObject({ excluded: false, state: 'ready' })
  })
})

describe('buildDailyLogDraft:欄位來源', () => {
  it('沒來源就 pending:數量／天氣／出工全部待補,不填「無」或 0;狀態 pending_input', () => {
    const d = buildDailyLogDraft({ ...base(), photos: [photo({ id: 'p1', work_item_id: 'wi-steel', classify: { caption: '一樓鋼筋綁紮', category: '施工作業', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋', visible_progress: '', location: null } })] })
    expect(d.content.items['wi-steel']).toMatchObject({ item_key: 'K1', qty_today: null, location: null })
    expect(d.field_sources['items.wi-steel.qty_today']).toMatchObject({ status: 'pending', source: null })
    expect(d.field_sources.weather_am.status).toBe('pending')
    expect(d.field_sources.weather_pm.status).toBe('pending')
    expect(d.field_sources.labor.status).toBe('pending')
    expect(d.content.labor).toEqual([])
    expect(d.content.weather_am).toBeNull()
    for (const k of DAILY_LOG_EXTRAS_KEYS) expect(d.field_sources[`extras.${k}`].status).toBe('pending')
    expect(d.content.extras).toEqual({})
    expect(JSON.stringify(d.content)).not.toMatch(/"無"|"合格"/)
    expect(d.status).toBe('pending_input')
    expect(d.required_fields).toContain('items.wi-steel.qty_today')
    expect(d.field_sources.work_summary).toMatchObject({ status: 'filled', source: 'ai:photo', refs: ['p1'] })
    expect(d.content.work_summary).toContain('一樓鋼筋綁紮')
    expect(d.attachments).toEqual([{ photo_id: 'p1', storage_path: 'p/intake/i1/p1.jpg' }])
  })

  it('告示板清楚可讀:數量／位置／天氣帶入並附來源照片;板上列出的工項即使沒照片配對也加列', () => {
    const wb = board({ weather: '晴', location: 'A區1F', items: [{ description: '鋼筋加工及組立', quantity: 12.5, unit: 'T', note: '' }, { description: '混凝土澆置', quantity: null, unit: 'M3', note: '' }] })
    const d = buildDailyLogDraft({ ...base(), photos: [photo({ id: 'pb', work_item_id: 'wi-steel', content_sha256: 'c'.repeat(64), whiteboard: wb })] })
    expect(d.content.items['wi-steel']).toMatchObject({ qty_today: 12.5, location: 'A區1F' })
    expect(d.field_sources['items.wi-steel.qty_today']).toEqual({ status: 'filled', source: 'whiteboard:pb', refs: ['pb'] })
    expect(d.field_sources['items.wi-steel.location']).toMatchObject({ status: 'filled', source: 'whiteboard:pb' })
    // 板上有列但沒寫數量:加列、數量仍 pending(null 不是 0)
    expect(d.content.items['wi-conc']).toMatchObject({ qty_today: null })
    expect(d.field_sources['items.wi-conc.qty_today'].status).toBe('pending')
    expect(d.content.weather_am).toBe('晴')
    expect(d.field_sources.weather_am).toMatchObject({ status: 'filled', source: 'whiteboard:pb' })
    expect(d.field_sources.weather_pm.status).toBe('pending')
    expect(d.attachments[0]).toEqual({ photo_id: 'pb', storage_path: 'p/intake/i1/pb.jpg', sha256: 'c'.repeat(64) })
  })

  it('多張告示板同工項數量不一致:不挑一個,pending 並列入 recheck', () => {
    const d = buildDailyLogDraft({ ...base(), photos: [
      photo({ id: 'b1', whiteboard: board({ items: [{ description: '鋼筋', quantity: 10, unit: 'T', note: '' }] }) }),
      photo({ id: 'b2', whiteboard: board({ items: [{ description: '鋼筋', quantity: 12, unit: 'T', note: '' }] }) }),
    ] })
    expect(d.content.items['wi-steel'].qty_today).toBeNull()
    expect(d.field_sources['items.wi-steel.qty_today']).toMatchObject({ status: 'pending', refs: ['b1', 'b2'] })
    expect(d.recheck.some((r) => r.key === 'items.wi-steel.qty_today' && r.reason.includes('不一致'))).toBe(true)
  })

  it('同工項多個位置:pending 要人分列;單一位置才帶入', () => {
    const d = buildDailyLogDraft({ ...base(), photos: [
      photo({ id: 'p1', work_item_id: 'wi-form', location: 'A區' }),
      photo({ id: 'p2', work_item_id: 'wi-form', location: 'B區' }),
      photo({ id: 'p3', work_item_id: 'wi-conc', location: 'C區' }),
    ] })
    expect(d.content.items['wi-form'].location).toBeNull()
    expect(d.field_sources['items.wi-form.location'].status).toBe('pending')
    expect(d.content.items['wi-conc'].location).toBe('C區')
  })

  it('出工／機具／材料沿用昨日並標 yesterday 待核對;當日既有日誌優先於昨日與氣象署;人已填的摘要不被 AI 取代', () => {
    const yesterday = { id: 'y1', log_date: '2026-09-16', weather: null, weather_am: null, weather_pm: null, labor: [{ type: '鋼筋工', count: 6 }], equipment: [], materials: null, extras: null, work_summary: null }
    const d1 = buildDailyLogDraft({ ...base(), photos: [photo({ id: 'p1' })], yesterdayLog: yesterday, weather: { am: '多雲', pm: '陣雨' } })
    expect(d1.content.labor).toEqual([{ type: '鋼筋工', count: 6 }])
    expect(d1.field_sources.labor).toMatchObject({ status: 'filled', source: 'yesterday:y1' })
    expect(d1.field_sources.equipment.status).toBe('pending')
    expect(d1.content.weather_am).toBe('多雲')
    expect(d1.field_sources.weather_am).toMatchObject({ status: 'filled', source: 'cwa' })
    expect(d1.content.weather_pm).toBe('陣雨')

    const sameDay = { id: 's1', log_date: '2026-09-17', weather: '陰', weather_am: null, weather_pm: '雨', labor: [{ type: '模板工', count: 3 }], equipment: [{ name: '吊車', count: 1 }], materials: [], extras: { sampling: '取樣 3 組' }, work_summary: '人填的摘要' }
    const d2 = buildDailyLogDraft({ ...base(), photos: [photo({ id: 'p1', caption: 'AI 說明' })], sameDayLog: sameDay, yesterdayLog: yesterday, weather: { am: '多雲', pm: '陣雨' } })
    expect(d2.content.labor).toEqual([{ type: '模板工', count: 3 }])
    expect(d2.field_sources.labor.source).toBe('legacy:s1')
    expect(d2.content.weather_am).toBe('陰')
    expect(d2.field_sources.weather_am.source).toBe('legacy:s1')
    expect(d2.content.weather_pm).toBe('雨')
    expect(d2.content.work_summary).toBe('人填的摘要')
    expect(d2.field_sources.work_summary.source).toBe('legacy:s1')
    expect(d2.content.extras).toEqual({ sampling: '取樣 3 組' })
    expect(d2.field_sources['extras.sampling'].source).toBe('legacy:s1')
    expect(d2.field_sources['extras.notice'].status).toBe('pending')
  })

  it('未匯標單:不寫任何工項、照片全部待配對並揭露;仍可產生日誌草稿', () => {
    const d = buildDailyLogDraft({ ...base(), workItems: [], hasBoq: false, photos: [photo({ id: 'p1', classify: { caption: '整地', category: '施工作業', is_construction: true, legible: true, has_board: true, work_item_hint: '整地', visible_progress: '', location: null }, whiteboard: board({ items: [{ description: '整地', quantity: 100, unit: 'M2', note: '' }] }) })] })
    expect(d.content.items).toEqual({})
    expect(d.content.unmatched_photo_ids).toEqual(['p1'])
    expect(d.recheck.some((r) => r.reason.includes('尚未匯入標單'))).toBe(true)
    expect(d.required_fields.some((k) => k.startsWith('items.'))).toBe(false)
  })

  it('draftUnchanged:內容與附件都相同才算沒變(鍵序不影響)', () => {
    const a = { content: { b: 1, a: { y: 2, x: 1 } }, attachments: [{ photo_id: 'p' }] }
    const b = { content: { a: { x: 1, y: 2 }, b: 1 }, attachments: [{ photo_id: 'p' }] }
    expect(draftUnchanged(a, b)).toBe(true)
    expect(draftUnchanged(a, { ...b, attachments: [] })).toBe(false)
    expect(draftUnchanged(null, b)).toBe(false)
  })
})
