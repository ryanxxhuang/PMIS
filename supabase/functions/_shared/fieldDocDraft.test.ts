// 現場文書起稿純規則(P2b／P3a):候選推斷、欄位來源、重複照片、日期分組、監造日誌內容來源。
// 釘住的紅線:沒來源不猜數量／天氣／出工／到場;不把空白填成「無」「0」「合格」;
// 廠商批次推不出監造文件;未支援的文書列為 unsupported 而不是假裝完成;
// 監造日誌的到場永遠留空待人填、通知／追蹤／廠商施工情形只引用系統既有紀錄並標來源。
import { describe, it, expect } from 'vitest'
import {
  assignPhotoDate, buildDailyLogDraft, buildInspectionFormDraft, buildSelfCheckDraft, buildSupervisorLogDraft, draftUnchanged, duplicateGroups, inferCandidates,
  matchChecklistItem, mergeCandidateExclusions, taipeiDateOf, taipeiDayRange, taipeiTimeOf, validDate, DAILY_LOG_EXTRAS_KEYS,
} from './fieldDocDraft.ts'
import type { ChecklistTemplateRow, DayDefect, DayInspection, DraftPhoto, FormalDailyLog, LeafWorkItem } from './fieldDocDraft.ts'
import { templateRequiredKeys } from './fieldDocTemplate.ts'
import type { FieldDocTemplate } from './fieldDocTemplate.ts'
import type { WhiteboardResult } from './sitePhotoVision.ts'
// 範本單一定義在 DB;測試用示範模式 fixture(demoFieldDocTemplates.test.js 對 migration 原文釘住)代替執行期取回
import { demoFieldDocumentTemplate } from '../../../src/data/demoFieldDocTemplates.js'
const SUP_TPL = demoFieldDocumentTemplate('supervisor_log') as FieldDocTemplate
const SC_FRAME = demoFieldDocumentTemplate('self_check') as FieldDocTemplate
const IF_FRAME = demoFieldDocumentTemplate('inspection_form') as FieldDocTemplate
// 本案檢查表範本(checklist_templates 列)
const T_CONC: ChecklistTemplateRow = { id: 'tpl-conc', title: '場鑄結構用混凝土 自主檢查表', source: '03310', items: [
  { no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時前通知' },
  { no: 'C2', group: '澆置中', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18±2.5' },
  { no: 'C3', group: '澆置中', item: '上下層澆置間隔', kind: 'num', max: 45, unit: '分', standard: '≤45 分鐘' },
] }
const T_STEEL: ChecklistTemplateRow = { id: 'tpl-steel', title: '鋼筋 自主檢查表', source: '03210', items: [
  { no: 'S1', item: '鋼筋間距', kind: 'num', max: 30, unit: 'cm', standard: '≤30' },
] }

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
  it('廠商:每個日期一份施工日誌(ready)、無法判日的一份 blocked;沒有檢查表範本時自檢表 blocked(不假裝有範本);絕無監造文件', () => {
    const c = inferCandidates({ uploaderOrg: 'contractor', sitePhotos, openInspections: [{ id: 'ins1', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-17' }], workItems: LEAVES, checklistTemplates: [] })
    expect(c.filter((x) => x.doc_type === 'daily_log' && x.state === 'ready').map((x) => x.doc_date)).toEqual(['2026-09-17', '2026-09-18'])
    expect(c.find((x) => x.doc_type === 'daily_log' && x.target_key === '2026-09-17')?.photo_ids).toEqual(['p1', 'p2'])
    expect(c.find((x) => x.doc_type === 'daily_log' && x.state === 'blocked')).toMatchObject({ target_key: null, blocked_by: ['log_date'], photo_ids: ['p4'] })
    expect(c.filter((x) => x.doc_type === 'self_check').map((x) => [x.target_key, x.state, x.blocked_by, x.template_id])).toEqual([
      ['2026-09-18:wi-form', 'blocked', ['checklist_template'], null], ['2026-09-17:wi-steel', 'blocked', ['checklist_template'], null],
    ])
    expect(c.find((x) => x.doc_type === 'self_check')?.reason).toContain('尚未建立自主檢查表範本')
    expect(c.some((x) => x.doc_type === 'supervisor_log' || x.doc_type === 'inspection_form')).toBe(false)
  })
  it('廠商:有檢查表範本時每個「配到工項 × 日期」一份自檢表(ready),範本依工項描述確定性挑選並附理由;挑不出→blocked 待人指定', () => {
    const c = inferCandidates({ uploaderOrg: 'contractor', sitePhotos, openInspections: [], workItems: LEAVES, checklistTemplates: [T_CONC, T_STEEL] })
    const sc = c.filter((x) => x.doc_type === 'self_check')
    expect(sc.map((x) => [x.target_key, x.doc_date, x.state, x.work_item_id, x.template_id, x.photo_ids])).toEqual([
      ['2026-09-18:wi-form', '2026-09-18', 'blocked', 'wi-form', null, ['p3']],       // 模板工項對兩張範本標題都 0 分 → 不猜
      ['2026-09-17:wi-steel', '2026-09-17', 'ready', 'wi-steel', 'tpl-steel', ['p1']], // 鋼筋 → 鋼筋範本
    ])
    expect(sc[0].reason).toContain('無法判斷該用哪張檢查表範本')
    expect(sc[1].reason).toContain('鋼筋 自主檢查表')
    // 只有一張範本:直接用
    const one = inferCandidates({ uploaderOrg: 'contractor', sitePhotos, openInspections: [], workItems: LEAVES, checklistTemplates: [T_CONC] })
    expect(one.filter((x) => x.doc_type === 'self_check').map((x) => [x.state, x.template_id])).toEqual([['ready', 'tpl-conc'], ['ready', 'tpl-conc']])
    // 未配對／無法判日的照片不產生自檢表
    expect(sc.some((x) => x.photo_ids.includes('p2') || x.photo_ids.includes('p4'))).toBe(false)
  })
  it('監造:每個日期一份監造日誌(ready)、無法判日的一份 blocked;相符的待查驗各一份查驗表單(有工項 ready、無工項 blocked);絕無施工日誌／自檢表', () => {
    const T_INS: ChecklistTemplateRow = { id: 'tpl-ins-steel', title: '鋼筋 監造查驗表', source: '03210', kind: 'inspection_form', items: [{ no: 'S1', item: '鋼筋間距', kind: 'num', max: 30 }] }
    const c = inferCandidates({
      uploaderOrg: 'supervisor', sitePhotos, workItems: LEAVES, checklistTemplates: [T_CONC, T_INS],
      openInspections: [
        { id: 'ins-a', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-10', location: 'A區', declared_qty: 12, stage_key: null },
        { id: 'ins-b', title: '無關', work_item_id: 'wi-conc', requested_date: '2026-08-01' },
        { id: 'ins-c', title: '當日', work_item_id: null, requested_date: '2026-09-18' },
        { id: 'ins-d', title: '工項非末端', work_item_id: 'wi-x', requested_date: '2026-09-18' },
      ],
    })
    expect(c.filter((x) => x.doc_type === 'supervisor_log' && x.state === 'ready').map((x) => [x.doc_date, x.target_key, x.support])).toEqual([['2026-09-17', '2026-09-17', 'supported'], ['2026-09-18', '2026-09-18', 'supported']])
    expect(c.find((x) => x.doc_type === 'supervisor_log' && x.state === 'blocked')).toMatchObject({ target_key: null, blocked_by: ['log_date'], photo_ids: ['p4'] })
    const ins = c.filter((x) => x.doc_type === 'inspection_form')
    expect(ins.map((x) => [x.target_key, x.state, x.doc_date, x.work_item_id, x.template_id])).toEqual([
      ['ins-a', 'ready', '2026-09-17', 'wi-steel', 'tpl-ins-steel'],   // 工項相符:日期取相符照片最早日;自檢表範本不會被拿來當查驗表
      ['ins-c', 'blocked', '2026-09-18', null, null],
      ['ins-d', 'blocked', '2026-09-18', 'wi-x', null],
    ])
    expect(ins[0].photo_ids).toEqual(['p1'])
    expect(ins[0].support).toBe('supported')
    expect(ins[1].blocked_by).toEqual(['work_item'])
    expect(ins[2].blocked_by).toEqual(['work_item'])
    expect(c.some((x) => x.doc_type === 'daily_log' || x.doc_type === 'self_check')).toBe(false)
    expect(c.some((x) => x.state === 'unsupported')).toBe(false)
  })
  it('廠商:自檢表候選只用 kind=self_check 的範本(監造查驗表範本不算「本案有自檢表範本」)', () => {
    const onlyIns = inferCandidates({ uploaderOrg: 'contractor', sitePhotos, openInspections: [], workItems: LEAVES,
      checklistTemplates: [{ id: 'tpl-ins', title: '混凝土 監造查驗表', source: null, kind: 'inspection_form', items: [] }] })
    expect(onlyIns.filter((x) => x.doc_type === 'self_check').map((x) => [x.state, x.blocked_by])).toEqual([['blocked', ['checklist_template']], ['blocked', ['checklist_template']]])
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
    weather: null, template: SUP_TPL, hasBoq: true, notes: [] as string[],
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

  it('到場永遠留空且 pending(任何照片都不是到場證明);狀態 pending_input;範本鍵／必填鍵取自傳入的 DB 範本', () => {
    const d = buildSupervisorLogDraft({ ...sBase(), photos: [sPhoto('s1', { work_item_id: 'wi-steel' })], dailyLog: formalLog(), weather: { am: '多雲', pm: '多雲' } })
    expect(d.content.attendance).toEqual([])
    expect(d.field_sources.attendance).toMatchObject({ status: 'pending', source: null })
    expect(d.recheck.some((r) => r.key === 'attendance')).toBe(true)
    expect(d.status).toBe('pending_input')
    expect(d.content.template).toEqual({ key: 'supervisor_log_demo', version: 1 })
    expect(d.required_fields).toEqual(templateRequiredKeys(SUP_TPL))
    expect(d.summary).toContain('示範範本')
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

describe('buildSelfCheckDraft:自主檢查表內容來源(P3b)', () => {
  const steel = LEAVES[0]
  const cPhoto = (id: string, over: Partial<DraftPhoto> = {}): DraftPhoto => photo({
    id, work_item_id: 'wi-steel',
    classify: { caption: '鋼筋綁紮', category: '施工作業', is_construction: true, legible: true, has_board: false, work_item_hint: '鋼筋', visible_progress: '', location: 'A區1F' },
    ...over,
  })
  const cBase = () => ({ date: '2026-09-17', dateSource: { source: 'intake', refs: [] as string[] }, workItem: steel, template: T_CONC, templateReason: '本案僅有這一張範本', frame: SC_FRAME, hasBoq: true, notes: [] as string[] })

  it('每個項目一律 pending:實測值待人量測、勾選項不代為勾選;範本／工項／位置／佐證由照片帶入並標來源;必填=框架＋每項;絕不出現「合格」', () => {
    const d = buildSelfCheckDraft({ ...cBase(), photos: [cPhoto('c1'), cPhoto('c2')] })
    expect(d.content).toMatchObject({ check_date: '2026-09-17', template_id: 'tpl-conc', template_title: T_CONC.title, work_item_id: 'wi-steel', location: 'A區1F', note: null, template: { key: 'self_check_demo', version: 1 }, photo_ids: ['c1', 'c2'] })
    expect(d.content.results).toEqual({ B1: { value: null }, C2: { value: null }, C3: { value: null } })
    expect(d.field_sources.template_id).toMatchObject({ status: 'filled', source: 'system:template_match', reason: '本案僅有這一張範本' })
    expect(d.field_sources.work_item_id).toMatchObject({ status: 'filled', source: 'ai:photo', refs: ['c1', 'c2'] })
    expect(d.field_sources.location).toMatchObject({ status: 'filled', source: 'ai:photo' })
    expect(d.field_sources['results.B1']).toMatchObject({ status: 'pending', source: null })
    expect(d.field_sources['results.C2']).toMatchObject({ status: 'pending', source: null })
    expect(d.field_sources['results.C2'].hint).toBeUndefined()
    expect(d.required_fields).toEqual(['check_date', 'results.B1', 'results.C2', 'results.C3', 'template_id'])
    expect(d.recheck.map((r) => r.key)).toEqual(['results.B1', 'results.C2', 'results.C3'])
    expect(d.status).toBe('pending_input')
    expect(d.attachments).toEqual([{ photo_id: 'c1', storage_path: 'p/intake/i1/c1.jpg' }, { photo_id: 'c2', storage_path: 'p/intake/i1/c2.jpg' }])
    expect(JSON.stringify(d.content)).not.toMatch(/"合格"|"pass"|true/)
    expect(d.summary).toContain('實測值 2 項')
    expect(d.summary).toContain('示範範本')
  })

  it('告示板寫出對應項目的讀數:只放 hint 不填值(值仍 null、仍 pending);多板不一致不給 hint;對不到的項目不猜', () => {
    const wb = (items: WhiteboardResult['items']) => board({ items })
    const d = buildSelfCheckDraft({ ...cBase(), photos: [
      cPhoto('b1', { whiteboard: wb([{ description: '坍度 18cm', quantity: 18, unit: 'cm', note: '' }, { description: '澆置溫度', quantity: 28, unit: '℃', note: '' }]) }),
      cPhoto('b2', { whiteboard: wb([{ description: '坍度', quantity: 18, unit: 'cm', note: '' }, { description: '上下層澆置間隔', quantity: 30, unit: '分', note: '' }]) }),
      cPhoto('b3', { whiteboard: wb([{ description: '上下層澆置間隔', quantity: 40, unit: '分', note: '' }]) }),
    ] })
    expect(d.content.results.C2).toEqual({ value: null })
    expect(d.field_sources['results.C2']).toMatchObject({ status: 'pending', refs: ['b1', 'b2'], hint: { value: 18, unit: 'cm', source: 'whiteboard:b1' } })
    expect(d.field_sources['results.C2'].reason).toContain('僅供參考')
    expect(d.field_sources['results.C3']).toMatchObject({ status: 'pending' })
    expect(d.field_sources['results.C3'].hint).toBeUndefined()
    expect(d.field_sources['results.C3'].reason).toContain('不一致(30、40)')
    expect(d.status).toBe('pending_input')
    expect(matchChecklistItem('坍度 18cm', T_CONC.items)?.no).toBe('C2')
    expect(matchChecklistItem('澆置溫度', T_CONC.items)).toBeNull()
    expect(matchChecklistItem('度', T_CONC.items)).toBeNull()
  })

  it('位置:多個位置要人選、沒有位置 pending;沒有項目的範本列 recheck 提醒換範本', () => {
    const d = buildSelfCheckDraft({ ...cBase(), photos: [cPhoto('c1'), cPhoto('c2', { classify: { ...cPhoto('c2').classify!, location: 'B區2F' } })] })
    expect(d.content.location).toBeNull()
    expect(d.field_sources.location).toMatchObject({ status: 'pending' })
    expect(d.field_sources.location.reason).toContain('A區1F、B區2F')
    const none = buildSelfCheckDraft({ ...cBase(), photos: [cPhoto('c1', { classify: { ...cPhoto('c1').classify!, location: null } })] })
    expect(none.field_sources.location).toMatchObject({ status: 'pending' })
    const empty = buildSelfCheckDraft({ ...cBase(), template: { ...T_CONC, items: [] }, photos: [cPhoto('c1')] })
    expect(empty.required_fields).toEqual(['check_date', 'template_id'])
    expect(empty.recheck.some((r) => r.key === 'template_id' && r.reason.includes('沒有任何檢查項目'))).toBe(true)
  })
})

describe('buildInspectionFormDraft:監造查驗表單內容來源(P3c)', () => {
  const T_INS: ChecklistTemplateRow = { id: 'tpl-ins', title: '鋼筋 監造查驗表', source: '03210', kind: 'inspection_form', items: [
    { no: 'S1', item: '鋼筋間距', kind: 'num', max: 30, unit: 'cm', standard: '≤30' },
    { no: 'S2', item: '保護層符合圖說', kind: 'bool' },
  ] }
  const insp = { id: 'ins-a', title: '鋼筋查驗', work_item_id: 'wi-steel', requested_date: '2026-09-17', location: 'A區1F', declared_qty: 12.5, unit: 'T', stage_key: null, checklist_record_id: 'rec-1' }
  const iBase = () => ({
    date: '2026-09-17', dateSource: { source: 'intake', refs: [] as string[] }, photos: [] as DraftPhoto[], inspection: insp, workItem: LEAVES[0],
    requiredStages: [] as string[], template: T_INS as ChecklistTemplateRow | null, templateReason: '依工項描述挑選', frame: IF_FRAME, hasBoq: true, notes: [] as string[],
  })
  it('查驗申請資料帶入待核對、單位取自工項;判定與確認量永遠留空 pending;項目 pending;附件與必填鍵', () => {
    const d = buildInspectionFormDraft({ ...iBase(), photos: [photo({ id: 's1', whiteboard: board({ items: [{ description: '鋼筋間距', quantity: 25, unit: 'cm' }] }) })] })
    expect(d.content).toMatchObject({ inspection_date: '2026-09-17', inspection_id: 'ins-a', inspection_title: '鋼筋查驗', work_item_id: 'wi-steel', location: 'A區1F', stage_key: null, unit: 'T', declared_qty: 12.5, self_check_record_id: 'rec-1', template_id: 'tpl-ins', verdict: null, confirmed_qty: null, template: { key: 'inspection_form_demo', version: 1 }, photo_ids: ['s1'] })
    expect(d.content.results).toEqual({ S1: { value: null }, S2: { value: null } })
    expect(d.field_sources.location).toMatchObject({ status: 'filled', source: 'inspection:ins-a' })
    expect(d.field_sources.declared_qty).toMatchObject({ status: 'filled', source: 'inspection:ins-a' })
    expect(d.field_sources.unit).toMatchObject({ status: 'filled', source: 'system:work_item' })
    expect(d.field_sources.verdict).toMatchObject({ status: 'pending', source: null })
    expect(d.field_sources.confirmed_qty).toMatchObject({ status: 'pending', source: null })
    expect(d.field_sources.stage_key).toBeUndefined()
    expect(d.field_sources['results.S1']).toMatchObject({ status: 'pending', hint: { value: 25, unit: 'cm', source: 'whiteboard:s1' } })
    expect(d.field_sources['results.S2']).toMatchObject({ status: 'pending' })
    expect(d.required_fields).toEqual(['confirmed_qty', 'declared_qty', 'inspection_date', 'inspection_id', 'location', 'results.S1', 'results.S2', 'unit', 'verdict', 'work_item_id'])
    expect(d.status).toBe('pending_input')
    expect(d.recheck.map((r) => r.key)).toEqual(expect.arrayContaining(['verdict', 'confirmed_qty', 'results.S1', 'results.S2']))
    expect(d.attachments).toEqual([{ photo_id: 's1', storage_path: 'p/intake/i1/s1.jpg' }])
    expect(d.rationale).toContain('系統與 AI 一律不填')
    expect(d.summary).toContain('判定與本次確認數量請親自填寫')
  })
  it('多階段工項:申請的階段在集合內 → 帶入待確認;不在或沒有 → pending 並列出可選階段;stage_key 進必填', () => {
    const ok = buildInspectionFormDraft({ ...iBase(), requiredStages: ['rebar', 'pour'], inspection: { ...insp, stage_key: 'rebar' } })
    expect(ok.content.stage_key).toBe('rebar')
    expect(ok.field_sources.stage_key).toMatchObject({ status: 'filled', source: 'inspection:ins-a' })
    expect(ok.required_fields).toContain('stage_key')
    const bad = buildInspectionFormDraft({ ...iBase(), requiredStages: ['rebar', 'pour'], inspection: { ...insp, stage_key: '澆置' } })
    expect(bad.content.stage_key).toBeNull()
    expect(bad.field_sources.stage_key).toMatchObject({ status: 'pending' })
    expect(bad.field_sources.stage_key!.reason).toContain('rebar、pour')
    expect(bad.recheck.some((r) => r.key === 'stage_key')).toBe(true)
  })
  it('查驗申請未載明申報量／位置:不猜——申報量 pending、位置取照片唯一位置(多個要人選);沒有範本時無項目', () => {
    const d = buildInspectionFormDraft({ ...iBase(), template: null, templateReason: null, inspection: { ...insp, declared_qty: null, location: null, checklist_record_id: null },
      photos: [photo({ id: 's1', location: 'B區' }), photo({ id: 's2', location: 'B區' })] })
    expect(d.content.declared_qty).toBeNull()
    expect(d.field_sources.declared_qty).toMatchObject({ status: 'pending' })
    expect(d.content.location).toBe('B區')
    expect(d.field_sources.location).toMatchObject({ status: 'filled', source: 'ai:photo' })
    expect(d.content.template_id).toBeNull()
    expect(d.content.results).toEqual({})
    expect(d.content.self_check_record_id).toBeNull()
    expect(d.required_fields).toEqual(['confirmed_qty', 'declared_qty', 'inspection_date', 'inspection_id', 'location', 'unit', 'verdict', 'work_item_id'])
    const multi = buildInspectionFormDraft({ ...iBase(), inspection: { ...insp, location: null }, photos: [photo({ id: 's1', location: 'B區' }), photo({ id: 's2', location: 'C區' })] })
    expect(multi.content.location).toBeNull()
    expect(multi.field_sources.location).toMatchObject({ status: 'pending' })
  })
})
