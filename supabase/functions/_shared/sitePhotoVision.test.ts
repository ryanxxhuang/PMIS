// 照片辨識的 schema 與確定性後檢(2026-09-20 廠商驗收 B)。
// 釘住的紅線(報告逐張必修例):
//   * 設計值／規範要求(≥27 cm)永遠不得變成實測值;空欄(*、—)不得變成 0 或合格。
//   * 兩向尺寸(11×11 mm)兩個數字都要留,不得截半。
//   * 沒有原文出處的位置不得進結構化欄位(驗收:location="11F" 是從線徑 11 猜的)。
//   * 從照片無法判定的斷言(綁紮「完成」)由後檢砍掉,不是只加一句 prompt 禁令。
//   * 民國年由系統確定性換算(115.8.4 → 2026-08-04),不交給模型。
//   * 場景可辨識與文字／讀數可辨識分開:看得到鋼筋不等於讀得出卡尺。
import { describe, it, expect } from 'vitest'
import {
  SITE_PHOTO_SCHEMA, WHITEBOARD_SCHEMA, agreeRecords, groundedLocation, hasWrittenRecord, needsSecondPass,
  normalizeSitePhotoResult, normalizeWhiteboardResult, parseRecordDate, sitePhotoCall, unverifiableClaim, whiteboardCall,
} from './sitePhotoVision.ts'
import { MODELS } from './claude.ts'

const classify = (over: Record<string, unknown> = {}) => ({
  caption: '以游標卡尺量測鋼筋', category: '查驗會勘', is_construction: true, legible: true, text_legible: false,
  has_board: false, record_medium: 'none', work_item_hint: '鋼筋加工及組立', visible_progress: '量測鋼筋直徑',
  location: null, location_text: '', ...over,
})
const record = (over: Record<string, unknown> = {}) => ({
  record_medium: 'paper_form', log_date_text: '', log_date: '', weather: '', location: '', location_text: '',
  work_item_text: '', work_summary: '', observations: [], items: [], ...over,
})

describe('schema 與呼叫參數', () => {
  it('分類 schema 有兩層可辨識度、載體與位置原文;模型維持既有 fast(不因本任務換模型)', () => {
    const req = SITE_PHOTO_SCHEMA.required as string[]
    expect(req).toContain('legible')
    expect(req).toContain('text_legible')
    expect(req).toContain('record_medium')
    expect(req).toContain('location_text')
    expect(sitePhotoCall('x').model).toBe(MODELS.fast)
    expect(whiteboardCall('x').model).toBe(MODELS.fast)
  })
  it('轉錄 schema 把「設計／實測紀錄」與「當日完成數量」分成兩個陣列;每筆觀察都要原文', () => {
    const props = WHITEBOARD_SCHEMA.properties as Record<string, { items?: { required?: string[] } }>
    expect(Object.keys(props)).toContain('observations')
    expect(Object.keys(props)).toContain('items')
    expect(props.observations.items?.required).toEqual(
      ['kind', 'label', 'entry_no', 'raw_text', 'value', 'value2', 'unit', 'comparator', 'location', 'note'],
    )
    // 當日完成數量與觀察各自獨立:尺寸永遠進不了 items
    expect(props.items.items?.required).toContain('quantity')
    expect(props.items.items?.required).not.toContain('value2')
  })
})

describe('normalizeSitePhotoResult:確定性後檢', () => {
  it('從照片無法判定的斷言(完成／合格)一律砍掉並記錄原因', () => {
    const r = normalizeSitePhotoResult(classify({ caption: '鋼筋綁紮完成,進行查驗', visible_progress: '鋼筋綁紮完成' }))!
    expect(r.caption).not.toContain('完成')
    expect(r.visible_progress).toBe('')
    expect(r.dropped.join()).toContain('visible_progress')
    expect(unverifiableClaim('查驗合格')).toBe('合格')
    expect(unverifiableClaim('以卡尺量測鋼筋')).toBeNull()
  })
  it('位置沒有原文出處、或與原文不符 → 丟掉(驗收必修:線徑 11 被讀成 11F)', () => {
    expect(normalizeSitePhotoResult(classify({ location: '11F', location_text: '' }))!.location).toBeNull()
    // 「11F」不曾逐字出現在線徑那一格 → 不算原文出處(只有數字 11 相同不夠)
    expect(normalizeSitePhotoResult(classify({ location: '11F', location_text: '線徑 13 * 11 MM' }))!.location).toBeNull()
    expect(normalizeSitePhotoResult(classify({ location: '11F', location_text: '樓層:11F 柱牆' }))!.location).toBe('11F')
    expect(normalizeSitePhotoResult(classify({ location: 'A區1F', location_text: '施工位置:A區1F' }))!.location).toBe('A區1F')
    expect(normalizeSitePhotoResult(classify({ location: 'B棟3F', location_text: '施工位置:A區1F' }))!.location).toBeNull()
  })
  it('舊資料(沒有 text_legible／record_medium／location_text)沿用當時判讀,不追溯改寫', () => {
    const legacy = normalizeSitePhotoResult({
      caption: '鋼筋綁紮', category: '施工作業', is_construction: true, legible: true, has_board: true,
      work_item_hint: '鋼筋', visible_progress: '', location: 'A區1F',
    })!
    expect(legacy.text_legible).toBe(true)     // 當時 has_board=true 就代表板上字讀得出來
    expect(legacy.record_medium).toBe('board')
    expect(legacy.location).toBe('A區1F')       // 沒有 location_text 欄的舊資料不追溯砍掉
    expect(legacy.dropped).toEqual([])
  })
  it('hasWrittenRecord:場景清楚但文字／刻度讀不出來就不做第二階段轉錄', () => {
    expect(hasWrittenRecord(normalizeSitePhotoResult(classify({ has_board: true, text_legible: true }))!)).toBe(true)
    expect(hasWrittenRecord(normalizeSitePhotoResult(classify({ has_board: true, text_legible: false }))!)).toBe(false)
    expect(hasWrittenRecord(normalizeSitePhotoResult(classify({ has_board: false, text_legible: true }))!)).toBe(false)
  })
})

