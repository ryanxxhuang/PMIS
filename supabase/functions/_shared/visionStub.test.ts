// 本機視覺 stub 的啟用條件(P2c):正式環境預設關閉且無法啟用——沒有旗標、或 SUPABASE_URL 是
// https／非本機主機,一律 false;只有旗標=1 且本機 http 位址才 true。
import { describe, it, expect } from 'vitest'
import { stubAllowed, stubClassify, stubWhiteboard, STUB_NOTE } from './visionStub.ts'

describe('visionStub.stubAllowed', () => {
  it('沒有旗標(正式預設)→ 關閉,不論 URL', () => {
    expect(stubAllowed({ flag: undefined, supabaseUrl: 'http://kong:8000' })).toBe(false)
    expect(stubAllowed({ flag: '', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(false)
    expect(stubAllowed({ flag: '0', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(false)
    expect(stubAllowed({ flag: 'true', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(false)
  })
  it('旗標=1 但 SUPABASE_URL 是正式 https 或非本機主機 → 仍關閉', () => {
    expect(stubAllowed({ flag: '1', supabaseUrl: 'https://buylyonwoyvqdbvkkkbx.supabase.co' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'https://kong:8000' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://evil.example.com' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: '' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'not a url' })).toBe(false)
  })
  it('旗標=1 且本機 http 位址 → 啟用(kong／localhost／127.0.0.1／host.docker.internal／supabase_kong_*)', () => {
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://kong:8000' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://localhost:54321' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://host.docker.internal:54321' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://supabase_kong_PMIS:8000' })).toBe(true)
  })
})

describe('visionStub 輸出', () => {
  it('分類結果固定為可辨的工地照、無告示板;hint 由環境指定;板讀回空(不轉錄任何數量)', () => {
    expect(stubClassify(' 結構工程 ')).toMatchObject({ is_construction: true, legible: true, has_board: false, work_item_hint: '結構工程', location: null })
    expect(stubClassify(undefined).work_item_hint).toBe('')
    expect(stubWhiteboard()).toEqual({
      record_medium: 'other', log_date: '', log_date_text: '', log_date_conflict: null, weather: '',
      location: '', location_text: '', work_item_text: '', work_summary: '', observations: [], items: [], dropped: [],
    })
    expect(STUB_NOTE).toContain('stub')
  })
})

// ── F2:紙本查驗表情境——回傳值逐字取自真實模型的實際輸出,並以標記選擇情境 ──────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stubSceneOf, stubPaperCells, STUB_SCENE_SOURCES, STUB_SCENE_MARKER } from './visionStub.ts'

const B2_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/reviews/assets/2026-09-20-contractor-acceptance/vision-after-b2.json')
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
const withTail = (tail: string) => Buffer.concat([Buffer.from(TINY_JPEG_B64, 'base64'), Buffer.from(tail, 'utf8')]).toString('base64')

describe('visionStub 紙表情境(F2)', () => {
  it('紙表情境的分類與轉錄輸出,與 vision-after-b2.json 該照片 original 條件的實際結果逐字相同(stub 資料不得手改)', () => {
    const b2 = JSON.parse(fs.readFileSync(B2_JSON, 'utf8')) as { results: { case: string; condition: string; classify: unknown; record: unknown; model: string }[] }
    for (const [scene, src] of Object.entries(STUB_SCENE_SOURCES)) {
      const real = b2.results.find((r) => r.case === src.case && r.condition === src.condition)
      expect(real, `${scene} 找不到 ${src.case}/${src.condition}`).toBeTruthy()
      expect(real!.model).toBe('claude-haiku-4-5-20251001')
      expect(src.classify).toEqual(real!.classify)
      expect(src.record).toEqual(real!.record)
      expect(stubClassify('任何 hint', scene as keyof typeof STUB_SCENE_SOURCES)).toEqual(real!.classify)
      expect(stubWhiteboard(scene as keyof typeof STUB_SCENE_SOURCES)).toEqual(real!.record)
    }
  })
  it('紙表情境是「紙本查驗表」且帶實測觀察(含來源矩形);有紙上日期;分類的位置沒有原文佐證;text_legible=true(整張轉錄路徑)', () => {
    const a = STUB_SCENE_SOURCES.paper_form_line_a
    expect(a.classify).toMatchObject({ has_board: true, record_medium: 'paper_form', text_legible: true, location: 'B5-4-4-25m' })
    expect(a.record.log_date).toBe('2026-08-04')
    expect(a.record.location).toBe('') // 轉錄沒讀到位置 → 分類猜的 B5-4-4-25m 不得落地(groundedLocation)
    const measured = a.record.observations.filter((o) => o.kind === 'measured')
    expect(measured.map((o) => `${o.entry_no}:${o.label}:${o.raw_text}`)).toEqual(['1:線徑:13 * 11 MM', '1:網目:15 * 15 CM', '4:線徑:11 * 11 MM', '4:網目:15 * 15 CM'])
    expect(measured.every((o) => o.source?.method === 'paper_cells' && o.source.column === 'right')).toBe(true)
    expect(Object.keys(STUB_SCENE_SOURCES)).toEqual(['paper_form_line_a']) // 只收整張轉錄路徑走得到的那一張(理由見 visionStub.ts 檔頭)
  })
  it('回傳值是深拷貝:呼叫端改動不會污染常數', () => {
    const r = stubWhiteboard('paper_form_line_a')
    r.observations.length = 0
    expect(stubWhiteboard('paper_form_line_a').observations.length).toBe(8)
  })
  it('情境由附在 JPEG 資料之後的標記決定;沒有標記、未知情境、非 base64 一律 site;stub 逐格永遠空', () => {
    expect(stubSceneOf(withTail(`${STUB_SCENE_MARKER}paper_form_line_a;c21-a`))).toBe('paper_form_line_a')
    expect(stubSceneOf(withTail(`seed-first;${STUB_SCENE_MARKER}paper_form_line_a`))).toBe('paper_form_line_a')
    expect(stubSceneOf(withTail('sc-a'))).toBe('site')
    expect(stubSceneOf(withTail(`${STUB_SCENE_MARKER}unknown_scene`))).toBe('site')
    expect(stubSceneOf(TINY_JPEG_B64)).toBe('site')
    expect(stubSceneOf('')).toBe('site')
    expect(stubSceneOf('not base64 !!')).toBe('site')
    expect(stubClassify('結構工程').has_board).toBe(false) // 預設情境不變
    expect(stubPaperCells()).toEqual({ column_seen: '', rows: [] })
  })
})
