// 現場文書起稿純規則(P2b／P3a):候選推斷、欄位來源、重複照片、日期分組、監造日誌內容來源。
// 釘住的紅線:沒來源不猜數量／天氣／出工／到場;不把空白填成「無」「0」「合格」;
// 廠商批次推不出監造文件;未支援的文書列為 unsupported 而不是假裝完成;
// 監造日誌的到場永遠留空待人填、通知／追蹤／廠商施工情形只引用系統既有紀錄並標來源。
import { describe, it, expect } from 'vitest'
import {
  assignPhotoDate, buildDailyLogDraft, buildSupervisorLogDraft, draftUnchanged, duplicateGroups, inferCandidates,
  mergeCandidateExclusions, taipeiDateOf, taipeiDayRange, taipeiTimeOf, validDate, DAILY_LOG_EXTRAS_KEYS,
  SUPERVISOR_LOG_REQUIRED_KEYS, SUPERVISOR_LOG_TEMPLATE,
} from './fieldDocDraft.ts'
import type { DayDefect, DayInspection, DraftPhoto, FormalDailyLog, LeafWorkItem } from './fieldDocDraft.ts'
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
  it('taipeiTimeOf／taipeiDayRange:台北時刻與當日的 UTC 區間', () => {
    expect(taipeiTimeOf('2026-09-17T01:05:00Z')).toBe('09:05')
    expect(taipeiTimeOf('2026-09-17T16:30:00Z')).toBe('00:30')
    expect(taipeiTimeOf('x')).toBeNull()
    expect(taipeiDayRange('2026-09-17')).toEqual({ start: '2026-09-16T16:00:00.000Z', end: '2026-09-17T16:00:00.000Z' })
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
  it('監造:每個日期一份監造日誌(ready)、無法判日的一份 blocked;相符的待查驗表單列出但 unsupported;絕無施工日誌／自檢表', () => {
    const c = inferCandidates({
      uploaderOrg: 'supervisor', sitePhotos,
      openInspections: [
        { id: 'ins-a', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-10' },
        { id: 'ins-b', title: '無關', work_item_id: 'wi-conc', requested_date: '2026-08-01' },
        { id: 'ins-c', title: '當日', work_item_id: null, requested_date: '2026-09-18' },
      ],
    })
    expect(c.filter((x) => x.doc_type === 'supervisor_log' && x.state === 'ready').map((x) => [x.doc_date, x.target_key, x.support])).toEqual([['2026-09-17', '2026-09-17', 'supported'], ['2026-09-18', '2026-09-18', 'supported']])
    expect(c.find((x) => x.state === 'blocked')).toMatchObject({ doc_type: 'supervisor_log', target_key: null, blocked_by: ['log_date'], photo_ids: ['p4'] })
    expect(c.filter((x) => x.doc_type === 'inspection_form').map((x) => [x.target_key, x.state])).toEqual([['ins-a', 'unsupported'], ['ins-c', 'unsupported']])
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

  it('FieldDocDraft 共同形狀:施工日誌草稿仍帶 content／field_sources／attachments／required_fields／recheck／status', () => {
    const d = buildDailyLogDraft({ ...base(), photos: [photo({ id: 'p1' })] })
    expect(Object.keys(d).sort()).toEqual(['attachments', 'content', 'field_sources', 'rationale', 'recheck', 'required_fields', 'status', 'summary'])
  })

  it('draftUnchanged:內容與附件都相同才算沒變(鍵序不影響)', () => {
    const a = { content: { b: 1, a: { y: 2, x: 1 } }, attachments: [{ photo_id: 'p' }] }
    const b = { content: { a: { x: 1, y: 2 }, b: 1 }, attachments: [{ photo_id: 'p' }] }
    expect(draftUnchanged(a, b)).toBe(true)
    expect(draftUnchanged(a, { ...b, attachments: [] })).toBe(false)
    expect(draftUnchanged(null, b)).toBe(false)
  })
})

describe('buildSupervisorLogDraft:監造日誌內容來源(P3a)', () => {
  const sBase = () => ({
    date: '2026-09-17', dateSource: { source: 'intake', refs: [] as string[] }, workItems: LEAVES,
    inspections: [] as DayInspection[], openInspections: [], defects: [] as DayDefect[], dailyLog: null as FormalDailyLog | null,
    weather: null, hasBoq: true, notes: [] as string[],
  })
  const sPhoto = (id: string, over: Partial<DraftPhoto> = {}): DraftPhoto => photo({
    id, taken_at: '2026-09-17T01:10:00Z',
    classify: { caption: '鋼筋綁紮抽查', category: '查驗會勘', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋', visible_progress: '柱主筋已綁紮', location: 'A區1F' },
    ...over,
  })
  const formalLog = (over: Partial<FormalDailyLog> = {}): FormalDailyLog => ({
    document_id: 'dl1', status: 'signed', version_no: 3,
    content: { work_summary: '3F 版牆混凝土澆置', weather_am: '晴', weather_pm: '陣雨', items: { 'wi-conc': { qty_today: 12, unit: 'M3' }, 'wi-form': { qty_today: null } } },
    signed_at: '2026-09-17T09:00:00Z', submitted_at: '2026-09-17T09:30:00Z', received_at: null, returned_at: null, ...over,
  })

  it('到場永遠留空且 pending(任何照片都不是到場證明);狀態 pending_input;範本鍵=示範範本;必填鍵鏡像 DB 範本', () => {
    const d = buildSupervisorLogDraft({ ...sBase(), photos: [sPhoto('s1', { work_item_id: 'wi-steel' })], dailyLog: formalLog(), weather: { am: '多雲', pm: '多雲' } })
    expect(d.content.attendance).toEqual([])
    expect(d.field_sources.attendance).toMatchObject({ status: 'pending', source: null })
    expect(d.recheck.some((r) => r.key === 'attendance')).toBe(true)
    expect(d.status).toBe('pending_input')
    expect(d.content.template).toEqual(SUPERVISOR_LOG_TEMPLATE)
    expect(d.required_fields).toEqual([...SUPERVISOR_LOG_REQUIRED_KEYS])
    expect(d.attachments).toEqual([{ photo_id: 's1', storage_path: 'p/intake/i1/s1.jpg' }])
    expect(JSON.stringify(d.content)).not.toMatch(/"無"|"合格"|"已到場"/)
  })

  it('監造事項:配到工項的照片併成一項(時間、位置、說明、來源 ai:photo)、未配對照片逐張列、當日判定的查驗各一項(來源 inspection:<id>)', () => {
    const inspections: DayInspection[] = [
      { id: 'ins-1', title: '3F 鋼筋查驗', status: '合格', work_item_id: 'wi-steel', location: '3F', inspection_type: '施工查驗', requested_date: '2026-09-17', inspected_at: '2026-09-17T03:00:00Z', result_note: '間距符合' },
      { id: 'ins-2', title: '昨日判定', status: '不合格', work_item_id: null, location: null, inspection_type: null, requested_date: '2026-09-17', inspected_at: '2026-09-16T03:00:00Z', result_note: null },
      { id: 'ins-3', title: '今日申請', status: '待查驗', work_item_id: null, location: null, inspection_type: null, requested_date: '2026-09-17', inspected_at: null, result_note: null },
    ]
    const d = buildSupervisorLogDraft({ ...sBase(), inspections, photos: [
      sPhoto('s1', { work_item_id: 'wi-steel' }), sPhoto('s2', { work_item_id: 'wi-steel', taken_at: '2026-09-17T00:40:00Z', location: 'A區1F' }),
      sPhoto('s3', { classify: { caption: '工地環境巡查', category: '工地環境', is_construction: true, legible: true, has_board: false, work_item_hint: '', visible_progress: '圍籬完整', location: null } }),
    ] })
    const items = d.content.supervision_items
    expect(items.map((i) => i.source)).toEqual(['ai:photo', 'ai:photo', 'inspection:ins-1'])
    expect(items[0]).toMatchObject({ time: '08:40', item: '抽查 壹.一.1 鋼筋,SD420W,#4(D13),加工及組立', location: 'A區1F', work_item_id: 'wi-steel', note: '鋼筋綁紮抽查', photo_ids: ['s1', 's2'] })
    expect(items[1]).toMatchObject({ time: '09:10', item: '工地環境巡查', work_item_id: null, note: '圍籬完整', photo_ids: ['s3'] })
    expect(items[2]).toMatchObject({ time: '11:00', item: '查驗:3F 鋼筋查驗(合格)', location: '3F', work_item_id: 'wi-steel', note: '間距符合', photo_ids: [] })
    expect(d.field_sources.supervision_items).toMatchObject({ status: 'filled', source: 'ai:photo', refs: ['s1', 's2', 's3', 'ins-1'] })
    // 當日查驗=申請日當日或當日判定;昨日判定的 ins-2 雖申請日是今天也列入(申請日相符),但不是「今日判定」的監造事項
    expect(d.content.inspection_ids).toEqual(['ins-1', 'ins-2', 'ins-3'])
    expect(d.field_sources.inspection_ids).toMatchObject({ status: 'filled', source: 'system:inspections' })
    expect(d.content.unmatched_photo_ids).toEqual(['s3'])
  })

  it('沒有監造照片與當日查驗:監造事項 pending、查驗空陣列仍是系統事實;不捏造', () => {
    const d = buildSupervisorLogDraft({ ...sBase(), photos: [] })
    expect(d.content.supervision_items).toEqual([])
    expect(d.field_sources.supervision_items.status).toBe('pending')
    expect(d.content.inspection_ids).toEqual([])
    expect(d.field_sources.inspection_ids).toMatchObject({ status: 'filled', source: 'system:inspections', reason: expect.stringContaining('無當日查驗') })
    expect(d.field_sources.notices.status).toBe('pending')
    expect(d.field_sources.followups.status).toBe('pending')
    expect(d.field_sources.contractor_summary).toMatchObject({ status: 'pending' })
    expect(d.content.daily_log_receipt).toEqual({ status: 'none' })
  })

  it('通知只帶當日開立的缺失與當日不合格查驗(同一查驗已開缺失不重複);追蹤=未結案缺失＋待查驗;逐項附 ref', () => {
    const defects: DayDefect[] = [
      { id: 'df-1', title: '柱箍筋間距過大', status: '開立', severity: '一般', location: '3F', due_date: '2026-09-20', created_at: '2026-09-17T05:00:00Z', inspection_id: 'ins-x' },
      { id: 'df-old', title: '舊缺失', status: '改善中', severity: null, location: null, due_date: null, created_at: '2026-09-01T05:00:00Z', inspection_id: null },
      { id: 'df-closed', title: '已結', status: '已結案', severity: null, location: null, due_date: null, created_at: '2026-09-17T05:00:00Z', inspection_id: null },
    ]
    const inspections: DayInspection[] = [
      { id: 'ins-x', title: '模板查驗', status: '不合格', work_item_id: 'wi-form', location: null, inspection_type: null, requested_date: null, inspected_at: '2026-09-17T04:00:00Z', result_note: '支撐不足' },
      { id: 'ins-y', title: '無缺失列的不合格', status: '不合格', work_item_id: null, location: null, inspection_type: null, requested_date: null, inspected_at: '2026-09-17T06:00:00Z', result_note: null },
    ]
    const d = buildSupervisorLogDraft({ ...sBase(), photos: [], defects, inspections, openInspections: [{ id: 'ins-open', title: '待查驗的', work_item_id: null, requested_date: '2026-09-18' }] })
    expect(d.content.notices.map((n) => [n.ref_type, n.ref_id])).toEqual([['inspection', 'ins-y'], ['defect', 'df-closed'], ['defect', 'df-1']])
    expect(d.content.notices.find((n) => n.ref_id === 'df-1')?.content).toContain('改善期限 2026-09-20')
    expect(d.content.notices.every((n) => n.to === 'contractor')).toBe(true)
    expect(d.field_sources.notices).toMatchObject({ status: 'filled', source: 'system:defects' })
    expect(d.content.followups.map((f) => [f.ref_type, f.ref_id, f.status])).toEqual([['inspection', 'ins-open', 'open'], ['defect', 'df-1', 'open'], ['defect', 'df-old', 'open']])
    expect(d.field_sources.followups.status).toBe('filled')
  })

  it('廠商施工情形只引用已簽署／已提送的施工日誌文件並標來源;草稿／退回的不引用;收件情形記錄該文件現況', () => {
    const d1 = buildSupervisorLogDraft({ ...sBase(), photos: [], dailyLog: formalLog() })
    expect(d1.content.contractor_summary).toBe('3F 版牆混凝土澆置;數量:壹.一.3 結構用混凝土,預拌,280kgf/cm2,澆置 12M3(依廠商施工日誌 v3)')
    expect(d1.field_sources.contractor_summary).toMatchObject({ status: 'filled', source: 'field_document:dl1:v3' })
    expect(d1.content.daily_log_receipt).toEqual({ document_id: 'dl1', version_no: 3, status: 'signed', signed_at: '2026-09-17T09:00:00Z', submitted_at: '2026-09-17T09:30:00Z', received_at: null, returned_at: null })
    expect(d1.field_sources.daily_log_receipt).toMatchObject({ status: 'filled', source: 'system:field_documents', refs: ['dl1'] })
    expect(d1.content.weather_am).toBe('晴')
    expect(d1.field_sources.weather_am).toMatchObject({ status: 'filled', source: 'field_document:dl1:v3' })

    const d2 = buildSupervisorLogDraft({ ...sBase(), photos: [], dailyLog: formalLog({ status: 'pending_input', version_no: 1 }) })
    expect(d2.content.contractor_summary).toBeNull()
    expect(d2.field_sources.contractor_summary).toMatchObject({ status: 'pending', reason: expect.stringContaining('尚未簽署') })
    expect(d2.content.daily_log_receipt).toMatchObject({ document_id: 'dl1', status: 'pending_input' })
    expect(d2.field_sources.weather_am.status).toBe('pending')

    const d3 = buildSupervisorLogDraft({ ...sBase(), photos: [], dailyLog: formalLog({ status: 'returned', returned_at: '2026-09-17T10:00:00Z' }) })
    expect(d3.field_sources.contractor_summary).toMatchObject({ status: 'pending', reason: expect.stringContaining('已退回') })
  })

  it('天氣:已簽署施工日誌 > 中央氣象署 > pending;未匯標單時照片全部待配對但仍逐張列為監造事項', () => {
    const d1 = buildSupervisorLogDraft({ ...sBase(), photos: [], weather: { am: '多雲', pm: null } })
    expect(d1.content.weather_am).toBe('多雲')
    expect(d1.field_sources.weather_am).toMatchObject({ status: 'filled', source: 'cwa' })
    expect(d1.field_sources.weather_pm.status).toBe('pending')

    const d2 = buildSupervisorLogDraft({ ...sBase(), workItems: [], hasBoq: false, photos: [sPhoto('s1')] })
    expect(d2.content.unmatched_photo_ids).toEqual(['s1'])
    expect(d2.content.supervision_items).toHaveLength(1)
    expect(d2.content.supervision_items[0].work_item_id).toBeNull()
    expect(d2.recheck.some((r) => r.reason.includes('尚未匯入標單'))).toBe(true)
  })
})