describe('normalizeWhiteboardResult:設計／實測分離與證據檢核', () => {
  it('容許範圍(≥27 CM)一律歸設計值,不得當實測', () => {
    const r = normalizeWhiteboardResult(record({ observations: [
      { kind: 'measured', label: '搭接長度', entry_no: '1', raw_text: '≧27 CM', value: 27, value2: null, unit: 'CM', comparator: '', location: '', note: '' },
    ] }))!
    expect(r.observations).toHaveLength(1)
    expect(r.observations[0].kind).toBe('design')
    expect(r.observations[0].comparator).toBe('>=')
    expect(r.dropped.join()).toContain('設計值')
  })
  it('空欄佔位(*、—)、沒有數值、數值沒出現在原文 → 整筆丟掉(不當 0、不當合格)', () => {
    const r = normalizeWhiteboardResult(record({ observations: [
      { kind: 'measured', label: '搭接長度', entry_no: '2', raw_text: '*', value: null, value2: null, unit: 'CM', comparator: '', location: '', note: '' },
      { kind: 'measured', label: '線徑', entry_no: '3', raw_text: '', value: 11, value2: null, unit: 'MM', comparator: '', location: '', note: '' },
      { kind: 'measured', label: '網目', entry_no: '4', raw_text: '15 * 15 CM', value: 27, value2: null, unit: 'CM', comparator: '', location: '', note: '' },
    ] }))!
    expect(r.observations).toEqual([])
    expect(r.dropped.join()).toContain('未出現在原文')
  })
  it('兩向尺寸兩個數字都保留;當日完成數量與觀察各走各的', () => {
    const r = normalizeWhiteboardResult(record({
      observations: [{ kind: 'measured', label: '線徑', entry_no: '4', raw_text: '11 * 11 MM', value: 11, value2: 11, unit: 'MM', comparator: '', location: '', note: '' }],
      items: [{ description: '鋼筋加工及組立', quantity: 12.5, unit: 'T', raw_text: '鋼筋 12.5 T', note: '' }],
    }))!
    expect(r.observations[0]).toMatchObject({ value: 11, value2: 11, unit: 'MM', entry_no: '4' })
    expect(r.items).toEqual([{ description: '鋼筋加工及組立', quantity: 12.5, unit: 'T', raw_text: '鋼筋 12.5 T', note: '' }])
  })
  it('完成數量與原文對不上 → 丟掉;舊資料沒有 raw_text 欄就沿用', () => {
    const bad = normalizeWhiteboardResult(record({ items: [{ description: '模板', quantity: 99, unit: 'M2', raw_text: '模板 30 M2', note: '' }] }))!
    expect(bad.items).toEqual([])
    const legacy = normalizeWhiteboardResult({ log_date: '', weather: '', location: '', work_summary: '', items: [{ description: '模板', quantity: 30, unit: 'M2', note: '' }] })!
    expect(legacy.items[0]).toMatchObject({ description: '模板', quantity: 30 })
    expect(legacy.observations).toEqual([])
  })
  it('日期由系統確定性換算民國年;模型自己換算的結果不一致時以原文為準並記衝突', () => {
    expect(parseRecordDate('115.8.4')).toBe('2026-08-04')
    expect(parseRecordDate('民國115年8月4日')).toBe('2026-08-04')
    expect(parseRecordDate('115/8/4')).toBe('2026-08-04')
    expect(parseRecordDate('2026-08-04')).toBe('2026-08-04')
    expect(parseRecordDate('115.2.30')).toBeNull()
    expect(parseRecordDate('無')).toBeNull()
    const r = normalizeWhiteboardResult(record({ log_date_text: '115.8.4', log_date: '2015-08-04' }))!
    expect(r.log_date).toBe('2026-08-04')
    expect(r.log_date_conflict).toContain('2026-08-04')
  })
  it('轉錄的位置與原文不符 → 不採用', () => {
    const r = normalizeWhiteboardResult(record({ location: '11F', location_text: '查驗項目及位置:4-4-25M' }))!
    expect(r.location).toBe('')
    expect(r.dropped.join()).toContain('location')
  })
})

describe('groundedLocation:沒有原文佐證的位置不進文件分組', () => {
  it('有轉錄時以轉錄為準;轉錄讀不到位置 → 分類猜的位置一律不採用', () => {
    const c = normalizeSitePhotoResult(classify({ has_board: true, text_legible: true, location: '11F', location_text: '樓層:11F' }))!
    const withLoc = normalizeWhiteboardResult(record({ location: '4-4-25M', location_text: '查驗項目及位置:4-4-25M' }))!
    const noLoc = normalizeWhiteboardResult(record({}))!
    expect(groundedLocation(c, withLoc)).toMatchObject({ value: '4-4-25M', source: 'record' })
    expect(groundedLocation(c, noLoc).value).toBeNull()
    expect(groundedLocation(c, noLoc).reason).toContain('無原文佐證')
  })
  it('沒有轉錄時:分類有原文出處才採用', () => {
    const grounded = normalizeSitePhotoResult(classify({ location: 'A區1F', location_text: '施工位置:A區1F' }))!
    expect(groundedLocation(grounded, null)).toMatchObject({ value: 'A區1F', source: 'classify' })
    expect(groundedLocation(normalizeSitePhotoResult(classify())!, null).value).toBeNull()
  })
})

describe('第二階段:紙表轉錄兩次只留一致的格子', () => {
  const obs = (over: Record<string, unknown>) => ({
    kind: 'measured', label: '線徑', entry_no: '4', raw_text: '11 * 11 MM', value: 11, value2: 11,
    unit: 'MM', comparator: '', location: '', note: '', ...over,
  })
  it('只對紙本表單做第二階段(黑白板／一般照片不加成本)', () => {
    const paper = normalizeSitePhotoResult(classify({ has_board: true, text_legible: true, record_medium: 'paper_form' }))!
    const board = normalizeSitePhotoResult(classify({ has_board: true, text_legible: true, record_medium: 'board' }))!
    expect(needsSecondPass(paper)).toBe(true)
    expect(needsSecondPass(board)).toBe(false)
  })
  it('兩次相同的讀數留下;只出現一次的(手寫誤讀)丟掉並記原因', () => {
    const a = normalizeWhiteboardResult(record({ observations: [obs({}), obs({ label: '網目', raw_text: 'Ø9 D10 Ø20mm', value: 9, value2: null, unit: 'mm' })] }))!
    const b = normalizeWhiteboardResult(record({ observations: [obs({})] }))!
    const agreed = agreeRecords(a, b)
    expect(agreed.observations).toHaveLength(1)
    expect(agreed.observations[0]).toMatchObject({ label: '線徑', value: 11, value2: 11 })
    expect(agreed.dropped.join()).toContain('兩次辨識不一致')
  })
  it('值不同就是不一致:11×11 與 11(只讀到一向)不得互相當成同一筆', () => {
    const a = normalizeWhiteboardResult(record({ observations: [obs({})] }))!
    const b = normalizeWhiteboardResult(record({ observations: [obs({ raw_text: '11 MM', value2: null })] }))!
    expect(agreeRecords(a, b).observations).toEqual([])
  })
  it('表頭欄位兩次不同就留空(日期、位置、工項);相同才留', () => {
    const a = normalizeWhiteboardResult(record({ log_date_text: '115.8.4', location: '4-4-25M', location_text: '位置:4-4-25M', work_item_text: '鋼筋工程' }))!
    const b = normalizeWhiteboardResult(record({ log_date_text: '115.8.4', location: 'B2U-31', location_text: '位置:B2U-31', work_item_text: '鋼筋工程' }))!
    const agreed = agreeRecords(a, b)
    expect(agreed.log_date).toBe('2026-08-04')
    expect(agreed.location).toBe('')
    expect(agreed.work_item_text).toBe('鋼筋工程')
    expect(agreed.dropped.join()).toContain('位置')
    const other = normalizeWhiteboardResult(record({ log_date_text: '115.8.5' }))!
    expect(agreeRecords(a, other).log_date).toBe('')
    expect(agreeRecords(a, other).log_date_conflict).toContain('兩次辨識的日期不同')
  })
  it('當日完成數量同樣要兩次一致才留', () => {
    const a = normalizeWhiteboardResult(record({ items: [{ description: '模板', quantity: 30, unit: 'M2', raw_text: '模板 30 M2', note: '' }] }))!
    const b = normalizeWhiteboardResult(record({ items: [{ description: '模板', quantity: 35, unit: 'M2', raw_text: '模板 35 M2', note: '' }] }))!
    expect(agreeRecords(a, b).items).toEqual([])
    expect(agreeRecords(a, a).items).toHaveLength(1)
  })
})
